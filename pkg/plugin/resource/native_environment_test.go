package resource

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/pem"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/omniview/kubernetes/pkg/plugin/helm"
	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	k8sfake "k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/rest"
	clienttesting "k8s.io/client-go/testing"
)

// envTestCA is a private certificate authority, as a cluster has.
type envTestCA struct {
	certificate *x509.Certificate
	key         *ecdsa.PrivateKey
	pem         []byte
}

func envSerial(t *testing.T) *big.Int {
	t.Helper()
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 100))
	require.NoError(t, err)
	return serial
}

func newEnvTestCA(t *testing.T, name string) envTestCA {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	template := &x509.Certificate{
		SerialNumber: envSerial(t), Subject: pkix.Name{CommonName: name},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
		IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	require.NoError(t, err)
	certificate, err := x509.ParseCertificate(der)
	require.NoError(t, err)
	return envTestCA{certificate: certificate, key: key, pem: pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})}
}

// fingerprint is the SHA-256 of the SubjectPublicKeyInfo, as the plugin declares it.
func (c envTestCA) fingerprint() string {
	sum := sha256.Sum256(c.certificate.RawSubjectPublicKeyInfo)
	return hex.EncodeToString(sum[:])
}

// leaf issues a serving certificate for 127.0.0.1 and the given names.
func (c envTestCA) leaf(t *testing.T, dnsNames ...string) tls.Certificate {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	template := &x509.Certificate{
		SerialNumber: envSerial(t), Subject: pkix.Name{CommonName: "apiserver"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
		KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		DNSNames: dnsNames, IPAddresses: []net.IP{net.ParseIP("127.0.0.1")},
	}
	der, err := x509.CreateCertificate(rand.Reader, template, c.certificate, &key.PublicKey, c.key)
	require.NoError(t, err)
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}
}

func envUID(id string) resourcev2.EnvironmentIdentity {
	return resourcev2.EnvironmentIdentity{Scheme: "kubernetes.namespace-uid.v1", ID: id, Strength: resourcev2.EnvironmentStrong, Exclusive: true}
}

func envRoot(ca envTestCA) resourcev2.EnvironmentIdentity {
	return resourcev2.EnvironmentIdentity{Scheme: "kubernetes.root-ca.v1", ID: ca.fingerprint(), Strength: resourcev2.EnvironmentStrong}
}

func envKubeSystem(uid string) *corev1.Namespace {
	return &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "kube-system", UID: types.UID(uid)}}
}

func envRootCAConfigMap(namespace string, bundle ...[]byte) *corev1.ConfigMap {
	var data []byte
	for _, certificate := range bundle {
		data = append(data, certificate...)
	}
	return &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{Name: "kube-root-ca.crt", Namespace: namespace},
		Data:       map[string]string{"ca.crt": string(data)},
	}
}

// envForbid makes the fake API server refuse a resource everywhere but in the named namespaces.
func envForbid(kube *k8sfake.Clientset, resource string, allowed ...string) {
	kube.PrependReactor("get", resource, func(action clienttesting.Action) (bool, runtime.Object, error) {
		for _, namespace := range allowed {
			if action.GetNamespace() == namespace {
				return false, nil, nil
			}
		}
		return true, nil, k8serrors.NewForbidden(schema.GroupResource{Resource: resource}, "", nil)
	})
}

// envFixture is one connection to one fake cluster, started through the real
// catalog path against discovery documents served over HTTP.
type envFixture struct {
	provider   *kubernetesProvider
	client     *clients.ClientSet
	ctx        context.Context
	connection sdktypes.Connection
}

func newEnvFixture(t *testing.T, connection sdktypes.Connection, kube *k8sfake.Clientset) *envFixture {
	t.Helper()
	_, client := newRefreshHTTPFixture(t)
	client.KubeClient = kube
	f := &envFixture{
		provider: refreshTestProvider(), client: client, connection: connection,
		ctx: resourcev2.WithSession(context.Background(), resourcev2.Session{Connection: &connection}),
	}
	t.Cleanup(func() { f.provider.retireNativeCatalog(connection.ID) })
	return f
}

