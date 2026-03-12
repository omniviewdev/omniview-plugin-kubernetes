/** Shape of a Helm repository row. */
export interface HelmRepo {
  name?: string;
  url?: string;
  type?: string;
  username?: string;
  insecure_skip_tls_verify?: boolean;
}

export type ChartEntry = {
  name: string;
  description: string;
  version: string;
  appVersion?: string;
  icon?: string;
};

/** Data returned by `list-charts` action. */
export interface ListChartsData {
  charts?: ChartEntry[];
}

export type DialogStep = 'input' | 'validating' | 'success' | 'error';
