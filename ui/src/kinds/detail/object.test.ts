import { describe, expect, it } from 'vitest';

import { conditionInputs, controllerOf, detailMeta, podTemplateOf, selectorOf, strategyOf, strings } from './object';

// What a kind's page reads of an object of unknown shape: each field kept only when it has the type the API gives it, so what the object does not hold is absent here and stays absent downstream.

describe('strings: a map of text, as labels and annotations are', () => {
  it('keeps the entries whose value is text, in the object\'s order, and nothing of any other shape', () => {
    expect(strings({ a: '1', b: 2, c: null, d: 'x', e: { nested: true } })).toEqual({ a: '1', d: 'x' });
    expect(Object.keys(strings({ z: '1', a: '2' }))).toEqual(['z', 'a']);
  });

  it('is empty for what is not a map', () => {
    expect(strings(undefined)).toEqual({});
    expect(strings('text')).toEqual({});
    expect(strings(['a'])).toEqual({});
  });
});

describe('detailMeta: the metadata every page reads', () => {
  it('reads the identity, the times, the labels, the annotations and the owners', () => {
    expect(
      detailMeta({
        name: 'cart-api',
        namespace: 'checkout',
        uid: 'abc',
        creationTimestamp: '2026-11-19T20:09:56Z',
        deletionTimestamp: '2026-11-20T01:00:00Z',
        labels: { app: 'cart-api' },
        annotations: { 'deployment.kubernetes.io/revision': '1' },
        ownerReferences: [{ apiVersion: 'apps/v1', kind: 'ReplicaSet', name: 'cart-api-86bf766589', controller: true, uid: 'x' }, { kind: 'CronJob', name: 'nightly' }],
      }),
    ).toEqual({
      name: 'cart-api',
      namespace: 'checkout',
      uid: 'abc',
      creationTimestamp: '2026-11-19T20:09:56Z',
      deletionTimestamp: '2026-11-20T01:00:00Z',
      labels: { app: 'cart-api' },
      annotations: { 'deployment.kubernetes.io/revision': '1' },
      ownerReferences: [{ kind: 'ReplicaSet', name: 'cart-api-86bf766589', controller: true }, { kind: 'CronJob', name: 'nightly', controller: undefined }],
    });
  });

  it('holds no label, annotation or owner for an object that has none, and nothing of a field of the wrong type', () => {
    expect(detailMeta({ name: 3, labels: 'x', annotations: [], ownerReferences: 'x' })).toEqual({
      name: undefined,
      namespace: undefined,
      uid: undefined,
      creationTimestamp: undefined,
      deletionTimestamp: undefined,
      labels: {},
      annotations: {},
      ownerReferences: [],
    });
    expect(detailMeta(undefined).labels).toEqual({});
  });
});

describe('controllerOf: the owner that controls the object', () => {
  it('is the reference with controller true, not the first one', () => {
    expect(controllerOf([{ kind: 'Other', name: 'a' }, { kind: 'CronJob', name: 'nightly', controller: true }])).toEqual({ kind: 'CronJob', name: 'nightly', controller: true });
  });

  it('is nothing when none controls it, or when the controller has no kind or no name', () => {
    expect(controllerOf([{ kind: 'Other', name: 'a' }])).toBeUndefined();
    expect(controllerOf([{ kind: 'CronJob', controller: true }])).toBeUndefined();
    expect(controllerOf([{ name: 'nightly', controller: true }])).toBeUndefined();
    expect(controllerOf([])).toBeUndefined();
  });
});

describe('conditionInputs', () => {
  it('reads the fields of each condition that is text, and nothing for an object that holds no list', () => {
    expect(conditionInputs([{ type: 'Ready', status: 'True', reason: 'KubeletReady', message: 'ok', lastTransitionTime: 't', lastHeartbeatTime: 'h', extra: 1 }, 'x', { type: 2 }])).toEqual([
      { type: 'Ready', status: 'True', reason: 'KubeletReady', message: 'ok', lastTransitionTime: 't' },
      { type: undefined, status: undefined, reason: undefined, message: undefined, lastTransitionTime: undefined },
    ]);
    expect(conditionInputs(undefined)).toBeUndefined();
    expect(conditionInputs('x')).toBeUndefined();
  });
});

describe('selectorOf', () => {
  it('reads a label selector: its labels and its expressions', () => {
    expect(selectorOf({ matchLabels: { app: 'a', n: 1 }, matchExpressions: [{ key: 'env', operator: 'In', values: ['prod', 3] }, { key: 'x' }, 'y'] })).toEqual({
      matchLabels: { app: 'a' },
      matchExpressions: [{ key: 'env', operator: 'In', values: ['prod'] }],
    });
  });

  it('reads a map of labels when asked to (a Service\'s selector)', () => {
    expect(selectorOf({ app: 'a', tier: 'web', n: 1 }, 'labels')).toEqual({ matchLabels: { app: 'a', tier: 'web' } });
  });

  it('is nothing for what is not a selector', () => {
    expect(selectorOf(undefined)).toBeUndefined();
    expect(selectorOf('x')).toBeUndefined();
    expect(selectorOf({})).toEqual({ matchLabels: {}, matchExpressions: [] });
  });
});

describe('strategyOf: how a workload replaces its Pods', () => {
  it('reads the type and the limits of a rolling update, a count or a percentage as it was written', () => {
    expect(strategyOf({ type: 'RollingUpdate', rollingUpdate: { maxSurge: '25%', maxUnavailable: 1, partition: 0 } })).toEqual({ type: 'RollingUpdate', maxSurge: '25%', maxUnavailable: '1', partition: '0' });
  });

  it('holds no limit the object does not state', () => {
    expect(strategyOf({ type: 'Recreate' })).toEqual({ type: 'Recreate', maxSurge: undefined, maxUnavailable: undefined, partition: undefined });
    expect(strategyOf(undefined)).toBeUndefined();
    expect(strategyOf('x')).toBeUndefined();
  });
});

describe('podTemplateOf: what a workload says of the Pods it makes', () => {
  it('reads the service account and the node selector of the Pod template', () => {
    expect(podTemplateOf({ template: { spec: { serviceAccountName: 'builder', nodeSelector: { 'kubernetes.io/os': 'linux', n: 1 }, containers: [] } } })).toEqual({
      serviceAccountName: 'builder',
      nodeSelector: { 'kubernetes.io/os': 'linux' },
    });
  });

  it('holds neither for a template that states none, and a node selector only when the template has the field', () => {
    expect(podTemplateOf({ template: { spec: { containers: [] } } })).toEqual({ serviceAccountName: undefined, nodeSelector: undefined });
    expect(podTemplateOf({ template: { spec: { nodeSelector: {} } } })).toEqual({ serviceAccountName: undefined, nodeSelector: {} });
    expect(podTemplateOf({})).toEqual({ serviceAccountName: undefined, nodeSelector: undefined });
    expect(podTemplateOf(undefined)).toEqual({ serviceAccountName: undefined, nodeSelector: undefined });
    expect(podTemplateOf({ template: 'x' })).toEqual({ serviceAccountName: undefined, nodeSelector: undefined });
  });
});