func (f *envFixture) start() error {
	return f.provider.startNativeConnection(f.ctx, f.connection, f.client)
}

func (f *envFixture) catalog() resourcev2.Catalog {
	return f.provider.catalogs[f.connection.ID].catalog
}

func (f *envFixture) environment() []resourcev2.EnvironmentIdentity {
	for _, descriptor := range f.catalog().Types {
		if descriptor.Type == "k8s:/pods" {
			return descriptor.Environment
		}
	}
	return nil
}

// envDurablePod is the durable reference of a pod as the host derives it from the
// declared environment. The authority stands in for a host-issued one.
func envDurablePod(t *testing.T, environment []resourcev2.EnvironmentIdentity, authority, name, uid string) resourcev2.DurableReference {
	t.Helper()
	durable, err := resourcev2.NewDurableReference(environment, resourcev2.ResourceReference{
		Address:     resourcev2.ResourceAddress{Provider: "kubernetes", Authority: authority, Type: "k8s:/pods", Scope: []resourcev2.ScopeEntry{{Dimension: "namespace", Value: "default"}}, ID: name},
		Incarnation: &uid,
	})
	require.NoError(t, err)
	return durable
}

func envObjectKey(t *testing.T, durable resourcev2.DurableReference) string {
	t.Helper()
	key, err := durable.Address.Key()
	require.NoError(t, err)
	return key
}

func TestNativeCatalogDeclaresFingerprintsOnClusterBackedTypes(t *testing.T) {
	ca := newEnvTestCA(t, "cluster-ca")
	f := newEnvFixture(t, sdktypes.Connection{ID: "admin"}, k8sfake.NewClientset(envKubeSystem("cluster-uid-A"), envRootCAConfigMap("default", ca.pem)))
	require.NoError(t, f.start())
	want := []resourcev2.EnvironmentIdentity{envUID("cluster-uid-A"), envRoot(ca)}
	declared := map[string][]resourcev2.EnvironmentIdentity{}
	for _, descriptor := range f.catalog().Types {
		declared[descriptor.Type] = descriptor.Environment
	}
	require.Equal(t, want, declared["k8s:/pods"])
	require.Equal(t, want, declared["k8s:refresh.example/widgets"], "discovered custom resources belong to the cluster too")
	require.Equal(t, want, declared[helm.ReleaseType], "releases are stored in the cluster")
	for _, local := range []string{helm.RepositoryType, helm.ChartType, auditType, editorQueryType} {
		require.Nil(t, declared[local], "%s is not backed by the cluster and has no durable identity", local)
	}
	require.NoError(t, resourcev2.ValidateCatalog(f.catalog()))
	wire, err := resourcev2.ToProtoCatalog(f.catalog())
	require.NoError(t, err)
	decoded, err := resourcev2.FromProtoCatalog(wire)
	require.NoError(t, err)
	require.Equal(t, f.catalog(), decoded, "the declaration survives the plugin transport")

	// Each type owns its declaration.
	first, second := f.catalog().Types[0], f.catalog().Types[1]
	require.NotNil(t, first.Environment)
	first.Environment[0].ID = "changed"
	require.Equal(t, "cluster-uid-A", second.Environment[0].ID)
}

