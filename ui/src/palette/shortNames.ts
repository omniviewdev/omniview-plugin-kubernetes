// The short names kubectl accepts for the kinds the plugin lists (`kubectl get po`), by the kind's type (`k8s:<group>/<resource>`, the catalog's name for it). They are the API server's: each resource's discovery entry
// carries them (`shortNames`), and `kubectl api-resources` prints them in its SHORTNAMES column. The plugin's catalog does not forward them to the interface (`ResourceType` has no such member), so the palette
// holds them here, and `shortNames.test.ts` holds this table to the discovery documents of a real server (`fixtures/discovery.json`, Kubernetes v1.34.0). A kind that has none is not in the table.
export const SHORT_NAMES: Readonly<Record<string, readonly string[]>> = {
  'k8s:/nodes': ['no'],
  'k8s:/namespaces': ['ns'],
  'k8s:/pods': ['po'],
  'k8s:apps/deployments': ['deploy'],
  'k8s:apps/statefulsets': ['sts'],
  'k8s:apps/daemonsets': ['ds'],
  'k8s:apps/replicasets': ['rs'],
  'k8s:batch/cronjobs': ['cj'],
  'k8s:/configmaps': ['cm'],
  'k8s:/resourcequotas': ['quota'],
  'k8s:/limitranges': ['limits'],
  'k8s:autoscaling/horizontalpodautoscalers': ['hpa'],
  'k8s:policy/poddisruptionbudgets': ['pdb'],
  'k8s:/services': ['svc'],
  'k8s:/endpoints': ['ep'],
  'k8s:networking.k8s.io/ingresses': ['ing'],
  'k8s:networking.k8s.io/networkpolicies': ['netpol'],
  'k8s:/persistentvolumes': ['pv'],
  'k8s:/persistentvolumeclaims': ['pvc'],
  'k8s:storage.k8s.io/storageclasses': ['sc'],
  'k8s:/serviceaccounts': ['sa'],
};
