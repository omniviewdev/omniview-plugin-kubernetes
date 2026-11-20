import { describe, expect, it } from 'vitest';

import { hostRecord } from '../testing';

import { horizontalPodAutoscalerDefinition } from './definition';
import { horizontalPodAutoscalerRow, horizontalPodAutoscalerSearchText, type HorizontalPodAutoscalerRow } from './row';

// The HorizontalPodAutoscaler definition, as the mock's `PRINTER.HorizontalPodAutoscaler` has it (MOCK k8s-resource-definitions.js:808-811, with the helpers `hpaState` and `hpaTargets` at 700-709; ch17 K60.3):
// after the name, Status, Reference (the mock's `targetRef`), Targets, Replicas and Age. The mock's wide set (Min pods, Max pods) and its Columns chooser wait for the list page to have them. The mock has a
// state word and no quick filters for the kind. The objects are autoscaling/v2, which the plugin's catalog reads as the preferred version.

const NOW = Date.UTC(2026, 10, 19, 20, 0, 0);

const row = (object: unknown): HorizontalPodAutoscalerRow => horizontalPodAutoscalerRow(hostRecord(object, 'row:1', horizontalPodAutoscalerDefinition.type));
const autoscaler = (spec: Record<string, unknown> | undefined, status: Record<string, unknown> | undefined = undefined) =>
  row({
    metadata: { name: 'web', namespace: 'shop', creationTimestamp: '2026-11-17T20:00:00Z' },
    ...(spec === undefined ? {} : { spec }),
    ...(status === undefined ? {} : { status }),
  });
const cell = (id: string, target: HorizontalPodAutoscalerRow) => horizontalPodAutoscalerDefinition.fields.find((field) => field.id === id)!.display(target, NOW);

const reference = (kind = 'Deployment', name = 'web') => ({ scaleTargetRef: { apiVersion: 'apps/v1', kind, name } });
/** A resource metric of the spec that aims at a utilization, and one that aims at an average value. */
const utilization = (name: string, percent: number) => ({ type: 'Resource', resource: { name, target: { type: 'Utilization', averageUtilization: percent } } });
const average = (name: string, value: string) => ({ type: 'Resource', resource: { name, target: { type: 'AverageValue', averageValue: value } } });
/** What the status reads of a resource metric. */
const reading = (name: string, current: Record<string, unknown>) => ({ type: 'Resource', resource: { name, current } });
const condition = (type: string, status: string) => ({ type, status, reason: 'Anything', message: 'Anything' });
const conditions = (...pairs: ReadonlyArray<readonly [type: string, status: string]>) => ({ conditions: pairs.map(([type, status]) => condition(type, status)) });
const stateOf = (...pairs: ReadonlyArray<readonly [type: string, status: string]>) => autoscaler(reference(), conditions(...pairs)).status;

const web = autoscaler(
  { ...reference(), minReplicas: 1, maxReplicas: 5, metrics: [utilization('cpu', 50)] },
  { currentReplicas: 1, desiredReplicas: 1, currentMetrics: [reading('cpu', { averageUtilization: 0, averageValue: '0' })], ...conditions(['AbleToScale', 'True'], ['ScalingActive', 'True'], ['ScalingLimited', 'False']) },
);