func TestNativeEnvironmentForCallersWhoCannotReadKubeSystem(t *testing.T) {
	ca := newEnvTestCA(t, "cluster-ca")
	t.Run("the root CA ConfigMap alone identifies the cluster", func(t *testing.T) {
		kube := k8sfake.NewClientset(envKubeSystem("cluster-uid-A"), envRootCAConfigMap("default", ca.pem))
		envForbid(kube, "namespaces")
		f := newEnvFixture(t, sdktypes.Connection{ID: "viewer"}, kube)
		require.NoError(t, f.start())
		require.Nil(t, f.provider.catalogs["viewer"].identityHint, "no UID was readable")
		require.Equal(t, []resourcev2.EnvironmentIdentity{envRoot(ca)}, f.environment())
		require.True(t, resourcev2.HasStrongEnvironment(f.environment()))
	})
	t.Run("a namespace-scoped user reads it in the namespace it has", func(t *testing.T) {
		kube := k8sfake.NewClientset(envKubeSystem("cluster-uid-A"), envRootCAConfigMap("team-a", ca.pem))
		envForbid(kube, "namespaces")
		envForbid(kube, "configmaps", "team-a")
		connection := sdktypes.Connection{ID: "team-a-user", Data: map[string]any{"namespace": "team-a"}}
		f := newEnvFixture(t, connection, kube)
		require.NoError(t, f.start())
		require.Equal(t, []resourcev2.EnvironmentIdentity{envRoot(ca)}, f.environment())
	})
	t.Run("a caller that can read nothing declares nothing", func(t *testing.T) {
		kube := k8sfake.NewClientset(envKubeSystem("cluster-uid-A"), envRootCAConfigMap("default", ca.pem))
		envForbid(kube, "namespaces")
		envForbid(kube, "configmaps")
		f := newEnvFixture(t, sdktypes.Connection{ID: "blind"}, kube)
		require.NoError(t, f.start())
		require.Nil(t, f.environment(), "an unidentified cluster gets no environment, and so no durable identity")
		require.NoError(t, resourcev2.ValidateCatalog(f.catalog()))
	})
}

func TestNativeEnvironmentOutlivesStopStartProfileEditRestartAndPermissionChanges(t *testing.T) {
	ca, other := newEnvTestCA(t, "ca-A"), newEnvTestCA(t, "ca-B")
	cluster := func() *k8sfake.Clientset {
		return k8sfake.NewClientset(envKubeSystem("cluster-uid-A"), envRootCAConfigMap("default", ca.pem))
	}
	admin := newEnvFixture(t, sdktypes.Connection{ID: "admin"}, cluster())
	require.NoError(t, admin.start())
	first := envDurablePod(t, admin.environment(), "local:first", "web-0", "pod-uid-1")
	firstKey := envObjectKey(t, first)
	same := func(t *testing.T, step string, environment []resourcev2.EnvironmentIdentity) {
		t.Helper()
		again := envDurablePod(t, environment, "local:"+step, "web-0", "pod-uid-1")
		require.True(t, resourcev2.SameEnvironment(first.Environment, again.Environment), step)
		require.Equal(t, firstKey, envObjectKey(t, again), step)
	}

	t.Run("stop and start", func(t *testing.T) {
		admin.provider.retireNativeCatalog(admin.connection.ID)
		require.NotContains(t, admin.provider.catalogs, admin.connection.ID)
		require.NoError(t, admin.start())
		same(t, "restart-connection", admin.environment())
	})
	t.Run("profile edit that retargets the endpoint and renames the connection", func(t *testing.T) {
		edited := newEnvFixture(t, sdktypes.Connection{ID: "renamed-context"}, cluster())
		require.NoError(t, edited.start())
		same(t, "edited", edited.environment())
	})
	t.Run("plugin restart", func(t *testing.T) {
		restarted := refreshTestProvider()
		require.NoError(t, restarted.startNativeConnection(admin.ctx, admin.connection, admin.client))
		defer restarted.retireNativeCatalog(admin.connection.ID)
		same(t, "restarted", restarted.catalogs[admin.connection.ID].catalog.Types[0].Environment)
	})
	t.Run("callers with less permission", func(t *testing.T) {
		kube := cluster()
		envForbid(kube, "namespaces")
		viewer := newEnvFixture(t, sdktypes.Connection{ID: "viewer"}, kube)
		require.NoError(t, viewer.start())
		same(t, "viewer", viewer.environment())

		uidOnly := k8sfake.NewClientset(envKubeSystem("cluster-uid-A"))
		reader := newEnvFixture(t, sdktypes.Connection{ID: "uid-reader"}, uidOnly)
		require.NoError(t, reader.start())
		same(t, "uid-reader", reader.environment())
		require.False(t, resourcev2.SameEnvironment(viewer.environment(), reader.environment()),
			"two partial declarations share nothing: the store joins them through the administrator's")
	})
	t.Run("CA rotation", func(t *testing.T) {
		successor := newEnvTestCA(t, "ca-A-successor")
		dual := newEnvFixture(t, sdktypes.Connection{ID: "dual"}, k8sfake.NewClientset(envKubeSystem("cluster-uid-A"), envRootCAConfigMap("default", ca.pem, successor.pem)))
		require.NoError(t, dual.start())
		require.Len(t, dual.environment(), 3, "the UID and one fingerprint per certificate")
		same(t, "dual-trust", dual.environment())
		rotated := newEnvFixture(t, sdktypes.Connection{ID: "rotated"}, k8sfake.NewClientset(envKubeSystem("cluster-uid-A"), envRootCAConfigMap("default", successor.pem)))
		require.NoError(t, rotated.start())
		same(t, "rotated", rotated.environment())
		require.True(t, resourcev2.SameEnvironment(dual.environment(), rotated.environment()))
	})
	t.Run("another cluster", func(t *testing.T) {
		stranger := newEnvFixture(t, sdktypes.Connection{ID: "admin"}, k8sfake.NewClientset(envKubeSystem("cluster-uid-B"), envRootCAConfigMap("default", other.pem)))
		require.NoError(t, stranger.start())
		// The same name, namespace and pod UID: only the cluster differs.
		different := envDurablePod(t, stranger.environment(), "local:first", "web-0", "pod-uid-1")
		require.False(t, resourcev2.SameEnvironment(first.Environment, different.Environment))
	})
	t.Run("clusters that share a CA but not a UID", func(t *testing.T) {
		// minikube profiles on one machine share a root CA.
		profile := newEnvFixture(t, sdktypes.Connection{ID: "profile-two"}, k8sfake.NewClientset(envKubeSystem("cluster-uid-B"), envRootCAConfigMap("default", ca.pem)))
		require.NoError(t, profile.start())
		require.False(t, resourcev2.SameEnvironment(first.Environment, profile.environment()), "the exclusive namespace UID vetoes the shared CA")
	})
	t.Run("a recreated pod keeps its identity and changes its incarnation", func(t *testing.T) {
		recreated := envDurablePod(t, admin.environment(), "local:first", "web-0", "pod-uid-2")
		require.Equal(t, firstKey, envObjectKey(t, recreated))
		require.NotEqual(t, first, recreated)
		require.Equal(t, "pod-uid-2", *recreated.Incarnation)
	})
}

