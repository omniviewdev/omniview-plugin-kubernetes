import type { DrawerComponentAction, DrawerContext } from '@omniviewdev/runtime';

import { drawerActions as validatingAdmissionPolicyBindingActions } from './table/admissionregistrationv1/ValidatingAdmissionPolicyBinding/actions';
import { drawerActions as daemonSetActions } from './table/appsv1/DaemonSet/actions';
import { drawerActions as deploymentActions, editorSubmit as deploymentEditorSubmit } from './table/appsv1/Deployment/actions';
import { drawerActions as replicaSetActions } from './table/appsv1/ReplicaSet/actions';
import { drawerActions as statefulSetActions } from './table/appsv1/StatefulSet/actions';
import { drawerActions as horizontalPodAutoscalerActions } from './table/autoscalingv1/HorizontalPodAutoscaler/actions';
import { drawerActions as cronJobActions } from './table/batchv1/CronJob/actions';
import { drawerActions as jobActions } from './table/batchv1/Job/actions';
import { drawerActions as endpointsActions } from './table/corev1/Endpoints/actions';
import { drawerActions as limitRangeActions } from './table/corev1/LimitRange/actions';
import { drawerActions as namespaceActions } from './table/corev1/Namespace/actions';
import { drawerActions as nodeActions } from './table/corev1/Node/actions';
import { drawerActions as persistentVolumeActions } from './table/corev1/PersistentVolume/actions';
import { drawerActions as persistentVolumeClaimActions } from './table/corev1/PersistentVolumeClaim/actions';
import { drawerActions as podActions, editorSubmit as podEditorSubmit } from './table/corev1/Pod/actions';
import { drawerActions as replicationControllerActions } from './table/corev1/ReplicationController/actions';
import { drawerActions as resourceQuotaActions } from './table/corev1/ResourceQuota/actions';
import { drawerActions as serviceActions } from './table/corev1/Service/actions';
import { drawerActions as serviceAccountActions } from './table/corev1/ServiceAccount/actions';
import { drawerActions as endpointSliceActions } from './table/discoveryv1/EndpointSlice/actions';
import { drawerActions as flowSchemaActions } from './table/flowcontrolv1/FlowSchema/actions';
import { drawerActions as ingressActions } from './table/networkingv1/Ingress/actions';
import { drawerActions as ingressClassActions } from './table/networkingv1/IngressClass/actions';
import { drawerActions as networkPolicyActions } from './table/networkingv1/NetworkPolicy/actions';
import { drawerActions as runtimeClassActions } from './table/nodev1/RuntimeClass/actions';
import { drawerActions as podDisruptionBudgetActions } from './table/policyv1/PodDisruptionBudget/actions';
import { drawerActions as clusterRoleActions } from './table/rbacv1/ClusterRole/actions';
import { drawerActions as clusterRoleBindingActions } from './table/rbacv1/ClusterRoleBinding/actions';
import { drawerActions as roleActions } from './table/rbacv1/Role/actions';
import { drawerActions as roleBindingActions } from './table/rbacv1/RoleBinding/actions';
import { drawerActions as cSIDriverActions } from './table/storagev1/CSIDriver/actions';
import { drawerActions as cSINodeActions } from './table/storagev1/CSINode/actions';
import { drawerActions as storageClassActions } from './table/storagev1/StorageClass/actions';
import { drawerActions as volumeAttachmentActions } from './table/storagev1/VolumeAttachment/actions';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyAction = DrawerComponentAction<any>;

export type ResourceDrawerActions = {
  actions: Array<AnyAction>;
  /** Saves the Editor view; only resources whose table supported editing have one. */
  editorSubmit?: (ctx: DrawerContext, value: Record<string, unknown>) => void;
};

/**
 * Drawer actions per resource key, shared by the resource tables and by the
 * drawer factories in `entry.ts` that open linked resources (owner chips,
 * Related and Graph views). Keeping one list means a resource offers the same
 * actions however its drawer was opened.
 */
export const resourceDrawerActions: Record<string, ResourceDrawerActions> = {
  'admissionregistration::v1::ValidatingAdmissionPolicyBinding': { actions: validatingAdmissionPolicyBindingActions },
  'apps::v1::DaemonSet': { actions: daemonSetActions },
  'apps::v1::Deployment': { actions: deploymentActions, editorSubmit: deploymentEditorSubmit },
  'apps::v1::ReplicaSet': { actions: replicaSetActions },
  'apps::v1::StatefulSet': { actions: statefulSetActions },
  'autoscaling::v1::HorizontalPodAutoscaler': { actions: horizontalPodAutoscalerActions },
  'autoscaling::v2::HorizontalPodAutoscaler': { actions: horizontalPodAutoscalerActions },
  'batch::v1::CronJob': { actions: cronJobActions },
  'batch::v1::Job': { actions: jobActions },
  'core::v1::Endpoints': { actions: endpointsActions },
  'core::v1::LimitRange': { actions: limitRangeActions },
  'core::v1::Namespace': { actions: namespaceActions },
  'core::v1::Node': { actions: nodeActions },
  'core::v1::PersistentVolume': { actions: persistentVolumeActions },
  'core::v1::PersistentVolumeClaim': { actions: persistentVolumeClaimActions },
  'core::v1::Pod': { actions: podActions, editorSubmit: podEditorSubmit },
  'core::v1::ReplicationController': { actions: replicationControllerActions },
  'core::v1::ResourceQuota': { actions: resourceQuotaActions },
  'core::v1::Service': { actions: serviceActions },
  'core::v1::ServiceAccount': { actions: serviceAccountActions },
  'discovery::v1::EndpointSlice': { actions: endpointSliceActions },
  'flowcontrol::v1::FlowSchema': { actions: flowSchemaActions },
  'flowcontrol::v1beta3::FlowSchema': { actions: flowSchemaActions },
  'networking::v1::Ingress': { actions: ingressActions },
  'networking::v1::IngressClass': { actions: ingressClassActions },
  'networking::v1::NetworkPolicy': { actions: networkPolicyActions },
  'node::v1::RuntimeClass': { actions: runtimeClassActions },
  'policy::v1::PodDisruptionBudget': { actions: podDisruptionBudgetActions },
  'rbac::v1::ClusterRole': { actions: clusterRoleActions },
  'rbac::v1::ClusterRoleBinding': { actions: clusterRoleBindingActions },
  'rbac::v1::Role': { actions: roleActions },
  'rbac::v1::RoleBinding': { actions: roleBindingActions },
  'storage::v1::CSIDriver': { actions: cSIDriverActions },
  'storage::v1::CSINode': { actions: cSINodeActions },
  'storage::v1::StorageClass': { actions: storageClassActions },
  'storage::v1::VolumeAttachment': { actions: volumeAttachmentActions },
};
