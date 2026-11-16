package resource

import resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"

const (
	// nativeClusterIdentityScheme names the kube-system namespace UID as a
	// connection-local authority hint. The host may retire an authority built from
	// it on any stop, profile edit or restart.
	nativeClusterIdentityScheme = "kubernetes.namespace-uid.v1"
	// nativeClusterEnvironmentScheme names the same fact as a durable environment
	// identity. It is versioned on its own: changing what the ID means must issue
	// a new scheme, so histories recorded under the old meaning never merge.
	nativeClusterEnvironmentScheme = "kubernetes.namespace-uid.v1"
)

// nativeClusterEnvironment declares the durable identity of the cluster behind a
// catalog: the UID the API server recorded for its kube-system namespace when it
// created the cluster. That UID is the same for every kubeconfig context, user,
// endpoint, port-forward and proxy that reaches the cluster, and it is the same
// after a connection stops and starts, a profile is edited or Omniview restarts.
// A cluster recreated from scratch gets a new one.
//
// It reads the fact the authority hint already read, and is never derived from a
// kubeconfig path, a context or connection name, an endpoint URL or a credential.
// The environment is unknown (nil) when the UID could not be read, for example
// without permission to get the kube-system namespace; the catalog then declares
// no durable identity rather than guessing one.
//
// Known limit: clusters built from the same etcd snapshot (a restore, or a copy
// used as a test cluster) keep the same namespace UID and so share an
// environment. The host treats equal environments as correlation evidence only,
// never as permission to share anything.
func nativeClusterEnvironment(hint *resourcev2.NativeAuthorityHint) *resourcev2.EnvironmentIdentity {
	if hint == nil {
		return nil
	}
	return &resourcev2.EnvironmentIdentity{Scheme: nativeClusterEnvironmentScheme, ID: hint.ID}
}
