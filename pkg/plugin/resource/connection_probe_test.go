package resource

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"maps"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/stretchr/testify/require"
	authenticationv1 "k8s.io/api/authentication/v1"
	authorizationv1 "k8s.io/api/authorization/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

const (
	selfSubjectReviewsPath       = "/apis/authentication.k8s.io/v1/selfsubjectreviews"
	selfSubjectAccessReviewsPath = "/apis/authorization.k8s.io/v1/selfsubjectaccessreviews"
)

// apiServer answers the requests the probe makes, by path, and records what was asked: the request, its body and how many were in flight at once.
type apiServer struct {
	*httptest.Server
	mu       sync.Mutex
	answers  map[string]http.HandlerFunc
	requests []string
	bodies   map[string][]byte
	inflight int
	peak     int
}

// newAPIServer serves answers and gives a client set of the real clients (the discovery client reads /version, the clientset the rest) against it. A request takes a moment, so that the reads
// that are made at once are seen to be.
func newAPIServer(t *testing.T, answers map[string]http.HandlerFunc, config rest.Config) (*apiServer, *clients.ClientSet) {
	t.Helper()
	s := &apiServer{answers: answers, bodies: map[string][]byte{}}
	s.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		s.mu.Lock()
		s.requests = append(s.requests, r.Method+" "+r.URL.RequestURI())
		s.bodies[r.URL.Path] = body
		s.inflight++
		s.peak = max(s.peak, s.inflight)
		answer := s.answers[r.URL.Path]
		s.mu.Unlock()
		defer func() {
			s.mu.Lock()
			s.inflight--
			s.mu.Unlock()
		}()
		select {
		case <-time.After(150 * time.Millisecond):
		case <-r.Context().Done():
			return
		}
		if answer == nil {
			http.NotFound(w, r)
			return
		}
		answer(w, r)
	}))
	t.Cleanup(s.Close)
	// The plugin's resource clients ask for JSON and send it (kubeauth.LoadResourceKubeClients).
	config.Host, config.ContentType, config.AcceptContentTypes = s.URL, "application/json", "application/json"
	kube, err := kubernetes.NewForConfig(&config)
	require.NoError(t, err)
	disco, err := discovery.NewDiscoveryClientForConfig(&config)
	require.NoError(t, err)
	return s, &clients.ClientSet{RESTConfig: &config, KubeClient: kube, DiscoveryClient: disco}
}

func answerWith(value any) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(value)
	}
}

// refuse answers as an API server does when it refuses, or does not serve, a request: a Status. Its message holds a secret, as a real server's may.
func refuse(code int32, reason metav1.StatusReason) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(int(code))
		_ = json.NewEncoder(w).Encode(metav1.Status{TypeMeta: metav1.TypeMeta{Kind: "Status", APIVersion: "v1"}, Status: metav1.StatusFailure, Reason: reason, Code: code, Message: "refused: secret-token"})
	}
}

// brokenServer answers as a server that fell over, with a body that is not a Status and holds a secret.
func brokenServer(w http.ResponseWriter, _ *http.Request) {
	http.Error(w, "upstream said secret-token", http.StatusInternalServerError)
}

// hang never answers, until the client gives up.
func hang(_ http.ResponseWriter, r *http.Request) { <-r.Context().Done() }