func TestNativeRootCAFingerprints(t *testing.T) {
	one, two := newEnvTestCA(t, "one"), newEnvTestCA(t, "two")
	bundle := append([]byte("text before the first block\n"), one.pem...)
	bundle = append(bundle, two.pem...)
	bundle = append(bundle, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: []byte("not a certificate")})...)
	bundle = append(bundle, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: []byte("not DER")})...)
	got := nativeRootCAFingerprints(bundle, resourcev2.EnvironmentStrong)
	require.ElementsMatch(t, []resourcev2.EnvironmentIdentity{envRoot(one), envRoot(two)}, got, "one fingerprint per certificate; junk is skipped")
	require.Less(t, got[0].ID, got[1].ID, "ordered by value")
	require.Len(t, nativeRootCAFingerprints(append(append([]byte(nil), one.pem...), one.pem...), resourcev2.EnvironmentStrong), 1, "a repeated certificate is one fingerprint")
	require.Empty(t, nativeRootCAFingerprints([]byte("garbage"), resourcev2.EnvironmentStrong))

	var many []byte
	for i := range nativeMaxRootCAs + 4 {
		many = append(many, newEnvTestCA(t, strings.Repeat("c", i+1)).pem...)
	}
	require.Len(t, nativeRootCAFingerprints(many, resourcev2.EnvironmentStrong), nativeMaxRootCAs, "a bundle is bounded")

	// The key, not the certificate: the same key renewed keeps its fingerprint.
	renewed := envTestCA{certificate: one.certificate, key: one.key}
	template := &x509.Certificate{
		SerialNumber: envSerial(t), Subject: pkix.Name{CommonName: "one, renewed"},
		NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(2 * time.Hour),
		IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &one.key.PublicKey, one.key)
	require.NoError(t, err)
	renewed.certificate, err = x509.ParseCertificate(der)
	require.NoError(t, err)
	require.Equal(t, one.fingerprint(), renewed.fingerprint())
	require.NotEqual(t, one.certificate.Raw, renewed.certificate.Raw)
}

