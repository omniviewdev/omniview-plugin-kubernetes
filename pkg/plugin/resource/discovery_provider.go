package resource

import (
	"context"
	"strings"

	"go.uber.org/zap"

	"github.com/omniview/kubernetes/pkg/utils"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
)

// kubeDiscoveryProvider implements resource.DiscoveryProvider for Kubernetes.
// It discovers resource types (including CRDs) via the Kubernetes API discovery endpoint.
var _ resource.DiscoveryProvider = (*kubeDiscoveryProvider)(nil)

type kubeDiscoveryProvider struct {
	logger *zap.SugaredLogger
}

func (k *kubeDiscoveryProvider) Discover(_ context.Context, conn *types.Connection) ([]resource.ResourceMeta, error) {
	bundle, err := utils.KubeClientsFromConnection(conn)
	if err != nil {
		return nil, err
	}

	_, resourceLists, err := bundle.Discovery.ServerGroupsAndResources()
	if err != nil {
		// Partial results are common when some API groups are unavailable.
		// Log and continue with what we got.
		k.logger.Warnw("partial discovery result", "error", err)
	}

	var metas []resource.ResourceMeta
	for _, rl := range resourceLists {
		// Parse group/version from GroupVersion string (e.g., "apps/v1" or "v1").
		gv := rl.GroupVersion
		group, version := "", gv
		if i := strings.LastIndex(gv, "/"); i >= 0 {
			group, version = gv[:i], gv[i+1:]
		}

		// Map empty group to "core" to match our convention.
		if group == "" {
			group = "core"
		}

		// Normalize FQDN K8s group names to short names that match static registrations.
		group = normalizeGroup(group)

		for _, r := range rl.APIResources {
			// Skip subresources (e.g., "pods/log", "pods/exec").
			if strings.Contains(r.Name, "/") {
				continue
			}

			// Only include resources that support list+watch — non-watchable
			// resources (e.g., TokenReview, SubjectAccessReview) are excluded
			// so discovery-gated watch startup skips them.
			if !verbSliceContains(r.Verbs, "list") || !verbSliceContains(r.Verbs, "watch") {
				continue
			}

			metas = append(metas, resource.ResourceMeta{
				Group:   group,
				Version: version,
				Kind:    r.Kind,
			})
		}
	}

	return metas, nil
}

func (k *kubeDiscoveryProvider) OnConnectionRemoved(_ context.Context, _ *types.Connection) error {
	return nil // no cached state to clean up
}

// verbSliceContains checks whether a Verbs list contains a specific verb.
func verbSliceContains(verbs []string, target string) bool {
	for _, v := range verbs {
		if v == target {
			return true
		}
	}
	return false
}

// normalizeGroup maps standard K8s FQDN API group names to the short names
// used in static registrations. CRD groups are left untouched.
func normalizeGroup(group string) string {
	if group == "" {
		return "core"
	}
	for _, suffix := range []string{".k8s.io", ".kubernetes.io"} {
		if strings.HasSuffix(group, suffix) {
			if i := strings.IndexByte(group, '.'); i > 0 {
				return group[:i]
			}
		}
	}
	return group
}
