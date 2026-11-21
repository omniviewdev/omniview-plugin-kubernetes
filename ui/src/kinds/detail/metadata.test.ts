import { describe, expect, it } from 'vitest';

import { toPodDetail } from '../../pod/data/object';
import { podOverview } from '../../pod/overview/model';

import { annotationModels, labelModels, MASK } from './metadata';

// What every kind's page says of its labels and annotations: the Pod page's rules (`pod/overview/model.ts`), held to the same answers by the parity test at the end, for every object of the plugin.

const pairs = (...keys: readonly string[]): Readonly<Record<string, string>> => Object.fromEntries(keys.map((key) => [key, `value-of-${key}`]));

describe('labels: the key and the value, the ordinary ones first and alphabetically, the cluster\'s own last', () => {
  it('sorts ordinary keys alphabetically (English collation) and the deprecated and cloud bookkeeping keys behind them', () => {
    const models = labelModels({
      'beta.kubernetes.io/arch': 'arm64',
      'topology.kubernetes.io/zone': 'eu-west-1a',
      'app': 'cart-api',
      'failure-domain.beta.kubernetes.io/zone': 'eu-west-1a',
      'Team': 'checkout',
      'eks.amazonaws.com/nodegroup-image': 'ami-1',
    });
    expect(models.map((tag) => tag.key)).toEqual(['app', 'Team', 'topology.kubernetes.io/zone', 'beta.kubernetes.io/arch', 'eks.amazonaws.com/nodegroup-image', 'failure-domain.beta.kubernetes.io/zone']);
  });

  it('keeps every value and protects none: a label is never a credential', () => {
    expect(labelModels({ app: 'cart-api', 'secret-name': 'x' })).toEqual([
      { key: 'app', value: 'cart-api', protected: false },
      { key: 'secret-name', value: 'x', protected: false },
    ]);
  });

  it('is empty for an object that has none', () => {
    expect(labelModels({})).toEqual([]);
  });
});

describe('annotations: a value that can hold a credential is not in the data at all', () => {
  const credentials = [
    'example.io/api-key',
    'example.io/api_key',
    'example.io/apikey',
    'example.io/api.key',
    'example.io/private-key',
    'example.io/private_key',
    'example.io/access_key',
    'example.io/Client_Secret',
    'example.io/auth-token',
    'example.io/db_password',
    'example.io/db_passwd',
    'example.io/service_credentials',
    'kubectl.kubernetes.io/last-applied-configuration',
  ];
  const ordinary = ['example.io/author', 'example.io/owner-team', 'example.io/monkey-business', 'example.io/keyboard', 'example.io/description', 'kubernetes.io/change-cause'];
  const models = annotationModels(pairs(...credentials, ...ordinary));

  it('protects each key that names a credential, and the last applied configuration of any object, whatever separates the words of the name', () => {
    for (const key of credentials) {
      expect(models.find((tag) => tag.key === key), key).toEqual({ key, value: undefined, protected: true });
    }
  });

  it('keeps the value of every other annotation', () => {
    for (const key of ordinary) {
      expect(models.find((tag) => tag.key === key), key).toEqual({ key, value: `value-of-${key}`, protected: false });
    }
  });

  it('has the value of no credential anywhere in what it says', () => {
    const everything = JSON.stringify(models);
    for (const key of credentials) {
      expect(everything, key).not.toContain(`value-of-${key}`);
    }
  });

  it('sorts the cluster\'s bookkeeping behind the ordinary keys, so a short list shows what a person wrote', () => {
    const sorted = annotationModels({
      'kubectl.kubernetes.io/last-applied-configuration': '{}',
      'deployment.kubernetes.io/revision': '3',
      'kubernetes.io/change-cause': 'rollout',
      'deployment.kubernetes.io/desired-replicas': '3',
      'a.example.io/note': 'x',
    });
    expect(sorted.map((tag) => tag.key)).toEqual(['a.example.io/note', 'deployment.kubernetes.io/revision', 'kubernetes.io/change-cause', 'deployment.kubernetes.io/desired-replicas', 'kubectl.kubernetes.io/last-applied-configuration']);
  });
});

describe('the mask', () => {
  it('is the mock\'s: eight bullets', () => {
    expect(MASK).toBe('••••••••');
  });
});

describe('the same answers as the Pod page', () => {
  const labels = pairs('app', 'Team', 'topology.kubernetes.io/zone', 'beta.kubernetes.io/arch', 'failure-domain.beta.kubernetes.io/region', 'eks.amazonaws.com/sourceLaunchTemplateId', 'z', 'a');
  const annotations = pairs(
    'kubectl.kubernetes.io/last-applied-configuration',
    'deployment.kubernetes.io/revision',
    'volume.kubernetes.io/selected-node',
    'pv.kubernetes.io/bind-completed',
    'node.alpha.kubernetes.io/ttl',
    'csi.volume.kubernetes.io/nodeid',
    'endpoints.kubernetes.io/last-change-trigger-time',
    'control-plane.alpha.kubernetes.io/leader',
    'kubernetes.io/config.seen',
    'autoscaling.alpha.kubernetes.io/metrics',
    'batch.kubernetes.io/cronjob-scheduled-timestamp',
    'k8s.v1.cni.cncf.io/network-status',
    'rbac.authorization.kubernetes.io/autoupdate',
    'example.io/api-key',
    'example.io/author',
    'example.io/db_password',
    'zeta.example.io/note',
    'alpha.example.io/note',
  );
  const pod = podOverview(toPodDetail({ metadata: { name: 'p', namespace: 'n', labels, annotations }, status: {} }));

  it('sorts and protects labels exactly as the Pod page does', () => {
    expect(labelModels(labels)).toEqual(pod.labels);
  });

  it('sorts and protects annotations exactly as the Pod page does', () => {
    expect(annotationModels(annotations)).toEqual(pod.annotations);
  });
});