func TestNativeRootCAConfigMapReadFailures(t *testing.T) {
	ca := newEnvTestCA(t, "cluster-ca")
	t.Run("a namespace that forbids it does not stop the search", func(t *testing.T) {
		kube := k8sfake.NewClientset(envRootCAConfigMap("second", ca.pem))
		envForbid(kube, "configmaps", "second")
		got, err := nativeRootCAConfigMapFingerprints(context.Background(), kube, []string{"first", "second"})
		require.NoError(t, err)
		require.Equal(t, []resourcev2.EnvironmentIdentity{envRoot(ca)}, got)
	})
	t.Run("nothing readable is not an error", func(t *testing.T) {
		got, err := nativeRootCAConfigMapFingerprints(context.Background(), k8sfake.NewClientset(), []string{"first", "second"})
		require.NoError(t, err)
		require.Empty(t, got)
	})
	t.Run("a transient failure is UNAVAILABLE, never a missing fingerprint", func(t *testing.T) {
		recordRetries(t, 3)
		kube := k8sfake.NewClientset(envRootCAConfigMap("first", ca.pem))
		kube.PrependReactor("get", "configmaps", func(clienttesting.Action) (bool, runtime.Object, error) {
			return true, nil, k8serrors.NewServiceUnavailable("down")
		})
		_, err := nativeRootCAConfigMapFingerprints(context.Background(), kube, []string{"first"})
		require.Equal(t, "UNAVAILABLE", resourcev2.ErrorCode(err))
		require.True(t, k8serrors.IsServiceUnavailable(err), "the cause stays inspectable: %v", err)
	})
	t.Run("candidate namespaces start with the caller's own and are bounded", func(t *testing.T) {
		values := []string{"b", "c", "d", "e", "f", "g"}
		scope := resourcev2.QueryScope{{Dimension: "namespace", Match: resourcev2.ScopeOneOf, Values: &values}}
		connection := sdktypes.Connection{ID: "x", Data: map[string]any{"namespace": "mine"}}
		ctx := resourcev2.WithSession(context.Background(), resourcev2.Session{Connection: &connection})
		require.Equal(t, []string{"mine", "b", "c", "d", "e"}, nativeRootCANamespaces(ctx, scope))
		require.Equal(t, []string{"default", "kube-system", "kube-public"}, nativeRootCANamespaces(context.Background(), resourcev2.QueryScope{{Dimension: "namespace", Match: resourcev2.ScopeAny}}))
	})
}

func TestNativeClusterPropertyFingerprint(t *testing.T) {
	gvr := schema.GroupVersionResource{Group: "about.k8s.io", Version: "v1beta1", Resource: "clusterproperties"}
	property := func(name, value string) *unstructured.Unstructured {
		return &unstructured.Unstructured{Object: map[string]any{
			"apiVersion": "about.k8s.io/v1beta1", "kind": "ClusterProperty",
			"metadata": map[string]any{"name": name}, "spec": map[string]any{"value": value},
		}}
	}
	read := func(t *testing.T, objects ...runtime.Object) []resourcev2.EnvironmentIdentity {
		t.Helper()
		got, err := nativeClusterPropertyFingerprint(context.Background(), dynamicfake.NewSimpleDynamicClient(runtime.NewScheme(), objects...), gvr)
		require.NoError(t, err)
		return got
	}
	scheme := "kubernetes.cluster-property.v1"
	uuid := "218FC5A9-A5F1-4B54-AA05-46717D0AB26D"
	require.Equal(t, []resourcev2.EnvironmentIdentity{{Scheme: scheme, ID: strings.ToLower(uuid), Strength: resourcev2.EnvironmentStrong}},
		read(t, property("id.k8s.io", uuid)), "a UUID is unique beyond a ClusterSet")
	require.Equal(t, []resourcev2.EnvironmentIdentity{{Scheme: scheme, ID: "cluster-1", Strength: resourcev2.EnvironmentWeak}},
		read(t, property("cluster.clusterset.k8s.io", "cluster-1")), "a name is unique only within a ClusterSet, and a hint at most; the KEP's other name is read too")
	require.Equal(t, "from-id", read(t, property("id.k8s.io", "from-id"), property("cluster.clusterset.k8s.io", "from-clusterset"))[0].ID, "id.k8s.io is read first")
	require.Empty(t, read(t))
	require.Empty(t, read(t, property("id.k8s.io", "")))

	forbidden := dynamicfake.NewSimpleDynamicClient(runtime.NewScheme(), property("id.k8s.io", uuid))
	forbidden.PrependReactor("get", "clusterproperties", func(clienttesting.Action) (bool, runtime.Object, error) {
		return true, nil, k8serrors.NewForbidden(schema.GroupResource{Resource: "clusterproperties"}, "id.k8s.io", nil)
	})
	got, err := nativeClusterPropertyFingerprint(context.Background(), forbidden, gvr)
	require.NoError(t, err)
	require.Empty(t, got)
	got, err = nativeClusterPropertyFingerprint(context.Background(), nil, gvr)
	require.NoError(t, err)
	require.Empty(t, got, "no dynamic client, no request")
}

