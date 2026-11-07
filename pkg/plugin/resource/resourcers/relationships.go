package resourcers

import (
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// RelationshipTable returns all declarative relationship descriptors for Kubernetes resources.
// Keys and target types use the native API group and plural resource, independent of served version.
//
// Some entries have nil Extractor — these are "resolve-only" descriptors used as templates
// by ResolveRelationships() methods. The graph indexer skips descriptors with nil Extractor.
func RelationshipTable() map[string][]resource.RelationshipDescriptor {
	return map[string][]resource.RelationshipDescriptor{
		// ── k8s:/pods ──────────────────────────────────────────
		"k8s:/pods": {
			// Ownership — child declares parent via EdgeIncoming
			{
				Type: resource.RelOwns, TargetType: "k8s:apps/replicasets",
				ScopeExtractors: []resource.ScopeExtractor{{Dimension: "namespace", FieldPath: "metadata.namespace"}},
				Label:           "owned by", Direction: resource.EdgeIncoming,
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: `metadata.ownerReferences.#(kind=="ReplicaSet").name`,
				},
			},
			{
				Type: resource.RelOwns, TargetType: "k8s:apps/daemonsets",
				ScopeExtractors: []resource.ScopeExtractor{{Dimension: "namespace", FieldPath: "metadata.namespace"}},
				Label:           "owned by", Direction: resource.EdgeIncoming,
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: `metadata.ownerReferences.#(kind=="DaemonSet").name`,
				},
			},
			{
				Type: resource.RelOwns, TargetType: "k8s:apps/statefulsets",
				ScopeExtractors: []resource.ScopeExtractor{{Dimension: "namespace", FieldPath: "metadata.namespace"}},
				Label:           "owned by", Direction: resource.EdgeIncoming,
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: `metadata.ownerReferences.#(kind=="StatefulSet").name`,
				},
			},
			{
				Type: resource.RelOwns, TargetType: "k8s:batch/jobs",
				ScopeExtractors: []resource.ScopeExtractor{{Dimension: "namespace", FieldPath: "metadata.namespace"}},
				Label:           "owned by", Direction: resource.EdgeIncoming,
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: `metadata.ownerReferences.#(kind=="Job").name`,
				},
			},
			// Direct references
			{
				Type: resource.RelRunsOn, TargetType: "k8s:/nodes",
				Label: "runs on", TargetScope: []resource.ScopeEntry{},
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: "spec.nodeName",
				},
			},
			{
				Type: resource.RelUses, TargetType: "k8s:/serviceaccounts",
				ScopeExtractors: []resource.ScopeExtractor{{Dimension: "namespace", FieldPath: "metadata.namespace"}},
				Label:           "uses",
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: "spec.serviceAccountName",
				},
			},
			{
				Type: resource.RelUses, TargetType: "k8s:/persistentvolumeclaims",
				ScopeExtractors: []resource.ScopeExtractor{{Dimension: "namespace", FieldPath: "metadata.namespace"}},
				Label:           "uses",
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: "spec.volumes.#.persistentVolumeClaim.claimName",
				},
			},
			{
				Type: resource.RelUses, TargetType: "k8s:/configmaps",
				ScopeExtractors: []resource.ScopeExtractor{{Dimension: "namespace", FieldPath: "metadata.namespace"}},
				Label:           "uses",
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: "spec.volumes.#.configMap.name",
				},
			},
			{
				Type: resource.RelUses, TargetType: "k8s:/secrets",
				ScopeExtractors: []resource.ScopeExtractor{{Dimension: "namespace", FieldPath: "metadata.namespace"}},
				Label:           "uses",
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: "spec.volumes.#.secret.secretName",
				},
			},
			// Nested projections produce one array per container; flatten one level
			// so the graph indexer receives native IDs rather than arrays.
			{
				Type: resource.RelUses, TargetType: "k8s:/configmaps",
				ScopeExtractors: []resource.ScopeExtractor{{Dimension: "namespace", FieldPath: "metadata.namespace"}},
				Label:           "uses",
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: "spec.containers.#.envFrom.#.configMapRef.name|@flatten",
				},
			},
			{
				Type: resource.RelUses, TargetType: "k8s:/secrets",
				ScopeExtractors: []resource.ScopeExtractor{{Dimension: "namespace", FieldPath: "metadata.namespace"}},
				Label:           "uses",
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: "spec.containers.#.envFrom.#.secretRef.name|@flatten",
				},
			},
		},

		// ── k8s:/nodes ─────────────────────────────────────────
		// No extractor — graph indexer skips descriptors with nil Extractor.
		// Kept so that NodeResourcer.ResolveRelationships() has a descriptor template.
		"k8s:/nodes": {
			{
				Type:         resource.RelRunsOn,
				TargetType:   "k8s:/pods",
				Label:        "runs",
				InverseLabel: "runs on",
				Cardinality:  "one-to-many",
			},
		},

		// ── k8s:apps/replicasets ───────────────────────────────────
		"k8s:apps/replicasets": {
			{
				Type: resource.RelOwns, TargetType: "k8s:apps/deployments",
				ScopeExtractors: []resource.ScopeExtractor{{Dimension: "namespace", FieldPath: "metadata.namespace"}},
				Label:           "owned by", Direction: resource.EdgeIncoming,
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: `metadata.ownerReferences.#(kind=="Deployment").name`,
				},
			},
		},

		// ── k8s:batch/jobs ─────────────────────────────────────────
		"k8s:batch/jobs": {
			{
				Type: resource.RelOwns, TargetType: "k8s:batch/cronjobs",
				ScopeExtractors: []resource.ScopeExtractor{{Dimension: "namespace", FieldPath: "metadata.namespace"}},
				Label:           "owned by", Direction: resource.EdgeIncoming,
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: `metadata.ownerReferences.#(kind=="CronJob").name`,
				},
			},
		},

		// ── k8s:apps/deployments ───────────────────────────────────
		"k8s:apps/deployments": {
			// Resolve-only: no Extractor — used by ResolveRelationships() as descriptor template.
			{
				Type: resource.RelManages, TargetType: "k8s:apps/replicasets",
				ScopeExtractors: []resource.ScopeExtractor{{Dimension: "namespace", FieldPath: "metadata.namespace"}},
				Label:           "manages", InverseLabel: "managed by",
				Cardinality: "one-to-many",
			},
			// Graph indexer extractors
			{
				Type: resource.RelUses, TargetType: "k8s:/configmaps",
				ScopeExtractors: []resource.ScopeExtractor{{Dimension: "namespace", FieldPath: "metadata.namespace"}},
				Label:           "uses",
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: "spec.template.spec.volumes.#.configMap.name",
				},
			},
			{
				Type: resource.RelUses, TargetType: "k8s:/secrets",
				ScopeExtractors: []resource.ScopeExtractor{{Dimension: "namespace", FieldPath: "metadata.namespace"}},
				Label:           "uses",
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: "spec.template.spec.volumes.#.secret.secretName",
				},
			},
		},

		// ── k8s:apps/daemonsets ────────────────────────────────────
		"k8s:apps/daemonsets": {
			// Resolve-only: no Extractor
			{
				Type: resource.RelOwns, TargetType: "k8s:/pods",
				ScopeExtractors: []resource.ScopeExtractor{{Dimension: "namespace", FieldPath: "metadata.namespace"}},
				Label:           "owns", InverseLabel: "owned by",
				Cardinality: "one-to-many",
			},
			// Graph indexer extractors
			{
				Type: resource.RelUses, TargetType: "k8s:/configmaps",
				ScopeExtractors: []resource.ScopeExtractor{{Dimension: "namespace", FieldPath: "metadata.namespace"}},
				Label:           "uses",
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: "spec.template.spec.volumes.#.configMap.name",
				},
			},
			{
				Type: resource.RelUses, TargetType: "k8s:/secrets",
				ScopeExtractors: []resource.ScopeExtractor{{Dimension: "namespace", FieldPath: "metadata.namespace"}},
				Label:           "uses",
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: "spec.template.spec.volumes.#.secret.secretName",
				},
			},
		},

		// ── k8s:apps/statefulsets ──────────────────────────────────
		"k8s:apps/statefulsets": {
			// Resolve-only: no Extractor
			{
				Type: resource.RelOwns, TargetType: "k8s:/pods",
				ScopeExtractors: []resource.ScopeExtractor{{Dimension: "namespace", FieldPath: "metadata.namespace"}},
				Label:           "owns", InverseLabel: "owned by",
				Cardinality: "one-to-many",
			},
			{
				Type: resource.RelUses, TargetType: "k8s:/persistentvolumeclaims",
				ScopeExtractors: []resource.ScopeExtractor{{Dimension: "namespace", FieldPath: "metadata.namespace"}},
				Label:           "uses", InverseLabel: "used by",
				Cardinality: "one-to-many",
			},
			// Graph indexer extractors
			{
				Type: resource.RelUses, TargetType: "k8s:/configmaps",
				ScopeExtractors: []resource.ScopeExtractor{{Dimension: "namespace", FieldPath: "metadata.namespace"}},
				Label:           "uses",
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: "spec.template.spec.volumes.#.configMap.name",
				},
			},
			{
				Type: resource.RelUses, TargetType: "k8s:/secrets",
				ScopeExtractors: []resource.ScopeExtractor{{Dimension: "namespace", FieldPath: "metadata.namespace"}},
				Label:           "uses",
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: "spec.template.spec.volumes.#.secret.secretName",
				},
			},
		},

		// ── k8s:networking.k8s.io/ingresses ────────────────────────────────
		"k8s:networking.k8s.io/ingresses": {
			{
				Type: resource.RelUses, TargetType: "k8s:/secrets",
				ScopeExtractors: []resource.ScopeExtractor{{Dimension: "namespace", FieldPath: "metadata.namespace"}},
				Label:           "uses",
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: "spec.tls.#.secretName",
				},
			},
			{
				Type: resource.RelUses, TargetType: "k8s:networking.k8s.io/ingressclasses",
				Label: "uses", TargetScope: []resource.ScopeEntry{},
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: "spec.ingressClassName",
				},
			},
		},

		// ── k8s:/persistentvolumeclaims ────────────────────────
		"k8s:/persistentvolumeclaims": {
			{
				Type: resource.RelUses, TargetType: "k8s:/persistentvolumes",
				Label: "uses", TargetScope: []resource.ScopeEntry{},
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: "spec.volumeName",
				},
			},
			{
				Type: resource.RelUses, TargetType: "k8s:storage.k8s.io/storageclasses",
				Label: "uses", TargetScope: []resource.ScopeEntry{},
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: "spec.storageClassName",
				},
			},
		},

		// ── k8s:/persistentvolumes ─────────────────────────────
		"k8s:/persistentvolumes": {
			{
				Type: resource.RelUses, TargetType: "k8s:storage.k8s.io/storageclasses",
				Label: "uses", TargetScope: []resource.ScopeEntry{},
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: "spec.storageClassName",
				},
			},
		},

		// ── k8s:autoscaling/horizontalpodautoscalers ───────────────
		// Resolve-only: the HPA resourcer inspects spec.scaleTargetRef.kind at
		// runtime to emit an edge to either Deployment or StatefulSet (not both).
		"k8s:autoscaling/horizontalpodautoscalers": {
			{
				Type: resource.RelManages, TargetType: "k8s:apps/deployments",
				ScopeExtractors: []resource.ScopeExtractor{{Dimension: "namespace", FieldPath: "metadata.namespace"}},
				Label:           "manages",
			},
			{
				Type: resource.RelManages, TargetType: "k8s:apps/statefulsets",
				ScopeExtractors: []resource.ScopeExtractor{{Dimension: "namespace", FieldPath: "metadata.namespace"}},
				Label:           "manages",
			},
		},

		// ── k8s:/services ──────────────────────────────────────
		"k8s:/services": {
			{
				Type: resource.RelSelects, TargetType: "k8s:/pods",
				ScopeExtractors: []resource.ScopeExtractor{{Dimension: "namespace", FieldPath: "metadata.namespace"}},
				Label:           "selects",
				Extractor: &resource.RelationshipExtractor{
					Method: "labelSelector", FieldPath: "spec.selector",
				},
			},
		},

		// ── k8s:networking.k8s.io/networkpolicies ──────────────────────────
		// labelSelectorObject reads the whole LabelSelector, so matchExpressions
		// apply and an empty podSelector selects every Pod in the namespace.
		// Hosts that predate the method skip it (no edges) rather than over-select.
		"k8s:networking.k8s.io/networkpolicies": {
			{
				Type: resource.RelSelects, TargetType: "k8s:/pods",
				ScopeExtractors: []resource.ScopeExtractor{{Dimension: "namespace", FieldPath: "metadata.namespace"}},
				Label:           "selects",
				Extractor: &resource.RelationshipExtractor{
					Method: "labelSelectorObject", FieldPath: "spec.podSelector",
				},
			},
		},

		// ── k8s:policy/poddisruptionbudgets ────────────────────────
		"k8s:policy/poddisruptionbudgets": {
			{
				Type: resource.RelSelects, TargetType: "k8s:/pods",
				ScopeExtractors: []resource.ScopeExtractor{{Dimension: "namespace", FieldPath: "metadata.namespace"}},
				Label:           "selects",
				Extractor: &resource.RelationshipExtractor{
					Method: "labelSelectorObject", FieldPath: "spec.selector",
				},
			},
		},

		// ── k8s:rbac.authorization.k8s.io/clusterrolebindings ───────────────────────────
		"k8s:rbac.authorization.k8s.io/clusterrolebindings": {
			{
				Type: resource.RelUses, TargetType: "k8s:rbac.authorization.k8s.io/clusterroles",
				Label: "uses", TargetScope: []resource.ScopeEntry{},
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: "roleRef.name",
				},
			},
		},

		// ── k8s:rbac.authorization.k8s.io/rolebindings ──────────────────────────────────
		// Resolve-only: the RoleBinding resourcer inspects roleRef.kind at
		// runtime to route to either Role or ClusterRole.
		"k8s:rbac.authorization.k8s.io/rolebindings": {
			{
				Type: resource.RelUses, TargetType: "k8s:rbac.authorization.k8s.io/roles",
				ScopeExtractors: []resource.ScopeExtractor{{Dimension: "namespace", FieldPath: "metadata.namespace"}},
				Label:           "uses",
			},
			{
				Type: resource.RelUses, TargetType: "k8s:rbac.authorization.k8s.io/clusterroles",
				Label: "uses", TargetScope: []resource.ScopeEntry{},
			},
		},
	}
}
