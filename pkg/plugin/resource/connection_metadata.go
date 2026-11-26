package resource

import (
	"context"
	"strconv"
	"time"
	"unicode/utf8"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"k8s.io/client-go/rest"
)

// The fact keys of a connection that is connected.
//
// A connection answers facts about its cluster to the SDK (Config.ConnectionMetadata) once it is connected; the host keeps the last value of each for every plugin, and the UI reads them through
// useConnectionMetadata. The labels (connection_labels.go) say what the kubeconfig states and need no connection; the facts say what the cluster states. The two share their names: a key that both can
// state is the same key with the same meaning, and the fact's constant is the label's, so that one name means one thing everywhere.
//
// Each fact is read on its own, bounded and at once with the others (probeCluster): a read that fails, or that the user may not make, loses no other fact. A fact the cluster does not state, or that
// the user is refused, is absent and says nothing to the user; a read that gave no answer leaves the last value of its facts, which the SDK marks stale. No value holds a credential, a token or certificate
// material. A text value is held to what the SDK accepts (fitsFact): one that is too long is absent, never cut.
//
// Shared with the labels (the label is what the kubeconfig says, the fact what the cluster says; the fact's constant is the label's):
//
//	kubernetes.server                  FactServer                 the API server URL, without userinfo, query or fragment
//	kubernetes.platform                FactPlatform               what the cluster runs on, in the label's words (`eks`, `gke`, `aks`, `kind`, `k3d`, `minikube`, `docker-desktop`): from the configuration and the address of the server, and
//	                                                              `eks` or `gke` when the version says so. A distribution that is not a platform (`k3s`) is not one here
//	cloud.provider                     FactCloudProvider          `aws`, `gcp` or `azure`: from the platform, else from the provider ID of the Nodes
//	cloud.region                       FactCloudRegion            from the configuration (an EKS cluster ARN or address, a GKE context name), else from the topology label of the Nodes
//	cloud.availability_zone            FactCloudAvailabilityZone  from the configuration (a GKE zone), else the zones of the Nodes read: one zone, or all of them, sorted and separated by a comma
//	cloud.account.id                   FactCloudAccountID         the account of an EKS cluster ARN, the GCP project of a GKE context name, the Azure subscription of the kubeconfig. Never an authentication role's
//	k8s.cluster.name                   FactClusterName            the cloud's name for the cluster, from an EKS cluster ARN or a GKE context name
//	azure.resource_group               FactAzureResourceGroup     the resource group of the kubeconfig
//
// Of the server (one read of /version):
//
//	kubernetes.server.version          FactServerVersion          the version as the server says it, with its leading `v` and its build (`v1.31.4-eks-aeac579`): what `kubectl version` prints, and what the Nodes' kubelets say
//	kubernetes.server.platform         FactServerPlatform         the operating system and architecture the API server is built for (`linux/arm64`), not where the cluster runs
//
// Of the cluster:
//
//	kubernetes.cluster.uid             FactClusterUID             the UID of the kube-system Namespace, which the catalog read at the start: the same for everyone who reaches the cluster. Absent when the user may not read it
//	kubernetes.distribution            FactDistribution           `eks`, `gke`, `aks`, `openshift`, `k3s`, `rke2`, `k0s`, `kind`, `minikube`, `microk8s` or `talos`, as the cluster says it (distributionOf). Absent when it says nothing
//	kubernetes.capabilities            FactCapabilities           the notable API groups installed and answering, by short name (capabilityGroups), sorted and separated by a comma. Absent when there is none
//	kubernetes.unavailable_api_groups  FactUnavailableAPIGroups   the API group versions discovery could not read, while the catalog lacks them: { count, groups: [{ groupVersion, reason }] }. Absent while every group answers
//
// What said a platform or a distribution (so that a display may tell a guess from a confirmation):
//
//	kubernetes.platform_source         FactPlatformSource         `connection_config`, `server_endpoint` or `server_version`
//	kubernetes.distribution_source     FactDistributionSource     `server_version`, `api_group`, `server_endpoint` or `node`
//
// Of the user (SelfSubjectReview and one SelfSubjectAccessReview; absent on a server without the first, and for a user who may not make either):
//
//	kubernetes.user.name               FactUserName               who the cluster says the connection is
//	kubernetes.user.groups             FactUserGroups             its groups, as a list: at most userGroupsListed of them
//	kubernetes.user.cluster_admin      FactUserClusterAdmin       `true` or `false`: whether the user may do every verb on every resource of every group. A string, like every fact a decision may read (readCurrentConnectionMetadataString)
//
// Of the Nodes (a list of at most nodeSampleLimit; a user who may not list them has no fact below that comes from them): cloud.provider, cloud.region and cloud.availability_zone when the
// configuration did not state them, kubernetes.distribution when nothing else did.
const (
	FactServer                = LabelKubernetesServer
	FactPlatform              = LabelKubernetesPlatform
	FactPlatformSource        = "kubernetes.platform_source"
	FactCloudProvider         = LabelCloudProvider
	FactCloudRegion           = LabelCloudRegion
	FactCloudAvailabilityZone = LabelCloudAvailabilityZone
	FactCloudAccountID        = LabelCloudAccountID
	FactClusterName           = LabelK8sClusterName
	FactAzureResourceGroup    = LabelAzureResourceGroup

	FactServerVersion        = "kubernetes.server.version"
	FactServerPlatform       = "kubernetes.server.platform"
	FactClusterUID           = "kubernetes.cluster.uid"
	FactDistribution         = "kubernetes.distribution"
	FactDistributionSource   = "kubernetes.distribution_source"
	FactCapabilities         = "kubernetes.capabilities"
	FactUnavailableAPIGroups = "kubernetes.unavailable_api_groups"

	FactUserName         = "kubernetes.user.name"
	FactUserGroups       = "kubernetes.user.groups"
	FactUserClusterAdmin = "kubernetes.user.cluster_admin"
)