func TestNativeTLSRootFingerprintClassifiesThePrivateClusterCA(t *testing.T) {
	ca := newEnvTestCA(t, "cluster-ca")
	serve := func(t *testing.T, leaf tls.Certificate) (*http.Client, *rest.Config) {
		t.Helper()
		server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(`{"major":"1"}`)) }))
		server.TLS = &tls.Config{Certificates: []tls.Certificate{leaf}}
		server.StartTLS()
		t.Cleanup(server.Close)
		config := &rest.Config{Host: server.URL, TLSClientConfig: rest.TLSClientConfig{CAData: ca.pem}}
		client, err := rest.HTTPClientFor(config)
		require.NoError(t, err)
		return client, config
	}
	private := func([]*x509.Certificate) bool { return false }
	trusted := func([]*x509.Certificate) bool { return true }
	root := func(strength string) *resourcev2.EnvironmentIdentity {
		return &resourcev2.EnvironmentIdentity{Scheme: "kubernetes.root-ca.v1", ID: ca.fingerprint(), Strength: strength}
	}

	t.Run("a private CA and the in-cluster service name identify the cluster", func(t *testing.T) {
		client, config := serve(t, ca.leaf(t, "kubernetes.default.svc"))
		got, err := nativeTLSRootFingerprint(context.Background(), client, config, private)
		require.NoError(t, err)
		require.Equal(t, root(resourcev2.EnvironmentStrong), got)
	})
	t.Run("a chain without the service name, such as an access proxy's, is a hint", func(t *testing.T) {
		client, config := serve(t, ca.leaf(t, "proxy.corp.example"))
		got, err := nativeTLSRootFingerprint(context.Background(), client, config, private)
		require.NoError(t, err)
		require.Equal(t, root(resourcev2.EnvironmentWeak), got)
	})
	t.Run("a root the operating system trusts is a hint", func(t *testing.T) {
		client, config := serve(t, ca.leaf(t, "kubernetes.default.svc"))
		got, err := nativeTLSRootFingerprint(context.Background(), client, config, trusted)
		require.NoError(t, err)
		require.Equal(t, root(resourcev2.EnvironmentWeak), got)
	})
	t.Run("disabled verification leaves no verified chain", func(t *testing.T) {
		client, config := serve(t, ca.leaf(t, "kubernetes.default.svc"))
		insecure := &rest.Config{Host: config.Host, TLSClientConfig: rest.TLSClientConfig{Insecure: true}}
		got, err := nativeTLSRootFingerprint(context.Background(), client, insecure, private)
		require.NoError(t, err)
		require.Nil(t, got)
	})
	t.Run("plain HTTP has no TLS state", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(`{}`)) }))
		t.Cleanup(server.Close)
		config := &rest.Config{Host: server.URL}
		client, err := rest.HTTPClientFor(config)
		require.NoError(t, err)
		got, err := nativeTLSRootFingerprint(context.Background(), client, config, private)
		require.NoError(t, err)
		require.Nil(t, got)
	})
	t.Run("without a client or configuration there is nothing to read", func(t *testing.T) {
		got, err := nativeTLSRootFingerprint(context.Background(), nil, nil, private)
		require.NoError(t, err)
		require.Nil(t, got)
	})
	t.Run("the operating system does not trust a private CA", func(t *testing.T) {
		leaf, err := x509.ParseCertificate(ca.leaf(t, "kubernetes.default.svc").Certificate[0])
		require.NoError(t, err)
		require.False(t, nativeTrustedBySystem([]*x509.Certificate{leaf, ca.certificate}))
	})
}