// healthyCluster answers every request of the probe. Everything it says that must never be published (a commit, a UID, the extra attributes of a user, annotations) holds the word `secret`.
func healthyCluster() map[string]http.HandlerFunc {
	aws := func(name, providerID, zone string) corev1.Node {
		return corev1.Node{
			ObjectMeta: metav1.ObjectMeta{Name: name, Labels: topology("us-east-1", zone), Annotations: map[string]string{"example.io/token": "secret-annotation"}},
			Spec:       corev1.NodeSpec{ProviderID: providerID},
			Status:     corev1.NodeStatus{NodeInfo: corev1.NodeSystemInfo{MachineID: "secret-machine"}, Images: []corev1.ContainerImage{{Names: []string{"registry.example/secret-image"}}}},
		}
	}
	return map[string]http.HandlerFunc{
		"/version": answerWith(map[string]string{"major": "1", "minor": "31", "gitVersion": "v1.31.4-eks-aeac579", "gitCommit": "secret-commit", "platform": "linux/arm64"}),
		selfSubjectReviewsPath: answerWith(authenticationv1.SelfSubjectReview{
			TypeMeta: metav1.TypeMeta{Kind: "SelfSubjectReview", APIVersion: "authentication.k8s.io/v1"},
			Status: authenticationv1.SelfSubjectReviewStatus{UserInfo: authenticationv1.UserInfo{
				Username: "alice", UID: "secret-uid", Groups: []string{"devs", "system:authenticated"},
				Extra: map[string]authenticationv1.ExtraValue{"accessKeyId": {"AKIAsecret"}, "authentication.kubernetes.io/credential-id": {"JTI=secret"}},
			}},
		}),
		selfSubjectAccessReviewsPath: answerWith(authorizationv1.SelfSubjectAccessReview{
			TypeMeta: metav1.TypeMeta{Kind: "SelfSubjectAccessReview", APIVersion: "authorization.k8s.io/v1"},
			Status:   authorizationv1.SubjectAccessReviewStatus{Allowed: true, Reason: "RBAC: allowed by ClusterRoleBinding secret-binding"},
		}),
		"/api/v1/nodes": answerWith(corev1.NodeList{
			TypeMeta: metav1.TypeMeta{Kind: "NodeList", APIVersion: "v1"},
			Items:    []corev1.Node{aws("a", "aws:///us-east-1a/i-secret1", "us-east-1a"), aws("b", "aws:///us-east-1b/i-secret2", "us-east-1b")},
		}),
	}
}

// healthyFacts is what the probe says of healthyCluster, for a connection that has no configuration and a catalog that read a UID and two notable groups.
func healthyFacts(server *apiServer) (types.Connection, catalogFacts, map[string]any) {
	catalog := catalogFacts{clusterUID: "11111111-2222-3333-4444-555555555555", groups: []string{"apps", "metrics.k8s.io", "networking.istio.io"}}
	return types.Connection{ID: "probe"}, catalog, map[string]any{
		"kubernetes.server":              server.URL,
		"kubernetes.server.version":      "v1.31.4-eks-aeac579",
		"kubernetes.server.platform":     "linux/arm64",
		"kubernetes.cluster.uid":         "11111111-2222-3333-4444-555555555555",
		"kubernetes.platform":            "eks",
		"kubernetes.platform_source":     "server_version",
		"kubernetes.distribution":        "eks",
		"kubernetes.distribution_source": "server_version",
		"kubernetes.user.name":           "alice",
		"kubernetes.user.groups":         []any{"devs", "system:authenticated"},
		"kubernetes.user.cluster_admin":  "true",
		"kubernetes.capabilities":        "istio,metrics",
		"cloud.provider":                 "aws",
		"cloud.region":                   "us-east-1",
		"cloud.availability_zone":        "us-east-1a,us-east-1b",
	}
}

// values are the facts an update says, by key, and the keys it says could not be observed, and the keys it removes.
func factValues(update resourcev2.ConnectionMetadataUpdate) (said map[string]any, unavailable map[string]*resourcev2.ConnectionMetadataError) {
	said, unavailable = map[string]any{}, map[string]*resourcev2.ConnectionMetadataError{}
	for key, observation := range update.Set {
		if observation.State == "success" {
			said[key] = observation.Value
		} else {
			unavailable[key] = observation.Error
		}
	}
	return said, unavailable
}

// A connection's facts cost one request each, all made at once: the version, one review of who the user is, one review of whether the user may do everything (the question for verb *, resource * and
// group *), and the first 20 Nodes. Nothing is watched, and nothing else is read.
func TestProbeMakesOneRequestForEachFactAtOnceAndNeverWatches(t *testing.T) {
	server, client := newAPIServer(t, healthyCluster(), rest.Config{})
	connection, catalog, want := healthyFacts(server)

	update, err := connectionMetadata(context.Background(), connection, client, catalog)
	require.NoError(t, err)

	require.ElementsMatch(t, []string{"GET /version?timeout=32s", "POST " + selfSubjectReviewsPath, "POST " + selfSubjectAccessReviewsPath, "GET /api/v1/nodes?limit=20"}, server.requests)
	require.Equal(t, 4, server.peak, "the reads are made at once")
	var review authorizationv1.SelfSubjectAccessReview
	require.NoError(t, json.Unmarshal(server.bodies[selfSubjectAccessReviewsPath], &review))
	require.Equal(t, authorizationv1.ResourceAttributes{Verb: "*", Group: "*", Resource: "*"}, *review.Spec.ResourceAttributes, "one review, of everything")
	require.Empty(t, review.Spec.ResourceAttributes.Namespace, "in every namespace")

	said, unavailable := factValues(update)
	require.Equal(t, want, said)
	require.Empty(t, unavailable)
	require.NoError(t, resourcev2.ValidateConnectionMetadataUpdate(update), "the SDK admits the whole update")
}

