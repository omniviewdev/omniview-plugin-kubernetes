package resource

import (
	"context"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

// A cluster declares its environment as a set of fingerprints, because what a
// caller may read varies: most users cannot read the kube-system namespace, and
// every one of them can usually read the ConfigMap that publishes the cluster's
// root CA. Each fingerprint is a fact about the cluster itself. None comes from a
// kubeconfig path, a context or connection name, an endpoint or a credential.
const (
	// nativeClusterIdentityScheme is the UID of the kube-system namespace. It is
	// both the connection-local authority hint's scheme and an exclusive
	// environment fingerprint: a cluster has one, and kube-system cannot be deleted.
	nativeClusterIdentityScheme = "kubernetes.namespace-uid.v1"
	// nativeRootCAScheme is the SHA-256 of the SubjectPublicKeyInfo of one
	// certificate in the cluster's root CA bundle, one fingerprint per certificate
	// so a rotation that publishes old and new together keeps continuity.
	nativeRootCAScheme = "kubernetes.root-ca.v1"
	// nativeClusterPropertyScheme is the About API's cluster ID.
	nativeClusterPropertyScheme = "kubernetes.cluster-property.v1"
	// nativeEKSClusterARNScheme is read from local configuration only.
	nativeEKSClusterARNScheme = "aws.eks-cluster-arn.v1"

	nativeRootCAConfigMap     = "kube-root-ca.crt"
	nativeRootCAConfigMapKey  = "ca.crt"
	nativeClusterPropertyType = "k8s:about.k8s.io/clusterproperties"
	// nativeAPIServerServiceName is in the serving certificate of every
	// kube-apiserver for in-cluster clients; a TLS-inspecting proxy or a public CA
	// does not issue it.
	nativeAPIServerServiceName = "kubernetes.default.svc"
	nativeMaxRootCAs           = 8
	nativeMaxRootCANamespaces  = 5
)

// The About API's well-known cluster ID property is cluster.clusterset.k8s.io;
// the KEP also discusses id.k8s.io for it. Read both, in this order.
var nativeClusterPropertyNames = []string{"id.k8s.io", "cluster.clusterset.k8s.io"}

var nativeUUID = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// nativeIdentity is what one catalog observation established about its cluster.
type nativeIdentity struct {
	hint        *resourcev2.NativeAuthorityHint
	environment []resourcev2.EnvironmentIdentity
}

// parts is nil safe: a catalog assembled without identity declares none.
func (i *nativeIdentity) parts() (*resourcev2.NativeAuthorityHint, []resourcev2.EnvironmentIdentity) {
	if i == nil {
		return nil, nil
	}
	return i.hint, i.environment
}

// cloneNativeEnvironment gives each type its own declaration to own.
func cloneNativeEnvironment(environment []resourcev2.EnvironmentIdentity) []resourcev2.EnvironmentIdentity {
	return slices.Clone(environment)
}

// nativeClusterEnvironment merges the namespace UID, the facts read once at
// start and the local hints into one declaration: ordered, without repeats (the
// strongest wins) and without any value the SDK would reject. A connection that
// can read nothing declares nothing.
func nativeClusterEnvironment(hint *resourcev2.NativeAuthorityHint, facts, hints []resourcev2.EnvironmentIdentity) []resourcev2.EnvironmentIdentity {
	strongest := make(map[[2]string]resourcev2.EnvironmentIdentity, len(facts)+len(hints)+1)
	add := func(fingerprint resourcev2.EnvironmentIdentity) {
		if !nativeEnvironmentValue(fingerprint.Scheme) || !nativeEnvironmentValue(fingerprint.ID) {
			return
		}
		pair := [2]string{fingerprint.Scheme, fingerprint.ID}
		if existing, found := strongest[pair]; found && existing.Strength == resourcev2.EnvironmentStrong {
			return
		}
		strongest[pair] = fingerprint
	}
	if hint != nil {
		add(resourcev2.EnvironmentIdentity{Scheme: nativeClusterIdentityScheme, ID: hint.ID, Strength: resourcev2.EnvironmentStrong, Exclusive: true})
	}
	for _, fingerprint := range facts {
		add(fingerprint)
	}
	for _, fingerprint := range hints {
		add(fingerprint)
	}
	if len(strongest) == 0 {
		return nil
	}
	environment := make([]resourcev2.EnvironmentIdentity, 0, len(strongest))
	for _, fingerprint := range strongest {
		environment = append(environment, fingerprint)
	}
	slices.SortFunc(environment, func(a, b resourcev2.EnvironmentIdentity) int {
		if order := strings.Compare(a.Scheme, b.Scheme); order != 0 {
			return order
		}
		return strings.Compare(a.ID, b.ID)
	})
	return environment
}

// nativeEnvironmentValue admits what the SDK admits. A value taken from a remote
// server must never make the whole catalog invalid.
func nativeEnvironmentValue(value string) bool {
	return value != "" && len(value) <= resourcev2.MaxEnvironmentIDBytes && utf8.ValidString(value) &&
		!strings.ContainsFunc(value, func(r rune) bool { return r < 0x20 || r == 0x7f })
}

func nativeUnavailable(message string, err error) error {
	return &resourcev2.ResourceOperationError{Err: err, Code: "UNAVAILABLE", Message: message}
}

// nativeEnvironmentFacts reads the facts about the cluster itself that the caller
// can read, other than the namespace UID the catalog already reads. A transient
// failure is UNAVAILABLE, never a missing fingerprint, so callers keep the
// identity they hold instead of treating a missing answer as a different cluster.
func nativeEnvironmentFacts(ctx context.Context, client *clients.ClientSet, bindings map[string]nativeType, scope resourcev2.QueryScope) ([]resourcev2.EnvironmentIdentity, error) {
	roots, err := nativeRootCAConfigMapFingerprints(ctx, client.KubeClient, nativeRootCANamespaces(ctx, scope))
	if err != nil {
		return nil, err
	}
	facts := roots
	if binding, installed := bindings[nativeClusterPropertyType]; installed {
		property, propertyErr := nativeClusterPropertyFingerprint(ctx, client.DynamicClient, binding.GVR)
		if propertyErr != nil {
			return nil, propertyErr
		}
		facts = append(facts, property...)
	}
	if len(roots) == 0 {
		root, rootErr := nativeTLSRootFingerprint(ctx, client.HTTPClient, client.RESTConfig, nativeTrustedBySystem)
		if rootErr != nil {
			return nil, rootErr
		}
		if root != nil {
			facts = append(facts, *root)
		}
	}
	return facts, nil
}

// nativeRootCANamespaces lists where to look for the root CA ConfigMap, which the
// controller manager publishes in every namespace (v1.20 and later): the
// connection's own namespace and the namespaces it may watch first, because a
// namespace-scoped user can read only those, then the system namespaces.
func nativeRootCANamespaces(ctx context.Context, scope resourcev2.QueryScope) []string {
	var candidates []string
	if session, ok := resourcev2.SessionFromContext(ctx); ok && session.Connection != nil {
		if namespace, _ := session.Connection.Data["namespace"].(string); namespace != "" {
			candidates = append(candidates, namespace)
		}
	}
	for _, constraint := range scope {
		if constraint.Dimension == "namespace" && constraint.Match == resourcev2.ScopeOneOf && constraint.Values != nil {
			candidates = append(candidates, *constraint.Values...)
		}
	}
	candidates = append(candidates, "default", "kube-system", "kube-public")
	namespaces := make([]string, 0, nativeMaxRootCANamespaces)
	for _, namespace := range candidates {
		if namespace == "" || slices.Contains(namespaces, namespace) {
			continue
		}
		namespaces = append(namespaces, namespace)
		if len(namespaces) == nativeMaxRootCANamespaces {
			break
		}
	}
	return namespaces
}

// nativeRootCAConfigMapFingerprints reads the root CA bundle from the first
// namespace where the caller can. The default view role reads ConfigMaps, so
// most callers can. A namespace that forbids or lacks it is skipped, since
// another may allow it.
func nativeRootCAConfigMapFingerprints(ctx context.Context, client kubernetes.Interface, namespaces []string) ([]resourcev2.EnvironmentIdentity, error) {
	if client == nil {
		return nil, nil
	}
	for _, namespace := range namespaces {
		var bundle string
		err := retryNativeRequest(ctx, func() error {
			configMap, err := client.CoreV1().ConfigMaps(namespace).Get(ctx, nativeRootCAConfigMap, metav1.GetOptions{})
			if err == nil {
				bundle = configMap.Data[nativeRootCAConfigMapKey]
			}
			return err
		})
		if ctxErr := ctx.Err(); ctxErr != nil {
			return nil, ctxErr
		}
		if nativeTransientReason(err) != "" {
			return nil, nativeUnavailable("Native Kubernetes root CA could not be read; try again", err)
		}
		if err != nil {
			continue
		}
		if fingerprints := nativeRootCAFingerprints([]byte(bundle), resourcev2.EnvironmentStrong); len(fingerprints) > 0 {
			return fingerprints, nil
		}
	}
	return nil, nil
}

// nativeRootCAFingerprints fingerprints every certificate in a PEM bundle, one
// fingerprint each, ordered and without repeats, at most nativeMaxRootCAs.
func nativeRootCAFingerprints(bundle []byte, strength string) []resourcev2.EnvironmentIdentity {
	seen := make(map[string]bool)
	var fingerprints []resourcev2.EnvironmentIdentity
	for rest := bundle; len(rest) > 0; {
		var block *pem.Block
		block, rest = pem.Decode(rest)
		if block == nil {
			break
		}
		if block.Type != "CERTIFICATE" {
			continue
		}
		certificate, err := x509.ParseCertificate(block.Bytes)
		if err != nil {
			continue
		}
		fingerprint := nativeRootCAFingerprint(certificate, strength)
		if !seen[fingerprint.ID] {
			seen[fingerprint.ID] = true
			fingerprints = append(fingerprints, fingerprint)
		}
	}
	slices.SortFunc(fingerprints, func(a, b resourcev2.EnvironmentIdentity) int { return strings.Compare(a.ID, b.ID) })
	if len(fingerprints) > nativeMaxRootCAs {
		fingerprints = fingerprints[:nativeMaxRootCAs]
	}
	return fingerprints
}

// nativeRootCAFingerprint hashes the public key, not the certificate, so a CA
// certificate renewed with the same key keeps its fingerprint.
func nativeRootCAFingerprint(certificate *x509.Certificate, strength string) resourcev2.EnvironmentIdentity {
	sum := sha256.Sum256(certificate.RawSubjectPublicKeyInfo)
	return resourcev2.EnvironmentIdentity{Scheme: nativeRootCAScheme, ID: hex.EncodeToString(sum[:]), Strength: strength}
}

// nativeClusterPropertyFingerprint reads the About API's cluster ID when the
// ClusterProperty CRD is installed. That ID is unique only within a ClusterSet
// and may be a human-readable name, so it identifies only when it is a UUID.
func nativeClusterPropertyFingerprint(ctx context.Context, client dynamic.Interface, resource schema.GroupVersionResource) ([]resourcev2.EnvironmentIdentity, error) {
	if client == nil {
		return nil, nil
	}
	for _, name := range nativeClusterPropertyNames {
		var property *unstructured.Unstructured
		err := retryNativeRequest(ctx, func() error {
			var getErr error
			property, getErr = client.Resource(resource).Get(ctx, name, metav1.GetOptions{})
			return getErr
		})
		if ctxErr := ctx.Err(); ctxErr != nil {
			return nil, ctxErr
		}
		if nativeTransientReason(err) != "" {
			return nil, nativeUnavailable("Native Kubernetes cluster property could not be read; try again", err)
		}
		if err != nil {
			continue
		}
		value, _, _ := unstructured.NestedString(property.Object, "spec", "value")
		if value == "" {
			continue
		}
		strength := resourcev2.EnvironmentWeak
		if nativeUUID.MatchString(value) {
			strength, value = resourcev2.EnvironmentStrong, strings.ToLower(value)
		}
		return []resourcev2.EnvironmentIdentity{{Scheme: nativeClusterPropertyScheme, ID: value, Strength: strength}}, nil
	}
	return nil, nil
}

// nativeTLSRootFingerprint fingerprints the root of the TLS chain the API server
// presents, for a caller that can read no ConfigMap. The chain is verified
// against the client's own configured CA, so the root is only as trustworthy as
// that configuration, and a public CA, a corporate CA or a TLS-inspecting proxy
// would produce the same kind of chain. The root identifies the cluster, strongly,
// only when both hold: the serving certificate carries the in-cluster service name
// kubernetes.default.svc, which no public CA issues and no access proxy mints, and
// the root is not trusted by the operating system. Otherwise it is a weak hint.
// With verification disabled there is no verified chain and no fingerprint.
func nativeTLSRootFingerprint(ctx context.Context, httpClient *http.Client, config *rest.Config, trustedBySystem func([]*x509.Certificate) bool) (*resourcev2.EnvironmentIdentity, error) {
	if httpClient == nil || config == nil || config.Host == "" || config.Insecure {
		return nil, nil
	}
	endpoint, _, err := rest.DefaultServerURL(config.Host, "", schema.GroupVersion{}, true)
	if err != nil {
		return nil, nil //nolint:nilerr // An unusable host has no TLS state to read.
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.JoinPath("version").String(), nil)
	if err != nil {
		return nil, nil //nolint:nilerr // An unusable request has no TLS state to read.
	}
	response, err := httpClient.Do(request)
	if err != nil {
		return nil, ctx.Err()
	}
	defer func() { _ = response.Body.Close() }()
	if response.TLS == nil || len(response.TLS.VerifiedChains) == 0 {
		return nil, nil
	}
	chain := response.TLS.VerifiedChains[0]
	strength := resourcev2.EnvironmentWeak
	if slices.Contains(chain[0].DNSNames, nativeAPIServerServiceName) && !trustedBySystem(chain) {
		strength = resourcev2.EnvironmentStrong
	}
	fingerprint := nativeRootCAFingerprint(chain[len(chain)-1], strength)
	return &fingerprint, nil
}

// nativeTrustedBySystem reports whether the operating system's trust store
// accepts the chain. Only a clear unknown authority proves the root is private;
// any other outcome counts as trusted, which is the conservative one.
func nativeTrustedBySystem(chain []*x509.Certificate) bool {
	intermediates := x509.NewCertPool()
	for _, certificate := range chain[1:] {
		intermediates.AddCert(certificate)
	}
	_, err := chain[0].Verify(x509.VerifyOptions{Intermediates: intermediates})
	var unknown x509.UnknownAuthorityError
	return !errors.As(err, &unknown)
}

// nativeConfigurationHints returns identifiers that only local configuration
// supplies. A kubeconfig names its cluster however its author likes, so they are
// weak: a hint for correlating with another system, never an identity.
func nativeConfigurationHints(ctx context.Context) []resourcev2.EnvironmentIdentity {
	session, ok := resourcev2.SessionFromContext(ctx)
	if !ok || session.Connection == nil {
		return nil
	}
	connection := session.Connection
	cluster, _ := connection.Data["cluster"].(string)
	label, _ := connection.Labels["cluster"].(string)
	for _, candidate := range []string{connection.ID, cluster, label} {
		if eksClusterARN.MatchString(candidate) {
			return []resourcev2.EnvironmentIdentity{{Scheme: nativeEKSClusterARNScheme, ID: candidate, Strength: resourcev2.EnvironmentWeak}}
		}
	}
	return nil
}
