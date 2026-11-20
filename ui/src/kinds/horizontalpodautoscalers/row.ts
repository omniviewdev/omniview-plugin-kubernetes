import type { KindRow } from '../definition';
import { identityOf, rowModel } from '../rows';
import { statusOf, type KindStatus } from '../status';

import { horizontalPodAutoscalerObject, type HorizontalPodAutoscalerObject, type Measure } from './object';

/** What the list holds of one HorizontalPodAutoscaler. A field the object does not hold is undefined. */
export type HorizontalPodAutoscalerRow = KindRow & {
  /** The word of `autoscalerState` and its role. None before the controller has reported. kubectl prints no state. */
  readonly status: KindStatus | undefined;
  /** `<kind>/<name>` of `spec.scaleTargetRef`: kubectl's REFERENCE. */
  readonly reference: string | undefined;
  /** One piece for each metric of the spec (`cpu 0%/50%`, `memory 304Ki/100Mi`, `pods`): kubectl's TARGETS, in the mock's words. A spec that names no metric has none. */
  readonly targets: readonly string[] | undefined;
  /** `status.currentReplicas`: kubectl's REPLICAS. The API leaves a zero out, so a status that holds none says nothing. */
  readonly replicas: number | undefined;
};

/**
 * The state word of an autoscaler, from the conditions its controller writes (the mock's `hpaState`, which says Scaling active for an autoscaler that has not reported): Unable to scale when it cannot get its
 * target's scale or compute a count (AbleToScale or ScalingActive is False), Limited when the minimum or the maximum cut the count it wanted (ScalingLimited is True), Scaling active when it is working
 * (ScalingActive is True). Before the controller has written those conditions, or while ScalingActive is Unknown, there is no word: the object does not say one, and none is made up.
 */
export function autoscalerState({ status }: HorizontalPodAutoscalerObject): string | undefined {
  const is = (type: string, state: string) => status?.conditions?.find((condition) => condition.type === type)?.status === state;

  if (is('AbleToScale', 'False') || is('ScalingActive', 'False')) {
    return 'Unable to scale';
  }

  if (is('ScalingLimited', 'True')) {
    return 'Limited';
  }

  return is('ScalingActive', 'True') ? 'Scaling active' : undefined;
}

/** What the object does not state of a metric, as the mock says it: a dash. kubectl prints `<unknown>` for a reading it cannot make. */
const UNSTATED = '—';

const percent = (value: number): string => `${value}%`;

/**
 * The piece for a metric of type `Resource`: `<resource> <current>/<target>`. A utilization is aimed at in percent and an average value as the quantity text the object holds. The current is the reading of the
 * kind the target aims at, and a dash when the status holds none (the controller has not read the metric); a target that states neither is a dash too.
 */
function resourcePiece(name: string, target: Measure | undefined, current: Measure | undefined): string {
  if (target?.averageUtilization !== undefined) {
    return `${name} ${current?.averageUtilization === undefined ? UNSTATED : percent(current.averageUtilization)}/${percent(target.averageUtilization)}`;
  }

  if (target?.averageValue !== undefined) {
    return `${name} ${current?.averageValue ?? UNSTATED}/${target.averageValue}`;
  }

  return `${name} ${UNSTATED}/${UNSTATED}`;
}

/**
 * The pieces for the metrics of the spec, in order (the mock's `hpaTargets`, with the reading of an average value fixed: the mock reads a utilization only, so a memory metric says `undefined%`). The current of a
 * Resource metric is that of the entry of `status.currentMetrics` of the same type and resource, found by name and not by place. A metric of another type (Pods, Object, External, ContainerResource) is its type
 * in lower case, as the mock says it. None when no metric is named.
 */
function targetsOf({ spec, status }: HorizontalPodAutoscalerObject): readonly string[] | undefined {
  const pieces = (spec?.metrics ?? []).flatMap((metric): string[] => {
    const name = metric.resource?.name;
    if (metric.type === 'Resource' && name !== undefined && name !== '') {
      const reading = status?.currentMetrics?.find((candidate) => candidate.type === 'Resource' && candidate.resource?.name === name);
      return [resourcePiece(name, metric.resource?.target, reading?.resource?.current)];
    }

    return metric.type === undefined || metric.type === '' ? [] : [metric.type.toLowerCase()];
  });
  return pieces.length === 0 ? undefined : pieces;
}

/** `<kind>/<name>` of what the autoscaler scales (kubectl's REFERENCE); none when the spec names no target, or a target with no kind or no name. */
function referenceOf({ spec }: HorizontalPodAutoscalerObject): string | undefined {
  const target = spec?.scaleTargetRef;
  return target?.kind === undefined || target.kind === '' || target.name === undefined || target.name === '' ? undefined : `${target.kind}/${target.name}`;
}

// The HorizontalPodAutoscalers' rows: one per record object, computed once (`../rows.ts`). An object that has no spec or no status says nothing of what they hold: the list shows dashes, and no word, no
// zero and no metric is made up for it.
export const { row: horizontalPodAutoscalerRow, rows: horizontalPodAutoscalerRows, searchText: horizontalPodAutoscalerSearchText } = rowModel(
  (host): HorizontalPodAutoscalerRow => {
    const autoscaler = horizontalPodAutoscalerObject(host);
    return {
      ...identityOf(host, autoscaler, false),
      status: statusOf(autoscalerState(autoscaler)),
      reference: referenceOf(autoscaler),
      targets: targetsOf(autoscaler),
      replicas: autoscaler.status?.currentReplicas,
    };
  },
  (row) => [row.name, row.namespace, row.status?.word, row.reference, ...(row.targets ?? []), row.replicas?.toString()],
);