describe('the definition', () => {
  it('names the type, the kind and the nouns: the objects are autoscaling/v2', () => {
    expect(horizontalPodAutoscalerDefinition).toMatchObject({
      type: 'k8s:autoscaling/horizontalpodautoscalers',
      identity: { group: 'autoscaling', version: 'v2', resource: 'horizontalpodautoscalers' },
      kind: 'HorizontalPodAutoscaler',
      nouns: { one: 'HorizontalPodAutoscaler', other: 'HorizontalPodAutoscalers' },
      page: 'horizontalpodautoscalers',
    });
  });

  it('lists the columns of the mock\'s default set: the identity, Status, Reference, Targets, Replicas, Age', () => {
    expect(horizontalPodAutoscalerDefinition.columns.map((column) => [column.id, column.label, column.defaultHidden])).toEqual([
      ['name', 'Name', false],
      ['status', 'Status', false],
      ['reference', 'Reference', false],
      ['targets', 'Targets', false],
      ['replicas', 'Replicas', false],
      ['age', 'Age', false],
    ]);
  });

  it('gives each column the fit, width, alignment and sort of the mock: a width that holds the longest state word, `Unable to scale`, with its glyph (7.2 px a character plus 42), and the replicas to the right', () => {
    const by = Object.fromEntries(horizontalPodAutoscalerDefinition.columns.map((column) => [column.id, column]));

    expect(by.name).toMatchObject({ fit: 'id', width: 160, align: 'left', sort: 'text', required: true });
    expect(by.status).toMatchObject({ fit: 'fixed', width: 150, align: 'left', sort: 'text' });
    expect(by.reference).toMatchObject({ fit: 'flex', width: 72, align: 'left', sort: 'text' });
    expect(by.targets).toMatchObject({ fit: 'flex', width: 72, align: 'left', sort: 'text' });
    expect(by.replicas).toMatchObject({ fit: 'fixed', width: 72, align: 'right', sort: 'number' });
    expect(by.age).toMatchObject({ fit: 'fixed', width: 59, align: 'left', sort: 'time' });
  });

  it('has no quick filters (the mock has a state word and no strip), no detail page yet, the namespace under the name, and no tail to keep on a name that was not generated', () => {
    expect(horizontalPodAutoscalerDefinition.list.quickFilters).toEqual([]);
    expect(horizontalPodAutoscalerDefinition.detail).toBeUndefined();
    expect(horizontalPodAutoscalerDefinition.list.identity.second(web)).toBe('shop');
    expect(horizontalPodAutoscalerDefinition.list.identity.second({ ...web, namespace: '' })).toBeNull();
    expect(horizontalPodAutoscalerDefinition.list.identity.tail(web)).toBe(0);
  });
});

describe('the state: the conditions the controller writes, read by their type', () => {
  it('is Scaling active when the autoscaler is able to scale, its metrics are read and nothing limits it', () => {
    expect(web.status).toEqual({ word: 'Scaling active', role: 'healthy' });
    expect(stateOf(['ScalingActive', 'True'])).toEqual({ word: 'Scaling active', role: 'healthy' });
  });

  it('is Limited when ScalingLimited is True: the minimum or the maximum cut the count it wanted', () => {
    expect(stateOf(['AbleToScale', 'True'], ['ScalingActive', 'True'], ['ScalingLimited', 'True'])).toEqual({ word: 'Limited', role: 'attention' });
    // The word is for the limit, whether or not ScalingActive says anything.
    expect(stateOf(['ScalingActive', 'Unknown'], ['ScalingLimited', 'True'])).toEqual({ word: 'Limited', role: 'attention' });
  });

  it('is Unable to scale when AbleToScale is False or ScalingActive is False, and that wins over a limit', () => {
    expect(stateOf(['AbleToScale', 'False'], ['ScalingActive', 'True'], ['ScalingLimited', 'True'])).toEqual({ word: 'Unable to scale', role: 'error' });
    expect(stateOf(['AbleToScale', 'True'], ['ScalingActive', 'False'], ['ScalingLimited', 'True'])).toEqual({ word: 'Unable to scale', role: 'error' });
    expect(stateOf(['ScalingActive', 'False'])?.word).toBe('Unable to scale');
  });

  it('reads each condition by its type and not by its place in the list, and skips what is not a condition', () => {
    expect(stateOf(['ScalingLimited', 'True'], ['ScalingActive', 'True'], ['AbleToScale', 'True'])?.word).toBe('Limited');
    const odd = autoscaler(reference(), { conditions: [{}, 'ScalingActive', null, { type: 'ScalingActive', status: 'True' }] });
    expect(odd.status?.word).toBe('Scaling active');
  });

  it('says no word before the controller has reported, and none while ScalingActive is Unknown: the mock says Scaling active for all of these, which the object does not say', () => {
    expect(autoscaler(reference(), undefined).status).toBeUndefined();
    expect(autoscaler(reference(), {}).status).toBeUndefined();
    expect(autoscaler(reference(), { conditions: [] }).status).toBeUndefined();
    expect(stateOf(['AbleToScale', 'True'])).toBeUndefined();
    expect(stateOf(['AbleToScale', 'True'], ['ScalingActive', 'Unknown'])).toBeUndefined();
    expect(stateOf(['AbleToScale', 'Unknown'], ['ScalingLimited', 'False'])).toBeUndefined();
  });
});

