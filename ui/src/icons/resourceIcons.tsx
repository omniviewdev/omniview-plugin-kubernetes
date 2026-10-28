import type { ComponentType } from 'react';
import type { ResourceIconProps, ResourceIconSetV1 } from '@omniviewdev/runtime';
import nodeIcon from './kubernetes/node.svg?raw';
import podIcon from './kubernetes/pod.svg?raw';
import replicaSetIcon from './kubernetes/rs.svg?raw';
import configMapIcon from './kubernetes/cm.svg?raw';
import secretIcon from './kubernetes/secret.svg?raw';
import namespaceIcon from './kubernetes/ns.svg?raw';
import serviceIcon from './kubernetes/svc.svg?raw';
import endpointsIcon from './kubernetes/ep.svg?raw';
import persistentVolumeIcon from './kubernetes/pv.svg?raw';
import persistentVolumeClaimIcon from './kubernetes/pvc.svg?raw';
import resourceQuotaIcon from './kubernetes/quota.svg?raw';
import limitRangeIcon from './kubernetes/limits.svg?raw';
import serviceAccountIcon from './kubernetes/sa.svg?raw';
import deploymentIcon from './kubernetes/deploy.svg?raw';
import daemonSetIcon from './kubernetes/ds.svg?raw';
import statefulSetIcon from './kubernetes/sts.svg?raw';
import jobIcon from './kubernetes/job.svg?raw';
import cronJobIcon from './kubernetes/cronjob.svg?raw';
import horizontalPodAutoscalerIcon from './kubernetes/hpa.svg?raw';
import ingressIcon from './kubernetes/ing.svg?raw';
import networkPolicyIcon from './kubernetes/netpol.svg?raw';
import roleIcon from './kubernetes/role.svg?raw';
import clusterRoleIcon from './kubernetes/c-role.svg?raw';
import roleBindingIcon from './kubernetes/rb.svg?raw';
import clusterRoleBindingIcon from './kubernetes/crb.svg?raw';
import storageClassIcon from './kubernetes/sc.svg?raw';
import customResourceDefinitionIcon from './kubernetes/crd.svg?raw';
import podSecurityPolicyIcon from './kubernetes/psp.svg?raw';

function nativeIcon(source: string): ComponentType<ResourceIconProps> {
  // Only sanitized, repository-owned SVGs enter this path. Never accept runtime markup.
  const [, viewBox, body] = /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="([^"]+)">([\s\S]*)<\/svg>\s*$/.exec(source)!;
  const markup = { __html: body };
  return function NativeResourceIcon({ size = 16, className, 'aria-hidden': hidden = true }) {
    return <svg width={size} height={size} viewBox={viewBox} fill="currentColor" className={className} aria-hidden={hidden} focusable="false" style={{ width: size, height: size, flexShrink: 0 }} dangerouslySetInnerHTML={markup} />;
  };
}

const icons: Record<string, ComponentType<ResourceIconProps>> = {
  'core::Node': nativeIcon(nodeIcon),
  'core::Pod': nativeIcon(podIcon),
  'core::ConfigMap': nativeIcon(configMapIcon),
  'core::Secret': nativeIcon(secretIcon),
  'core::Namespace': nativeIcon(namespaceIcon),
  'core::Service': nativeIcon(serviceIcon),
  'core::Endpoints': nativeIcon(endpointsIcon),
  'core::PersistentVolume': nativeIcon(persistentVolumeIcon),
  'core::PersistentVolumeClaim': nativeIcon(persistentVolumeClaimIcon),
  'core::ResourceQuota': nativeIcon(resourceQuotaIcon),
  'core::LimitRange': nativeIcon(limitRangeIcon),
  'core::ServiceAccount': nativeIcon(serviceAccountIcon),
  'apps::Deployment': nativeIcon(deploymentIcon),
  'apps::DaemonSet': nativeIcon(daemonSetIcon),
  'apps::ReplicaSet': nativeIcon(replicaSetIcon),
  'apps::StatefulSet': nativeIcon(statefulSetIcon),
  'batch::Job': nativeIcon(jobIcon),
  'batch::CronJob': nativeIcon(cronJobIcon),
  'autoscaling::HorizontalPodAutoscaler': nativeIcon(horizontalPodAutoscalerIcon),
  'networking::Ingress': nativeIcon(ingressIcon),
  'networking::NetworkPolicy': nativeIcon(networkPolicyIcon),
  'rbac::Role': nativeIcon(roleIcon),
  'rbac::ClusterRole': nativeIcon(clusterRoleIcon),
  'rbac::RoleBinding': nativeIcon(roleBindingIcon),
  'rbac::ClusterRoleBinding': nativeIcon(clusterRoleBindingIcon),
  'storage::StorageClass': nativeIcon(storageClassIcon),
  'apiextensions::CustomResourceDefinition': nativeIcon(customResourceDefinitionIcon),
  'policy::PodSecurityPolicy': nativeIcon(podSecurityPolicyIcon),
};

/** Kubernetes owns key parsing. Native artwork remains stable across API versions. */
export const kubernetesResourceIconSet: ResourceIconSetV1 = {
  schemaVersion: 1,
  resolve(resourceKey) {
    const parts = resourceKey.split('::');
    if (parts.length !== 3 || !parts[1] || !parts[2]) return undefined;
    const aliases: Record<string, string> = {
      'rbac.authorization.k8s.io': 'rbac',
      'networking.k8s.io': 'networking',
      'storage.k8s.io': 'storage',
      'apiextensions.k8s.io': 'apiextensions',
    };
    const group = aliases[parts[0]] ?? (parts[0] || 'core');
    return icons[`${group}::${parts[2]}`];
  },
};

