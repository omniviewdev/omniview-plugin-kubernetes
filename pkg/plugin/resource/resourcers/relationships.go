package resourcers

import (
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
)

func boolPtr(v bool) *bool { return &v }

// RelationshipTable returns all declarative relationship descriptors for Kubernetes resources.
// Keys must match the short group format from register_gen.go (e.g., "networking::v1::Ingress").
//
// Some entries have nil Extractor — these are "resolve-only" descriptors used as templates
// by ResolveRelationships() methods. The graph indexer skips descriptors with nil Extractor.
func RelationshipTable() map[string][]resource.RelationshipDescriptor {
	return map[string][]resource.RelationshipDescriptor{
		// ── core::v1::Pod ──────────────────────────────────────────
		"core::v1::Pod": {
			// Ownership — child declares parent via EdgeIncoming
			{
				Type: resource.RelOwns, TargetResourceKey: "apps::v1::ReplicaSet",
				Label: "owned by", Direction: resource.EdgeIncoming,
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: `metadata.ownerReferences.#(kind=="ReplicaSet").name`,
				},
			},
			{
				Type: resource.RelOwns, TargetResourceKey: "apps::v1::DaemonSet",
				Label: "owned by", Direction: resource.EdgeIncoming,
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: `metadata.ownerReferences.#(kind=="DaemonSet").name`,
				},
			},
			{
				Type: resource.RelOwns, TargetResourceKey: "apps::v1::StatefulSet",
				Label: "owned by", Direction: resource.EdgeIncoming,
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: `metadata.ownerReferences.#(kind=="StatefulSet").name`,
				},
			},
			{
				Type: resource.RelOwns, TargetResourceKey: "batch::v1::Job",
				Label: "owned by", Direction: resource.EdgeIncoming,
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: `metadata.ownerReferences.#(kind=="Job").name`,
				},
			},
			// Direct references
			{
				Type: resource.RelRunsOn, TargetResourceKey: "core::v1::Node",
				Label: "runs on", TargetNamespaced: boolPtr(false),
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: "spec.nodeName",
				},
			},
			{
				Type: resource.RelUses, TargetResourceKey: "core::v1::ServiceAccount",
				Label: "uses",
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: "spec.serviceAccountName",
				},
			},
			{
				Type: resource.RelUses, TargetResourceKey: "core::v1::PersistentVolumeClaim",
				Label: "uses",
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: "spec.volumes.#.persistentVolumeClaim.claimName",
				},
			},
			{
				Type: resource.RelUses, TargetResourceKey: "core::v1::ConfigMap",
				Label: "uses",
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: "spec.volumes.#.configMap.name",
				},
			},
			{
				Type: resource.RelUses, TargetResourceKey: "core::v1::Secret",
				Label: "uses",
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: "spec.volumes.#.secret.secretName",
				},
			},
			{
				Type: resource.RelUses, TargetResourceKey: "core::v1::ConfigMap",
				Label: "uses",
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: "spec.containers.#.envFrom.#.configMapRef.name",
				},
			},
			{
				Type: resource.RelUses, TargetResourceKey: "core::v1::Secret",
				Label: "uses",
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: "spec.containers.#.envFrom.#.secretRef.name",
				},
			},
		},

		// ── core::v1::Node ─────────────────────────────────────────
		// No extractor — graph indexer skips descriptors with nil Extractor.
		// Kept so that NodeResourcer.ResolveRelationships() has a descriptor template.
		"core::v1::Node": {
			{
				Type:              resource.RelRunsOn,
				TargetResourceKey: "core::v1::Pod",
				Label:             "runs",
				InverseLabel:      "runs on",
				Cardinality:       "one-to-many",
			},
		},

		// ── apps::v1::ReplicaSet ───────────────────────────────────
		"apps::v1::ReplicaSet": {
			{
				Type: resource.RelOwns, TargetResourceKey: "apps::v1::Deployment",
				Label: "owned by", Direction: resource.EdgeIncoming,
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: `metadata.ownerReferences.#(kind=="Deployment").name`,
				},
			},
		},

		// ── batch::v1::Job ─────────────────────────────────────────
		"batch::v1::Job": {
			{
				Type: resource.RelOwns, TargetResourceKey: "batch::v1::CronJob",
				Label: "owned by", Direction: resource.EdgeIncoming,
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: `metadata.ownerReferences.#(kind=="CronJob").name`,
				},
			},
		},

		// ── apps::v1::Deployment ───────────────────────────────────
		"apps::v1::Deployment": {
			// Resolve-only: no Extractor — used by ResolveRelationships() as descriptor template.
			{
				Type: resource.RelManages, TargetResourceKey: "apps::v1::ReplicaSet",
				Label: "manages", InverseLabel: "managed by",
				Cardinality: "one-to-many",
			},
			// Graph indexer extractors
			{
				Type: resource.RelUses, TargetResourceKey: "core::v1::ConfigMap",
				Label: "uses",
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: "spec.template.spec.volumes.#.configMap.name",
				},
			},
			{
				Type: resource.RelUses, TargetResourceKey: "core::v1::Secret",
				Label: "uses",
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: "spec.template.spec.volumes.#.secret.secretName",
				},
			},
		},

		// ── apps::v1::DaemonSet ────────────────────────────────────
		"apps::v1::DaemonSet": {
			// Resolve-only: no Extractor
			{
				Type: resource.RelOwns, TargetResourceKey: "core::v1::Pod",
				Label: "owns", InverseLabel: "owned by",
				Cardinality: "one-to-many",
			},
			// Graph indexer extractors
			{
				Type: resource.RelUses, TargetResourceKey: "core::v1::ConfigMap",
				Label: "uses",
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: "spec.template.spec.volumes.#.configMap.name",
				},
			},
			{
				Type: resource.RelUses, TargetResourceKey: "core::v1::Secret",
				Label: "uses",
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: "spec.template.spec.volumes.#.secret.secretName",
				},
			},
		},

		// ── apps::v1::StatefulSet ──────────────────────────────────
		"apps::v1::StatefulSet": {
			// Resolve-only: no Extractor
			{
				Type: resource.RelOwns, TargetResourceKey: "core::v1::Pod",
				Label: "owns", InverseLabel: "owned by",
				Cardinality: "one-to-many",
			},
			{
				Type: resource.RelUses, TargetResourceKey: "core::v1::PersistentVolumeClaim",
				Label: "uses", InverseLabel: "used by",
				Cardinality: "one-to-many",
			},
			// Graph indexer extractors
			{
				Type: resource.RelUses, TargetResourceKey: "core::v1::ConfigMap",
				Label: "uses",
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: "spec.template.spec.volumes.#.configMap.name",
				},
			},
			{
				Type: resource.RelUses, TargetResourceKey: "core::v1::Secret",
				Label: "uses",
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: "spec.template.spec.volumes.#.secret.secretName",
				},
			},
		},

		// ── networking::v1::Ingress ────────────────────────────────
		"networking::v1::Ingress": {
			{
				Type: resource.RelUses, TargetResourceKey: "core::v1::Secret",
				Label: "uses",
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: "spec.tls.#.secretName",
				},
			},
			{
				Type: resource.RelUses, TargetResourceKey: "networking::v1::IngressClass",
				Label: "uses", TargetNamespaced: boolPtr(false),
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: "spec.ingressClassName",
				},
			},
		},

		// ── core::v1::PersistentVolumeClaim ────────────────────────
		"core::v1::PersistentVolumeClaim": {
			{
				Type: resource.RelUses, TargetResourceKey: "core::v1::PersistentVolume",
				Label: "uses", TargetNamespaced: boolPtr(false),
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: "spec.volumeName",
				},
			},
			{
				Type: resource.RelUses, TargetResourceKey: "storage::v1::StorageClass",
				Label: "uses", TargetNamespaced: boolPtr(false),
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: "spec.storageClassName",
				},
			},
		},

		// ── core::v1::PersistentVolume ─────────────────────────────
		"core::v1::PersistentVolume": {
			{
				Type: resource.RelUses, TargetResourceKey: "storage::v1::StorageClass",
				Label: "uses", TargetNamespaced: boolPtr(false),
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: "spec.storageClassName",
				},
			},
		},

		// ── autoscaling::v2::HorizontalPodAutoscaler ───────────────
		"autoscaling::v2::HorizontalPodAutoscaler": {
			{
				Type: resource.RelManages, TargetResourceKey: "apps::v1::Deployment",
				Label: "manages",
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: "spec.scaleTargetRef.name",
				},
			},
			{
				Type: resource.RelManages, TargetResourceKey: "apps::v1::StatefulSet",
				Label: "manages",
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: "spec.scaleTargetRef.name",
				},
			},
		},

		// ── core::v1::Service ──────────────────────────────────────
		"core::v1::Service": {
			{
				Type: resource.RelSelects, TargetResourceKey: "core::v1::Pod",
				Label: "selects",
				Extractor: &resource.RelationshipExtractor{
					Method: "labelSelector", FieldPath: "spec.selector",
				},
			},
		},

		// ── networking::v1::NetworkPolicy ──────────────────────────
		"networking::v1::NetworkPolicy": {
			{
				Type: resource.RelSelects, TargetResourceKey: "core::v1::Pod",
				Label: "selects",
				Extractor: &resource.RelationshipExtractor{
					Method: "labelSelector", FieldPath: "spec.podSelector.matchLabels",
				},
			},
		},

		// ── rbac::v1::ClusterRoleBinding ───────────────────────────
		"rbac::v1::ClusterRoleBinding": {
			{
				Type: resource.RelUses, TargetResourceKey: "rbac::v1::ClusterRole",
				Label: "uses", TargetNamespaced: boolPtr(false),
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: "roleRef.name",
				},
			},
		},

		// ── rbac::v1::RoleBinding ──────────────────────────────────
		"rbac::v1::RoleBinding": {
			{
				Type: resource.RelUses, TargetResourceKey: "rbac::v1::Role",
				Label: "uses",
				Extractor: &resource.RelationshipExtractor{
					Method: "fieldPath", FieldPath: "roleRef.name",
				},
			},
		},
	}
}