describe('the row: the target, the metrics and the replicas', () => {
  it('says the reference as the kind and the name of the target', () => {
    expect(web).toMatchObject({ name: 'web', namespace: 'shop', reference: 'Deployment/web', replicas: 1 });
    expect(autoscaler(reference('StatefulSet', 'db')).reference).toBe('StatefulSet/db');
  });

  it('has no reference for a spec that names no target, a target with no kind or no name, or an empty one', () => {
    for (const spec of [{}, { scaleTargetRef: { kind: 'Deployment' } }, { scaleTargetRef: { name: 'web' } }, { scaleTargetRef: { kind: '', name: '' } }, { scaleTargetRef: 'Deployment/web' }]) {
      expect(autoscaler(spec).reference, JSON.stringify(spec)).toBeUndefined();
    }
  });

  it('says a utilization as `<resource> <current>/<target>` in percent, and a utilization of zero as 0%: it is a reading', () => {
    expect(web.targets).toEqual(['cpu 0%/50%']);
  });

  it('says an average value as the object holds it, and finds each current by the name of its resource, whatever the order of the status', () => {
    const multi = autoscaler(
      { ...reference(), metrics: [utilization('cpu', 50), average('memory', '100Mi')] },
      { currentMetrics: [reading('memory', { averageValue: '304Ki' }), reading('cpu', { averageUtilization: 12, averageValue: '25m' })] },
    );
    expect(multi.targets).toEqual(['cpu 12%/50%', 'memory 304Ki/100Mi']);
  });

  it('says — for a current the status does not state: the metric is not read (kubectl prints <unknown>), whether the status is empty, holds an empty reading, or reads other metrics', () => {
    const spec = { ...reference(), metrics: [utilization('cpu', 80)] };
    expect(autoscaler(spec).targets).toEqual(['cpu —/80%']);
    expect(autoscaler(spec, { currentMetrics: [{ type: '' }] }).targets).toEqual(['cpu —/80%']);
    expect(autoscaler(spec, { currentMetrics: null }).targets).toEqual(['cpu —/80%']);
    expect(autoscaler(spec, { currentMetrics: [reading('memory', { averageUtilization: 3 })] }).targets).toEqual(['cpu —/80%']);
    // A reading of a container's resource is not the Pods' resource of the same name.
    expect(autoscaler(spec, { currentMetrics: [{ type: 'ContainerResource', containerResource: { name: 'cpu', container: 'app', current: { averageUtilization: 9 } } }] }).targets).toEqual(['cpu —/80%']);
  });

  it('says — for a current of the other kind than the target: a utilization aimed at and only an average value read, an average value aimed at and only a utilization read', () => {
    const spec = { ...reference(), metrics: [utilization('cpu', 50), average('memory', '100Mi')] };
    const status = { currentMetrics: [reading('cpu', { averageValue: '25m' }), reading('memory', { averageUtilization: 40 })] };
    expect(autoscaler(spec, status).targets).toEqual(['cpu —/50%', 'memory —/100Mi']);
  });

  it('says — for a target that states neither a utilization nor an average value, and ignores a quantity that is not a text', () => {
    const bare = { ...reference(), metrics: [{ type: 'Resource', resource: { name: 'cpu', target: { type: 'Utilization' } } }, { type: 'Resource', resource: { name: 'memory' } }] };
    expect(autoscaler(bare, { currentMetrics: [reading('cpu', { averageUtilization: 5 })] }).targets).toEqual(['cpu —/—', 'memory —/—']);
    expect(autoscaler({ ...reference(), metrics: [{ type: 'Resource', resource: { name: 'memory', target: { type: 'AverageValue', averageValue: 100 } } }] }).targets).toEqual(['memory —/—']);
  });

  it('says a metric of another type by its type in lower case, as the mock does, in its place among the others', () => {
    const mixed = autoscaler({
      ...reference(),
      metrics: [utilization('cpu', 50), { type: 'Pods', pods: { metric: { name: 'packets' } } }, { type: 'Object' }, { type: 'External' }, { type: 'ContainerResource', containerResource: { name: 'cpu', container: 'app' } }],
    });
    expect(mixed.targets).toEqual(['cpu —/50%', 'pods', 'object', 'external', 'containerresource']);
  });

  it('says each metric the object lists, and none twice for being alike: two Pods metrics are two metrics', () => {
    expect(autoscaler({ ...reference(), metrics: [{ type: 'Pods' }, { type: 'Pods' }] }).targets).toEqual(['pods', 'pods']);
  });

  it('says a Resource metric that names no resource, or an empty one, by its type, and skips an entry that names neither a type nor a resource', () => {
    const metrics = [{ type: 'Resource' }, { type: 'Resource', resource: { name: '' } }, {}, { type: '' }, 'cpu', null];
    expect(autoscaler({ ...reference(), metrics }).targets).toEqual(['resource', 'resource']);
  });

  it('has no targets for an autoscaler that names no metric: none, an empty list, or a list that is not one', () => {
    for (const spec of [reference(), { ...reference(), metrics: [] }, { ...reference(), metrics: 'cpu' }]) {
      expect(autoscaler(spec).targets, JSON.stringify(spec)).toBeUndefined();
    }
  });

  it('reads the current replicas as a number, and 0 where the status says 0', () => {
    expect(autoscaler(reference(), { currentReplicas: 3 }).replicas).toBe(3);
    expect(autoscaler(reference(), { currentReplicas: 0 }).replicas).toBe(0);
  });

  it('has no replicas where the status states none (the API leaves a zero out, and the list does not make a number up), nor one that is not a number', () => {
    expect(autoscaler(reference(), { desiredReplicas: 0 }).replicas).toBeUndefined();
    expect(autoscaler(reference(), { currentReplicas: '2' }).replicas).toBeUndefined();
    expect(autoscaler(reference()).replicas).toBeUndefined();
  });

  it('says nothing of the state, the reference, the targets or the replicas for an object that has no spec nor status, nor for a body that is not an object', () => {
    for (const target of [autoscaler(undefined), row('not an object')]) {
      expect(target).toMatchObject({ status: undefined, reference: undefined, targets: undefined, replicas: undefined });
    }
  });

  it('searches the name, the namespace, the word, the reference, the targets and the replicas', () => {
    const text = horizontalPodAutoscalerSearchText(web);
    for (const part of ['web', 'shop', 'scaling active', 'deployment/web', 'cpu 0%/50%', '1']) {
      expect(text).toContain(part);
    }
  });
});