// Each fact is its own: a read that is refused, that finds no such API, that fails or that never answers gives up its facts and no other. A refusal is nothing to tell the user: the fact is absent
// (removed, so that a value it had before does not outlive the permission), and a read that gave no answer is said to have failed, which keeps the last value, as stale.
func TestProbeFactsAreIndependent(t *testing.T) {
	tests := []struct {
		name   string
		change map[string]http.HandlerFunc
		// timeout replaces the time a read may take; the hung read is cut after it.
		timeout time.Duration
		// absent are the facts the update removes, unavailable the ones it says could not be observed. Every other fact of healthyFacts is said, with the value it has there.
		absent, unavailable []string
	}{
		{
			name:   "the user may do nothing but read the version",
			change: map[string]http.HandlerFunc{selfSubjectReviewsPath: refuse(403, metav1.StatusReasonForbidden), selfSubjectAccessReviewsPath: refuse(403, metav1.StatusReasonForbidden), "/api/v1/nodes": refuse(403, metav1.StatusReasonForbidden)},
			absent: []string{"kubernetes.user.name", "kubernetes.user.groups", "kubernetes.user.cluster_admin", "cloud.region", "cloud.availability_zone"},
		},
		{
			name:   "a server before 1.28 has no SelfSubjectReview",
			change: map[string]http.HandlerFunc{selfSubjectReviewsPath: refuse(404, metav1.StatusReasonNotFound)},
			absent: []string{"kubernetes.user.name", "kubernetes.user.groups"},
		},
		{
			name:        "one read fails",
			change:      map[string]http.HandlerFunc{selfSubjectAccessReviewsPath: brokenServer},
			unavailable: []string{"kubernetes.user.cluster_admin"},
		},
		{
			name:        "one read never answers: it is cut after its time and the others do not wait",
			change:      map[string]http.HandlerFunc{"/api/v1/nodes": hang},
			timeout:     400 * time.Millisecond,
			unavailable: []string{"cloud.region", "cloud.availability_zone"},
		},
		{
			name:        "the version cannot be read, and what follows from it is left out",
			change:      map[string]http.HandlerFunc{"/version": brokenServer},
			unavailable: []string{"kubernetes.server.version", "kubernetes.server.platform"},
			absent:      []string{"kubernetes.platform", "kubernetes.platform_source", "kubernetes.distribution", "kubernetes.distribution_source"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.timeout != 0 {
				defer func(previous time.Duration) { probeTimeout = previous }(probeTimeout)
				probeTimeout = tt.timeout
			}
			answers := healthyCluster()
			for path, answer := range tt.change {
				answers[path] = answer
			}
			server, client := newAPIServer(t, answers, rest.Config{})
			connection, catalog, want := healthyFacts(server)
			for _, key := range append(append([]string{}, tt.absent...), tt.unavailable...) {
				delete(want, key)
			}

			started := time.Now()
			update, err := connectionMetadata(context.Background(), connection, client, catalog)
			require.NoError(t, err)
			require.Less(t, time.Since(started), 3*time.Second, "no read waits for another")

			said, unavailable := factValues(update)
			require.Equal(t, want, said)
			require.ElementsMatch(t, tt.unavailable, slices.Collect(maps.Keys(unavailable)))
			for _, failure := range unavailable {
				require.Equal(t, "OBSERVATION_FAILED", failure.Code)
				require.NotContains(t, failure.Message, "secret", "what the server said does not reach the fact")
			}
			for _, key := range tt.absent {
				require.Contains(t, update.Remove, key)
				require.NotContains(t, update.Set, key, "a refusal is not a fact, not even an error one")
			}
			require.NoError(t, resourcev2.ValidateConnectionMetadataUpdate(update), "the SDK admits the whole update, whichever read failed")
		})
	}
}