func TestNativeConfigurationHintsAreWeakAndNeverIdentify(t *testing.T) {
	arn := "arn:aws:eks:us-east-1:111122223333:cluster/prod"
	ctx := func(connection sdktypes.Connection) context.Context {
		return resourcev2.WithSession(context.Background(), resourcev2.Session{Connection: &connection})
	}
	hints := nativeConfigurationHints(ctx(sdktypes.Connection{ID: arn}))
	require.Equal(t, []resourcev2.EnvironmentIdentity{{Scheme: "aws.eks-cluster-arn.v1", ID: arn, Strength: resourcev2.EnvironmentWeak}}, hints)
	require.Equal(t, hints, nativeConfigurationHints(ctx(sdktypes.Connection{ID: "context-name", Data: map[string]any{"cluster": arn}})))
	require.Empty(t, nativeConfigurationHints(ctx(sdktypes.Connection{ID: "prod"})))
	require.Empty(t, nativeConfigurationHints(context.Background()))

	environment := nativeClusterEnvironment(nil, nil, hints)
	require.Equal(t, hints, environment)
	require.False(t, resourcev2.HasStrongEnvironment(environment), "a hint from local configuration is never an identity")
	_, err := resourcev2.NewDurableReference(environment, resourcev2.ResourceReference{
		Address: resourcev2.ResourceAddress{Provider: "kubernetes", Authority: "a", Type: "k8s:/pods", Scope: []resourcev2.ScopeEntry{}, ID: "web-0"},
	})
	require.Error(t, err)
}

func TestNativeClusterEnvironmentBuildsASaneDeclaration(t *testing.T) {
	ca := newEnvTestCA(t, "cluster-ca")
	hint := &resourcev2.NativeAuthorityHint{Scheme: "kubernetes.namespace-uid.v1", ID: "cluster-uid-A", Continuity: resourcev2.ContinuityConnectionLocal}
	weakRoot := resourcev2.EnvironmentIdentity{Scheme: "kubernetes.root-ca.v1", ID: ca.fingerprint(), Strength: resourcev2.EnvironmentWeak}
	got := nativeClusterEnvironment(hint,
		[]resourcev2.EnvironmentIdentity{weakRoot, envRoot(ca), {Scheme: "kubernetes.cluster-property.v1", ID: "a\nb", Strength: resourcev2.EnvironmentWeak}},
		[]resourcev2.EnvironmentIdentity{{Scheme: "aws.eks-cluster-arn.v1", ID: strings.Repeat("x", resourcev2.MaxEnvironmentIDBytes+1), Strength: resourcev2.EnvironmentWeak}})
	require.Equal(t, []resourcev2.EnvironmentIdentity{envUID("cluster-uid-A"), envRoot(ca)}, got,
		"the strongest repeat wins, invalid remote values are dropped, and the result is ordered")
	require.Nil(t, nativeClusterEnvironment(nil, nil, nil))
	catalog := resourcev2.Catalog{Provider: "kubernetes", Revision: "r", Coverage: resourcev2.Coverage{Kind: "complete", Paths: []string{}}, Types: []resourcev2.ResourceType{{
		Type: "t", IdentityDimensions: []resourcev2.Dimension{}, QueryDimensions: []resourcev2.Dimension{},
		Representations: []resourcev2.Representation{}, Capabilities: []resourcev2.Capability{}, Environment: got,
	}}}
	require.NoError(t, resourcev2.ValidateCatalog(catalog))
}
