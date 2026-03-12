/** Shape of a Helm chart as returned by the backend list/get APIs. */
export interface HelmChart {
  id?: string;
  name?: string;
  repository?: string;
  description?: string;
  deprecated?: boolean;
  icon?: string;
  keywords?: string[];
  maintainers?: Array<{ name: string; email?: string; url?: string }>;
  appVersion?: string;
  kubeVersion?: string;
  type?: string;
  home?: string;
  dependencies?: Array<{ name: string; version?: string; repository?: string }>;
}

/** A single chart version entry. */
export interface ChartVersion {
  version: string;
  appVersion: string;
  created: string;
  description?: string;
  kubeVersion?: string;
  deprecated?: boolean;
  home?: string;
  icon?: string;
  type?: string;
}

/** Data returned by `get-versions` action. */
export interface VersionsActionData {
  versions?: ChartVersion[];
}

/** Data returned by `get-readme` action. */
export interface ReadmeActionData {
  readme?: string;
}

/** Data returned by `get-values` action. */
export interface ValuesActionData {
  values?: string;
}