// No value holds a secret: not what the connection's credentials are, not what the server says of the user (its UID, the extra attributes an authenticator adds: an access key, a token's identifier), of
// the Nodes (annotations, images, machine IDs, provider IDs) or of its own build, and not what it says when it refuses or fails.
func TestProbeFactsHoldNoSecrets(t *testing.T) {
	credentials := rest.Config{BearerToken: "secret-bearer"}
	for _, tt := range []struct {
		name    string
		answers map[string]http.HandlerFunc
	}{
		{"everything answers", healthyCluster()},
		{"everything fails", map[string]http.HandlerFunc{"/version": brokenServer, selfSubjectReviewsPath: brokenServer, selfSubjectAccessReviewsPath: brokenServer, "/api/v1/nodes": brokenServer}},
		{"everything is refused", map[string]http.HandlerFunc{"/version": refuse(403, metav1.StatusReasonForbidden), selfSubjectReviewsPath: refuse(403, metav1.StatusReasonForbidden), selfSubjectAccessReviewsPath: refuse(403, metav1.StatusReasonForbidden), "/api/v1/nodes": refuse(403, metav1.StatusReasonForbidden)}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			_, client := newAPIServer(t, tt.answers, credentials)
			connection := types.Connection{ID: "probe", Labels: map[string]interface{}{"aws.role": "arn:aws:iam::999999999999:role/secret-role", "aws.profile": "secret-profile"}}

			update, err := connectionMetadata(context.Background(), connection, client, catalogFacts{clusterUID: "uid-1"})
			require.NoError(t, err)

			encoded, err := json.Marshal(update)
			require.NoError(t, err)
			require.NotContains(t, strings.ToLower(string(encoded)), "secret")
			require.NotContains(t, string(encoded), "AKIA")
		})
	}
}

// The groups of a user are a list the SDK can take whatever an identity provider sends: at most 64, within 8 KiB, in the order the cluster gave them, and a name that is empty, too long or not text is
// left out, never cut.
func TestUserGroupsAreBoundedWhateverTheClusterSays(t *testing.T) {
	many := make([]string, 0, 500)
	for i := range 500 {
		many = append(many, fmt.Sprintf("group-%03d", i))
	}
	wide := make([]string, 0, 40)
	for i := range 40 {
		wide = append(wide, fmt.Sprintf("%04d", i)+strings.Repeat("g", 1000))
	}
	tests := []struct {
		name   string
		groups []string
		want   []any
	}{
		{name: "a few, in order", groups: []string{"devs", "system:authenticated"}, want: []any{"devs", "system:authenticated"}},
		{name: "none", groups: nil, want: []any{}},
		{name: "unfit names are left out", groups: []string{"", "a", strings.Repeat("x", 3000), "b\xff", "c"}, want: []any{"a", "c"}},
		{name: "at most 64", groups: many, want: firstOf(many, 64)},
		{name: "within 8 KiB", groups: wide, want: firstOf(wide, 8)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := userGroupsValue(tt.groups)
			require.Equal(t, tt.want, got)
			encoded, err := json.Marshal(got)
			require.NoError(t, err)
			require.LessOrEqual(t, len(encoded), 8<<10)
			require.NoError(t, resourcev2.ValidateConnectionMetadataUpdate(resourcev2.ConnectionMetadataUpdate{Set: map[string]resourcev2.ConnectionMetadataObservation{FactUserGroups: {State: "success", Value: got, ObservedAt: time.Now().UTC()}}}))
		})
	}
}

func firstOf(groups []string, n int) []any {
	first := make([]any, 0, n)
	for _, group := range groups[:n] {
		first = append(first, group)
	}
	return first
}

