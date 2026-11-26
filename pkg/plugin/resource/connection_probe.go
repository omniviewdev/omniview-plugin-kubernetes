package resource

import (
	"context"
	"encoding/json"
	"io"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	authenticationv1 "k8s.io/api/authentication/v1"
	authorizationv1 "k8s.io/api/authorization/v1"
	corev1 "k8s.io/api/core/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// What the probe asks of a cluster, besides what the catalog already read at the start. Each read is one request, made at once with the others, with a deadline of its own (probeTimeout), and says
// nothing of the others: a probe that is refused, fails or finds no such API gives up its own facts only. There is no watch, no informer and no list of a large collection.
//
//	GET  /version                                                     the version and platform of the server (a 64 KiB answer at most)
//	POST /apis/authentication.k8s.io/v1/selfsubjectreviews            who the cluster says the user is (answered by the server alone: nothing is stored)
//	POST /apis/authorization.k8s.io/v1/selfsubjectaccessreviews       whether the user may do everything (one review of verb *, resource * and group *; nothing is stored)
//	GET  /api/v1/nodes?limit=20                                       the first nodeSampleLimit Nodes, for where they are and what they run (one page; the continuation is never followed)
//
// The Nodes are read whole: the provider ID that says the cloud is in their spec, which PartialObjectMetadata does not carry. Only a handful of strings of each is kept (nodeFactsOf), and no count.

// probeTimeout bounds each read of the probe. They run at once, so it is also what the probe takes at most, however many fail to answer. Tests replace it.
var probeTimeout = 5 * time.Second

// nodeSampleLimit is how many Nodes the probe reads: the first page, in the order of the server, which is a sample of the cluster and never all of it.
const nodeSampleLimit = 20

// versionBytes is the most of /version that is read.
const versionBytes = 64 * 1024

// readState is how a read ended.
type readState int

const (
	// readOK: the cluster answered.
	readOK readState = iota
	// readAbsent: the cluster has no such fact (an API it does not serve, or no client for it), or the user is refused it. That is an answer, and not one to tell the user.
	readAbsent
	// readFailed: no answer (a deadline, a connection that fell, a server error, a body that is not what was asked for). The last value of the facts it feeds stays, and is stale.
	readFailed
)

// reading is what one read gave and how it ended. A value is only meaningful when the state is readOK.
type reading[T any] struct {
	value T
	state readState
}

// readStateOf says how a read that failed with err ended: a refusal or an API the server does not serve is an answer (absent), anything else is no answer.
func readStateOf(err error) readState {
	switch {
	case err == nil:
		return readOK
	case k8serrors.IsForbidden(err), k8serrors.IsNotFound(err), k8serrors.IsMethodNotSupported(err):
		return readAbsent
	default:
		return readFailed
	}
}

// serverVersion is the part of /version that is a fact.
type serverVersion struct {
	GitVersion string `json:"gitVersion"`
	Platform   string `json:"platform"`
}

// userIdentity is who the cluster says the user is. The server also says a UID and extra attributes (an EKS user's access key, a token's identifier): none of them is kept.
type userIdentity struct {
	name   string
	groups []string
}

// clusterReads is what the probe read, one field for each read.
type clusterReads struct {
	version reading[serverVersion]
	user    reading[userIdentity]
	admin   reading[bool]
	nodes   reading[[]nodeFacts]
}

// probeCluster makes every read of the probe at once and waits for them all. No read waits for another, and each ends within probeTimeout of its start or when ctx ends.
func probeCluster(ctx context.Context, client *clients.ClientSet) clusterReads {
	var reads clusterReads
	var group sync.WaitGroup
	group.Go(func() { reads.version = readServerVersion(ctx, client) })
	group.Go(func() { reads.user = readUser(ctx, client) })
	group.Go(func() { reads.admin = readClusterAdmin(ctx, client) })
	group.Go(func() { reads.nodes = readNodes(ctx, client) })
	group.Wait()
	return reads
}

func readServerVersion(ctx context.Context, client *clients.ClientSet) reading[serverVersion] {
	if !hasDiscovery(client) {
		return reading[serverVersion]{state: readFailed}
	}
	ctx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()
	stream, err := client.DiscoveryClient.RESTClient().Get().AbsPath("/version").Stream(ctx)
	if err != nil {
		return reading[serverVersion]{state: readFailed}
	}
	defer func() { _ = stream.Close() }()
	data, err := io.ReadAll(io.LimitReader(stream, versionBytes+1))
	var info serverVersion
	if err != nil || len(data) > versionBytes || json.Unmarshal(data, &info) != nil {
		return reading[serverVersion]{state: readFailed}
	}
	return reading[serverVersion]{value: info, state: readOK}
}

// readUser asks who the cluster says the user is. A server without SelfSubjectReview (before 1.28) answers that it has no such API, and a user who may not make the review is refused: the
// user's facts are then absent.
func readUser(ctx context.Context, client *clients.ClientSet) reading[userIdentity] {
	if client == nil || client.KubeClient == nil {
		return reading[userIdentity]{state: readAbsent}
	}
	ctx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()
	review, err := client.KubeClient.AuthenticationV1().SelfSubjectReviews().Create(ctx, &authenticationv1.SelfSubjectReview{}, metav1.CreateOptions{})
	if err != nil {
		return reading[userIdentity]{state: readStateOf(err)}
	}
	info := review.Status.UserInfo
	if info.Username == "" {
		return reading[userIdentity]{state: readAbsent}
	}
	return reading[userIdentity]{value: userIdentity{name: info.Username, groups: info.Groups}, state: readOK}
}

// readClusterAdmin asks whether the user may do every verb on every resource of every group, in every namespace: one review, the question `kubectl auth can-i '*' '*'` asks (with the group
// named, so that a rule for some groups is not taken for all of them).
func readClusterAdmin(ctx context.Context, client *clients.ClientSet) reading[bool] {
	if client == nil || client.KubeClient == nil {
		return reading[bool]{state: readAbsent}
	}
	ctx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()
	review := &authorizationv1.SelfSubjectAccessReview{Spec: authorizationv1.SelfSubjectAccessReviewSpec{
		ResourceAttributes: &authorizationv1.ResourceAttributes{Verb: "*", Group: "*", Resource: "*"},
	}}
	review, err := client.KubeClient.AuthorizationV1().SelfSubjectAccessReviews().Create(ctx, review, metav1.CreateOptions{})
	if err != nil {
		return reading[bool]{state: readStateOf(err)}
	}
	return reading[bool]{value: review.Status.Allowed, state: readOK}
}

// readNodes reads the first page of Nodes, at most nodeSampleLimit of them, and keeps what each says of where it is and what it runs. A user who may not list Nodes is refused: the Nodes' facts are
// then absent.
func readNodes(ctx context.Context, client *clients.ClientSet) reading[[]nodeFacts] {
	if client == nil || client.KubeClient == nil {
		return reading[[]nodeFacts]{state: readAbsent}
	}
	ctx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()
	list, err := client.KubeClient.CoreV1().Nodes().List(ctx, metav1.ListOptions{Limit: nodeSampleLimit})
	if err != nil {
		return reading[[]nodeFacts]{state: readStateOf(err)}
	}
	nodes := make([]nodeFacts, 0, min(len(list.Items), nodeSampleLimit))
	for i := range min(len(list.Items), nodeSampleLimit) {
		nodes = append(nodes, nodeFactsOf(&list.Items[i]))
	}
	return reading[[]nodeFacts]{value: nodes, state: readOK}
}

// nodeFacts is what one Node says of where it is and what it runs. Nothing else of it is kept.
type nodeFacts struct {
	// region and zone are its topology labels.
	region, zone string
	// cloud is the cloud of its provider ID (`aws`, `gcp`, `azure`).
	cloud string
	// distribution is what it says of the distribution it runs (`kind`, `k3s`, `minikube`, `microk8s`, `aks`, `talos`).
	distribution string
}

// providerIDClouds is the cloud (an OpenTelemetry `cloud.provider` value) each scheme of a provider ID belongs to: `aws:///us-east-1a/i-0123`, `gce://project/us-central1-a/node`,
// `azure:///subscriptions/...`. A scheme that is not here (`digitalocean`, `openstack`, `vsphere`) says no cloud this plugin names.
var providerIDClouds = map[string]string{"aws": "aws", "gce": "gcp", "azure": "azure"}

// providerIDDistributions is the distribution a scheme of a provider ID belongs to: `kind://docker/kind/kind-control-plane`, `k3s://node`.
var providerIDDistributions = map[string]string{"kind": "kind", "k3s": "k3s"}

// nodeLabelDistributions is the distribution a label that only its Nodes carry belongs to.
var nodeLabelDistributions = []struct{ label, distribution string }{
	{"minikube.k8s.io/name", "minikube"},
	{"microk8s.io/cluster", "microk8s"},
	{"kubernetes.azure.com/cluster", "aks"},
}

// nodeFactsOf keeps what a Node says of where it is (the topology labels, current and deprecated) and what it runs (its provider ID, its labels and its operating system image).
func nodeFactsOf(node *corev1.Node) nodeFacts {
	label := func(names ...string) string {
		for _, name := range names {
			if value := node.Labels[name]; value != "" {
				return value
			}
		}
		return ""
	}
	facts := nodeFacts{
		region: label("topology.kubernetes.io/region", "failure-domain.beta.kubernetes.io/region"),
		zone:   label("topology.kubernetes.io/zone", "failure-domain.beta.kubernetes.io/zone"),
	}
	scheme, _, _ := strings.Cut(node.Spec.ProviderID, "://")
	facts.cloud = providerIDClouds[scheme]
	facts.distribution = providerIDDistributions[scheme]
	if facts.distribution == "" {
		for _, rule := range nodeLabelDistributions {
			if _, ok := node.Labels[rule.label]; ok {
				facts.distribution = rule.distribution
				break
			}
		}
	}
	// Talos writes its name and version as the operating system image of every Node: `Talos (v1.7.5)`.
	if facts.distribution == "" && strings.HasPrefix(node.Status.NodeInfo.OSImage, "Talos (") {
		facts.distribution = "talos"
	}
	return facts
}

// nodeSummary is what the Nodes read say together. A fact the Nodes disagree on, or that none states, is empty: a cluster is on one cloud, in one region, and runs one distribution.
type nodeSummary struct {
	cloud, region, distribution string
	// zones are the zones of the Nodes, sorted and separated by a comma: a cluster may span several.
	zones string
}

// summarizeNodes is what the Nodes read say together (nodeSummary).
func summarizeNodes(nodes []nodeFacts) nodeSummary {
	var clouds, regions, zones, distributions []string
	for _, node := range nodes {
		clouds = append(clouds, node.cloud)
		regions = append(regions, node.region)
		zones = append(zones, node.zone)
		distributions = append(distributions, node.distribution)
	}
	one := func(values []string) string {
		if distinct := distinctText(values); len(distinct) == 1 {
			return distinct[0]
		}
		return ""
	}
	return nodeSummary{cloud: one(clouds), region: one(regions), distribution: one(distributions), zones: strings.Join(distinctText(zones), ",")}
}

// distinctText is the values that are not empty, once each, sorted.
func distinctText(values []string) []string {
	distinct := slices.DeleteFunc(slices.Clone(values), func(value string) bool { return value == "" })
	slices.Sort(distinct)
	return slices.Compact(distinct)
}