describe('the cells', () => {
  it('draws the state with the glyph of its role', () => {
    expect(cell('status', web)).toEqual({ kind: 'status', raw: 'Scaling active', label: 'Scaling active', role: 'healthy' });
    expect(cell('status', autoscaler(reference(), conditions(['ScalingActive', 'True'], ['ScalingLimited', 'True'])))).toEqual({ kind: 'status', raw: 'Limited', label: 'Limited', role: 'attention' });
    expect(cell('status', autoscaler(reference(), conditions(['ScalingActive', 'False'])))).toEqual({ kind: 'status', raw: 'Unable to scale', label: 'Unable to scale', role: 'error' });
  });

  it('draws the reference and the targets as text, the targets joined by a comma and a space', () => {
    const multi = autoscaler({ ...reference(), metrics: [utilization('cpu', 50), average('memory', '100Mi')] }, { currentMetrics: [reading('cpu', { averageUtilization: 0 }), reading('memory', { averageValue: '304Ki' })] });
    expect(cell('reference', multi)).toEqual({ kind: 'text', text: 'Deployment/web' });
    expect(cell('targets', multi)).toEqual({ kind: 'text', text: 'cpu 0%/50%, memory 304Ki/100Mi' });
  });

  it('draws the replicas in the code face, 0 included', () => {
    expect(cell('replicas', web)).toEqual({ kind: 'text', text: '1', mono: true });
    expect(cell('replicas', autoscaler(reference(), { currentReplicas: 0 }))).toEqual({ kind: 'text', text: '0', mono: true });
  });

  it('draws a dash that says why for what the object does not state', () => {
    const bare = autoscaler(undefined);
    expect(cell('status', bare)).toEqual({ kind: 'none', reason: 'The autoscaler has not reported yet.' });
    expect(cell('reference', bare)).toEqual({ kind: 'none', reason: 'The autoscaler names no target.' });
    expect(cell('targets', bare)).toEqual({ kind: 'none', reason: 'The autoscaler names no metric.' });
    expect(cell('replicas', bare)).toEqual({ kind: 'none', reason: 'The autoscaler reports no current replicas.' });
  });

  it('draws the age, and a dash that says why for an object that has no creation time', () => {
    expect(cell('age', web)).toMatchObject({ kind: 'age', text: '2d' });
    expect(cell('age', row({ metadata: { name: 'web', namespace: 'shop' } }))).toEqual({ kind: 'none', reason: 'The HorizontalPodAutoscaler has no creation time.' });
  });

  it('sorts by the word, the reference, the targets, the replicas and the age', () => {
    const sortOf = (id: string, target: HorizontalPodAutoscalerRow = web) => horizontalPodAutoscalerDefinition.fields.find((field) => field.id === id)!.sortValue(target);
    expect([sortOf('status'), sortOf('reference'), sortOf('targets'), sortOf('replicas')]).toEqual(['Scaling active', 'Deployment/web', 'cpu 0%/50%', 1]);
    expect(sortOf('status', autoscaler(undefined))).toBeUndefined();
    expect(sortOf('age')).toBe(Date.UTC(2026, 10, 17, 20, 0, 0));
  });
});