// The capabilities are the notable groups that are installed, by their short name, each once and in order. A group of the same domain that is not the one named (the custom and external metrics APIs
// are not the metrics API) is not it.
func TestCapabilitiesAreTheNotableGroupsByShortName(t *testing.T) {
	tests := []struct {
		name   string
		groups []string
		want   string
	}{
		{name: "none installed", groups: []string{"apps", "batch", "networking.k8s.io", "example.com"}, want: ""},
		{name: "one group of many names is one capability", groups: []string{"networking.istio.io", "security.istio.io", "telemetry.istio.io"}, want: "istio"},
		{name: "the whole table, sorted", groups: []string{
			"velero.io", "keda.sh", "eventing.keda.sh", "kyverno.io", "reports.kyverno.io", "tekton.dev", "triggers.tekton.dev", "serving.knative.dev", "eventing.knative.dev", "external-secrets.io", "generators.external-secrets.io",
			"apiextensions.crossplane.io", "pkg.crossplane.io", "karpenter.sh", "monitoring.coreos.com", "cert-manager.io", "acme.cert-manager.io", "argoproj.io", "metrics.k8s.io", "gateway.networking.k8s.io",
			"source.toolkit.fluxcd.io", "helm.toolkit.fluxcd.io", "networking.istio.io",
		}, want: "argo,cert-manager,crossplane,external-secrets,flux,gateway-api,istio,karpenter,keda,knative,kyverno,metrics,prometheus-operator,tekton,velero"},
		{name: "a sibling of the metrics API is not it", groups: []string{"custom.metrics.k8s.io", "external.metrics.k8s.io"}, want: ""},
		{name: "a domain that only ends alike is not under it", groups: []string{"notistio.io", "fakekeda.sh", "networking.k8s.io"}, want: ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.want, capabilitiesOf(tt.groups))
		})
	}
}

// What the catalog read at the start is said without a request: the UID of kube-system, and the notable groups that answer (a group that does not answer is not installed for this purpose; it is
// named by the other fact). A catalog refresh that installs a notable group says so by itself.
func TestConnectionFactsSayWhatTheCatalogAlreadyRead(t *testing.T) {
	recordHeals(t)
	f, p, route := newHealProvider(t)
	f.addAnsweringGroup(t, "argoproj.io")
	f.addAnsweringGroup(t, "metrics.k8s.io")
	f.addAnsweringGroup(t, "networking.istio.io")
	f.setDown("/apis/networking.istio.io/v1", true)
	_, err := p.StartConnection(context.Background(), route.Connection)
	require.NoError(t, err)

	snapshot, err := p.RefreshConnectionMetadata(context.Background(), route.Connection)
	require.NoError(t, err)
	require.Equal(t, "http-cluster-uid", snapshot.Entries[FactClusterUID].Value, "the identity the start read, with no new read of it")
	require.Equal(t, "argo,metrics", snapshot.Entries[FactCapabilities].Value)
	require.Contains(t, snapshot.Entries[FactUnavailableAPIGroups].Value.(map[string]any)["groups"], map[string]any{"groupVersion": "networking.istio.io/v1", "reason": "unavailable"})

	// The set of groups that do not answer stays as it was: only the notable groups that answer change.
	f.addAnsweringGroup(t, "kyverno.io")
	expireRefresh(p, route.Connection)
	_, err = p.Catalog(context.Background(), resourcev2.CatalogRequest{Route: route, Refresh: true})
	require.NoError(t, err)
	require.Eventually(t, func() bool {
		current, err := p.GetConnectionMetadata(context.Background(), route.Connection)
		return err == nil && current.Entries[FactCapabilities].Value == "argo,kyverno,metrics"
	}, 5*time.Second, 10*time.Millisecond, "the capabilities follow the installed catalog, without a refresh of the facts asked for")
}

// addAnsweringGroup serves a group of one version whose resources answer.
func (f *refreshHTTPFixture) addAnsweringGroup(t *testing.T, name string) {
	t.Helper()
	f.appendGroups(t, singleVersionGroup(name))
	document := mustJSON(t, metav1.APIResourceList{GroupVersion: name + "/v1", APIResources: []metav1.APIResource{{Name: "things", Kind: "Thing", Namespaced: true, Verbs: metav1.Verbs{"get", "list"}}}})
	f.mu.Lock()
	f.documents["/apis/"+name+"/v1"] = document
	f.mu.Unlock()
}
