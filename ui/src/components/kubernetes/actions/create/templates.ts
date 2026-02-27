import { parseResourceKey } from '../../../../utils/resourceKey';

/**
 * Convert a resource key like "core::v1::Pod" to a Kubernetes apiVersion.
 * - "core::v1::Pod" → "v1"
 * - "apps::v1::Deployment" → "apps/v1"
 * - "networking.k8s.io::v1::Ingress" → "networking.k8s.io/v1"
 */
export const resourceKeyToApiVersion = (key: string): string => {
  const { group, version } = parseResourceKey(key);
  if (group === 'core') return version;
  return `${group}/${version}`;
};

/**
 * Hand-crafted YAML templates for common Kubernetes resource kinds.
 */
const templates: Record<string, string> = {
  Pod: `apiVersion: v1
kind: Pod
metadata:
  name: my-pod
  namespace: default
  labels:
    app: my-pod
spec:
  containers:
    - name: main
      image: nginx:latest
      ports:
        - containerPort: 80
`,

  Deployment: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-deployment
  namespace: default
  labels:
    app: my-deployment
spec:
  replicas: 1
  selector:
    matchLabels:
      app: my-deployment
  template:
    metadata:
      labels:
        app: my-deployment
    spec:
      containers:
        - name: main
          image: nginx:latest
          ports:
            - containerPort: 80
`,

  StatefulSet: `apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: my-statefulset
  namespace: default
  labels:
    app: my-statefulset
spec:
  serviceName: my-statefulset
  replicas: 1
  selector:
    matchLabels:
      app: my-statefulset
  template:
    metadata:
      labels:
        app: my-statefulset
    spec:
      containers:
        - name: main
          image: nginx:latest
          ports:
            - containerPort: 80
`,

  DaemonSet: `apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: my-daemonset
  namespace: default
  labels:
    app: my-daemonset
spec:
  selector:
    matchLabels:
      app: my-daemonset
  template:
    metadata:
      labels:
        app: my-daemonset
    spec:
      containers:
        - name: main
          image: nginx:latest
`,

  Service: `apiVersion: v1
kind: Service
metadata:
  name: my-service
  namespace: default
spec:
  selector:
    app: my-app
  ports:
    - port: 80
      targetPort: 80
      protocol: TCP
  type: ClusterIP
`,

  ConfigMap: `apiVersion: v1
kind: ConfigMap
metadata:
  name: my-configmap
  namespace: default
data:
  key: value
`,

  Secret: `apiVersion: v1
kind: Secret
metadata:
  name: my-secret
  namespace: default
type: Opaque
stringData:
  key: value
`,

  Namespace: `apiVersion: v1
kind: Namespace
metadata:
  name: my-namespace
`,

  PersistentVolumeClaim: `apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: my-pvc
  namespace: default
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
`,

  ServiceAccount: `apiVersion: v1
kind: ServiceAccount
metadata:
  name: my-service-account
  namespace: default
`,

  Job: `apiVersion: batch/v1
kind: Job
metadata:
  name: my-job
  namespace: default
spec:
  template:
    spec:
      containers:
        - name: job
          image: busybox:latest
          command: ["echo", "Hello"]
      restartPolicy: Never
  backoffLimit: 4
`,

  CronJob: `apiVersion: batch/v1
kind: CronJob
metadata:
  name: my-cronjob
  namespace: default
spec:
  schedule: "*/5 * * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: job
              image: busybox:latest
              command: ["echo", "Hello"]
          restartPolicy: Never
`,

  Ingress: `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-ingress
  namespace: default
spec:
  rules:
    - host: example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: my-service
                port:
                  number: 80
`,

  NetworkPolicy: `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: my-network-policy
  namespace: default
spec:
  podSelector:
    matchLabels:
      app: my-app
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: allowed
      ports:
        - port: 80
          protocol: TCP
`,

  Role: `apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: my-role
  namespace: default
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
`,

  ClusterRole: `apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: my-cluster-role
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
`,

  RoleBinding: `apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: my-role-binding
  namespace: default
subjects:
  - kind: ServiceAccount
    name: my-service-account
    namespace: default
roleRef:
  kind: Role
  name: my-role
  apiGroup: rbac.authorization.k8s.io
`,

  ClusterRoleBinding: `apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: my-cluster-role-binding
subjects:
  - kind: ServiceAccount
    name: my-service-account
    namespace: default
roleRef:
  kind: ClusterRole
  name: my-cluster-role
  apiGroup: rbac.authorization.k8s.io
`,

  StorageClass: `apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: my-storage-class
provisioner: kubernetes.io/no-provisioner
volumeBindingMode: WaitForFirstConsumer
`,
};

/** Cluster-scoped kinds that should NOT have metadata.namespace in the generic template */
const clusterScopedKinds = new Set([
  'Namespace',
  'Node',
  'ClusterRole',
  'ClusterRoleBinding',
  'StorageClass',
  'PersistentVolume',
  'CustomResourceDefinition',
  'PriorityClass',
  'IngressClass',
]);

/**
 * Return a YAML template for the given resourceKey.
 * Uses a hand-crafted template if available, otherwise generates a generic one.
 */
export const getTemplate = (resourceKey: string): string => {
  const { kind } = parseResourceKey(resourceKey);

  // Return hand-crafted template if we have one
  if (templates[kind]) {
    return templates[kind];
  }

  // Generate a generic template
  const apiVersion = resourceKeyToApiVersion(resourceKey);
  const isClusterScoped = clusterScopedKinds.has(kind);
  const name = `my-${kind
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase()}`;

  let yaml = `apiVersion: ${apiVersion}\nkind: ${kind}\nmetadata:\n  name: ${name}\n`;
  if (!isClusterScoped) {
    yaml += '  namespace: default\n';
  }

  return yaml;
};
