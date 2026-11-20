import type { HostRecord } from '@omniviewdev/runtime/ui/v1';

import { bodyOf, count, isObject, metadataOf, objects, text, type Json, type ObjectMeta } from '../object';

// The part of a HorizontalPodAutoscaler (autoscaling/v2) that the list reads: what it scales, the metrics it aims at and the readings of them that the controller took, the replicas it reports and its
// conditions. Anything the object does not hold is absent here, and stays absent downstream (`../object.ts`).

/** What a metric is aimed at or reads: a utilization (a percent of what the Pods request) or an average value (a quantity text, `100Mi`). */
export type Measure = {
  readonly averageUtilization?: number;
  readonly averageValue?: string;
};

/** A metric of `spec.metrics` (the resource has a `target`) or of `status.currentMetrics` (the resource has a `current`). `resource` is what a metric of type `Resource` names. */
export type Metric = {
  readonly type?: string;
  readonly resource?: { readonly name?: string; readonly target?: Measure; readonly current?: Measure };
};

export type AutoscalerCondition = {
  readonly type?: string;
  readonly status?: string;
};

export type HorizontalPodAutoscalerObject = {
  readonly metadata?: ObjectMeta;
  readonly spec?: {
    readonly scaleTargetRef?: { readonly kind?: string; readonly name?: string };
    readonly metrics?: readonly Metric[];
  };
  readonly status?: {
    readonly currentReplicas?: number;
    readonly currentMetrics?: readonly Metric[];
    readonly conditions?: readonly AutoscalerCondition[];
  };
};

const measureOf = (value: unknown): Measure | undefined => (isObject(value) ? { averageUtilization: count(value.averageUtilization), averageValue: text(value.averageValue) } : undefined);

const metricOf = (metric: Json): Metric => ({
  type: text(metric.type),
  resource: isObject(metric.resource) ? { name: text(metric.resource.name), target: measureOf(metric.resource.target), current: measureOf(metric.resource.current) } : undefined,
});

/** What the list reads of an object of unknown shape: each field kept only when it has the type the API gives it. */
function toAutoscaler(value: unknown): HorizontalPodAutoscalerObject {
  if (!isObject(value)) {
    return {};
  }

  const { metadata, spec, status } = value;
  return {
    metadata: metadataOf(metadata),
    spec: isObject(spec)
      ? {
        scaleTargetRef: isObject(spec.scaleTargetRef) ? { kind: text(spec.scaleTargetRef.kind), name: text(spec.scaleTargetRef.name) } : undefined,
        metrics: objects(spec.metrics)?.map(metricOf),
      }
      : undefined,
    status: isObject(status)
      ? {
        currentReplicas: count(status.currentReplicas),
        currentMetrics: objects(status.currentMetrics)?.map(metricOf),
        conditions: objects(status.conditions)?.map((condition) => ({ type: text(condition.type), status: text(condition.status) })),
      }
      : undefined,
  };
}

/** The HorizontalPodAutoscaler a record holds. A body that is not one gives an empty one, never an error: one odd object must not take the list down. */
export function horizontalPodAutoscalerObject(host: HostRecord): HorizontalPodAutoscalerObject {
  return toAutoscaler(bodyOf(host));
}