// factKeys is every key the probe publishes. An observation ends each of them in a value, an unavailable observation or a removal (factSet.update), which is how a fact the cluster no longer
// states leaves the snapshot.
var factKeys = []string{
	FactServer, FactServerVersion, FactServerPlatform, FactClusterUID,
	FactPlatform, FactPlatformSource, FactDistribution, FactDistributionSource,
	FactUserName, FactUserGroups, FactUserClusterAdmin,
	FactCapabilities, FactUnavailableAPIGroups,
	FactCloudProvider, FactCloudRegion, FactCloudAvailabilityZone, FactCloudAccountID, FactClusterName, FactAzureResourceGroup,
}

// factTextMax is the most the JSON of a text fact may take. The SDK refuses a value over 16 KiB (resourcev2.MaxConnectionMetadataEntryBytes) and then fails the observation of every fact
// of the connection, so a name the cluster makes up (a user name, a version) must not be able to reach it.
const factTextMax = 2048

// userGroupsListed and userGroupsBytes bound the groups of the user, which an identity provider can send in the hundreds: the first userGroupsListed, and no more of them than take userGroupsBytes
// of JSON.
const (
	userGroupsListed = 64
	userGroupsBytes  = 8 << 10
)

// jsonTextBytes is how many bytes the JSON of a string takes, quotes excluded, counted as the SDK counts a metadata value (jsonStringBytes). It is false for a string that is not valid UTF-8, which the
// SDK refuses (JSON decoding never gives one), and for one over limit: the count stops there, so that a string of any length costs at most limit.
func jsonTextBytes(value string, limit int) (size int, ok bool) {
	for i := 0; i < len(value); {
		character, width := utf8.DecodeRuneInString(value[i:])
		if character == utf8.RuneError && width == 1 {
			return 0, false
		}
		size += jsonStringBytes(character, width)
		if size > limit {
			return 0, false
		}
		i += width
	}
	return size, true
}

// fitsFact reports whether a string may be a fact: its JSON takes at most limit bytes and it is valid UTF-8. A fact the cluster states in a string that does not fit is absent, never cut: a cut name
// is another name.
func fitsFact(value string, limit int) bool {
	_, ok := jsonTextBytes(value, limit)
	return ok
}

// factSet is the update an observation builds. A key may not be both set and removed: the SDK refuses such an update and loses every fact of the connection with it.
type factSet struct {
	set map[string]resourcev2.ConnectionMetadataObservation
	now time.Time
}

func newFactSet() *factSet {
	return &factSet{set: make(map[string]resourcev2.ConnectionMetadataObservation, len(factKeys)), now: time.Now().UTC()}
}

// value says a fact. The caller has bounded it.
func (f *factSet) value(key string, value any) {
	f.set[key] = resourcev2.ConnectionMetadataObservation{State: "success", Value: value, ObservedAt: f.now}
}

// text says a text fact, and nothing when there is none or when it does not fit (fitsFact).
func (f *factSet) text(key, value string) {
	if value != "" && fitsFact(value, factTextMax) {
		f.value(key, value)
	}
}

// reported says a fact the server is expected to state, or says that it did not.
func (f *factSet) reported(key, value string) {
	if value == "" || !fitsFact(value, factTextMax) {
		f.unavailable(key, "NOT_REPORTED", "The server did not report this fact.")
		return
	}
	f.value(key, value)
}

func (f *factSet) unavailable(key, code, message string) {
	f.set[key] = resourcev2.ConnectionMetadataObservation{State: "unavailable", Error: &resourcev2.ConnectionMetadataError{Code: code, Message: message}}
}

// failed says, for the keys of a read that gave no answer and that nothing else stated, that they could not be observed: the SDK keeps the last value of such a fact and marks it stale. The words
// are fixed; an error from the transport can hold credentials or what the server answered.
func (f *factSet) failed(keys ...string) {
	for _, key := range keys {
		if _, said := f.set[key]; !said {
			f.unavailable(key, "OBSERVATION_FAILED", "The fact could not be observed.")
		}
	}
}

// update is what was said, and the removal of every fact that was not: the cluster does not state it, or the user may not read it.
func (f *factSet) update() resourcev2.ConnectionMetadataUpdate {
	update := resourcev2.ConnectionMetadataUpdate{Set: f.set}
	for _, key := range factKeys {
		if _, said := f.set[key]; !said {
			update.Remove = append(update.Remove, key)
		}
	}
	return update
}

// connectionMetadata observes the facts of a connection (the keys above): what its configuration says and what the installed catalog says, which make no request, and what the cluster says,
// which probeCluster reads at once and independently.
func connectionMetadata(ctx context.Context, connection types.Connection, client *clients.ClientSet, catalog catalogFacts) (resourcev2.ConnectionMetadataUpdate, error) {
	facts := newFactSet()
	endpoint := ""
	if client != nil && client.RESTConfig != nil {
		endpoint = sanitizedMetadataEndpoint(client.RESTConfig)
	}
	facts.reported(FactServer, endpoint)

	reads := probeCluster(ctx, client)
	switch {
	case reads.version.state == readOK:
		facts.reported(FactServerVersion, reads.version.value.GitVersion)
		facts.reported(FactServerPlatform, reads.version.value.Platform)
	case hasDiscovery(client):
		// Never surface transport errors: they can contain credentials or server responses.
		facts.unavailable(FactServerVersion, "OBSERVATION_FAILED", "Server version could not be observed.")
		facts.unavailable(FactServerPlatform, "OBSERVATION_FAILED", "Server platform could not be observed.")
	default:
		facts.unavailable(FactServerVersion, "CLIENT_UNAVAILABLE", "Server version is unavailable.")
		facts.unavailable(FactServerPlatform, "CLIENT_UNAVAILABLE", "Server platform is unavailable.")
	}

	evidence := clusterEvidence{groups: catalog.groups, nodes: summarizeNodes(reads.nodes.value)}
	if reads.version.state == readOK {
		evidence.version = reads.version.value.GitVersion
	}
	for key, value := range inferConnectionEnvironment(connection, endpoint, evidence) {
		facts.text(key, value)
	}
	if reads.nodes.state == readFailed {
		facts.failed(FactCloudProvider, FactCloudRegion, FactCloudAvailabilityZone, FactDistribution, FactDistributionSource)
	}

	switch reads.user.state {
	case readOK:
		facts.text(FactUserName, reads.user.value.name)
		if groups := userGroupsValue(reads.user.value.groups); len(groups) != 0 {
			facts.value(FactUserGroups, groups)
		}
	case readFailed:
		facts.failed(FactUserName, FactUserGroups)
	case readAbsent:
	}
	switch reads.admin.state {
	case readOK:
		facts.value(FactUserClusterAdmin, strconv.FormatBool(reads.admin.value))
	case readFailed:
		facts.failed(FactUserClusterAdmin)
	case readAbsent:
	}

	facts.text(FactClusterUID, catalog.clusterUID)
	facts.text(FactCapabilities, capabilitiesOf(catalog.groups))
	if len(catalog.unavailable) != 0 {
		facts.value(FactUnavailableAPIGroups, unavailableGroupsValue(catalog.unavailable))
	}
	return facts.update(), nil
}

// hasDiscovery reports whether the client can read /version.
func hasDiscovery(client *clients.ClientSet) bool {
	return client != nil && client.DiscoveryClient != nil && client.DiscoveryClient.RESTClient() != nil
}

// userGroupsValue is the groups of the user as a list, bounded by userGroupsListed and userGroupsBytes whatever the cluster says. A name that does not fit is left out, not cut.
func userGroupsValue(groups []string) []any {
	listed := make([]any, 0, min(len(groups), userGroupsListed))
	size := len("[]")
	for _, group := range groups {
		if len(listed) == userGroupsListed {
			break
		}
		bytes, ok := jsonTextBytes(group, factTextMax)
		if !ok || group == "" {
			continue
		}
		next := size + len(`"",`) + bytes
		if next > userGroupsBytes {
			break
		}
		listed, size = append(listed, group), next
	}
	return listed
}

func sanitizedMetadataEndpoint(config *rest.Config) string {
	if config == nil || config.Host == "" {
		return ""
	}
	// Match the REST client's host normalization and configuration-based TLS default.
	endpoint, _, err := rest.DefaultServerUrlFor(config)
	if err != nil || endpoint.Host == "" || (endpoint.Scheme != "https" && endpoint.Scheme != "http") {
		return ""
	}
	endpoint.User = nil
	endpoint.RawQuery = ""
	endpoint.ForceQuery = false
	endpoint.Fragment = ""
	endpoint.RawFragment = ""
	return endpoint.String()
}
