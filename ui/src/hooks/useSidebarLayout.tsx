 
import {
  usePluginContext,
  useResourceGroups,
  useResourceTypes,
  ResourceIcon,
} from '@omniviewdev/runtime';
import type { ResourceGroup, ResourceType  } from '@omniviewdev/runtime';
import React from 'react';
import {
  LuBlocks,
  LuBoxes,
  LuClipboard,
  LuDatabase,
  LuGauge,
  LuLock,
  LuNetwork,
  LuTicket,
} from 'react-icons/lu';
import { SiHelm } from 'react-icons/si';

import { SidebarWatchBadge } from '../components/kubernetes/sidebar/SidebarWatchBadge';
import DynamicIcon from '../components/shared/Icon';
import type { NavSection, NavMenuItem } from '../types/navigation';
import { IsImage } from '../utils/url';

import { PLUGIN_ID } from '@/pluginId';

type Opts = {
  connectionID: string;
};

/**
 * Get the ID from the meta object
 */
const toID = (type: string) => encodeURIComponent(type);

const primaryTypes: Record<string, true> = { 'k8s:/nodes': true, 'k8s:events.k8s.io/events': true, 'k8s:/namespaces': true };

/** sorter for sorting alphabetically by labels */
const labelSort = (a: NavMenuItem, b: NavMenuItem) => a.label.localeCompare(b.label);

/**
 * Resolve an icon value (string name, image URL, or ReactNode) to a ReactNode.
 */
function resolveIcon(
  icon: string | React.ReactNode | undefined,
  size = 16,
): React.ReactNode | undefined {
  if (!icon) return undefined;
  if (typeof icon !== 'string') return icon;
  if (icon === '') return undefined;
  if (IsImage(icon))
    return <img src={icon} alt="" style={{ width: size, height: size, objectFit: 'contain' }} />;
  return <DynamicIcon name={icon} size={size} />;
}

// --- Module-level icon constants (allocated once, reused forever) ---

const ICON_GAUGE = <LuGauge />;
const ICON_BOXES = <LuBoxes />;
const ICON_CLIPBOARD = <LuClipboard />;
const ICON_NETWORK = <LuNetwork />;
const ICON_DATABASE = <LuDatabase />;
const ICON_LOCK = <LuLock />;
const ICON_TICKET = <LuTicket />;
const ICON_HELM = <SiHelm />;
const ICON_BLOCKS = <LuBlocks />;

/** Aggregate actual resource keys recursively, never synthetic group IDs. */
const getGroupBadge = (children: NavMenuItem[]): React.ReactNode => {
  const keys: string[] = [];
  const visit = (items: NavMenuItem[]) => {
    for (const item of items) {
      if (item.children) visit(item.children);
      else keys.push(decodeURIComponent(item.id));
    }
  };
  visit(children);
  return <SidebarWatchBadge resourceKeys={[...new Set(keys)]} />;
};

const getStateBadge = (navId: string): React.ReactNode =>
  <SidebarWatchBadge resourceKeys={[decodeURIComponent(navId)]} />;

/**
 * Calculates the full sidebar layout divided by the API groups
 */
const calculateFullLayout = (
  data: readonly ResourceGroup[],
  types: readonly ResourceType[],
): Array<NavSection> => {
  if (!data) {
    return [];
  }

  const catalog = new Map(types.map((type) => [type.type, type]));
  const coreSection: NavMenuItem[] = [];
  const crdSection: NavMenuItem[] = [];

  const grouped: NavMenuItem[] = Object.values(data)
    .filter((group): group is ResourceGroup => group !== undefined)
    .filter((group) => group.resources.length > 0)
    .map((group) => {
      const children: NavMenuItem[] = [];

      group.resources.forEach((type) => {
        children.push({
          id: toID(type),
          label: catalog.get(type)?.displayName ?? type,
          icon: <ResourceIcon pluginId={PLUGIN_ID} resourceKey={type} size={16} />,
          badge: getStateBadge(toID(type)),
        });
      });

      children.sort((a, b) => a.label.localeCompare(b.label));

      const item: NavMenuItem = {
        id: group.id,
        label: group.name,
        icon: resolveIcon(group.icon),
        children,
        badge: getGroupBadge(children),
      };

      return item;
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  grouped.forEach((group) => {
    if (!group.children?.some((child) => ModernSectionMap[decodeURIComponent(child.id)] || primaryTypes[decodeURIComponent(child.id)])) {
      crdSection.push(group);
    } else {
      coreSection.push(group);
    }
  });

  const sections: NavSection[] = [
    {
      title: '',
      items: [{ id: '__dashboard__', label: 'Dashboard', icon: ICON_GAUGE }, ...coreSection],
    },
    { title: 'Other API Groups', items: crdSection },
  ];

  return sections;
};

type ModernSection =
  | 'workload'
  | 'config'
  | 'network'
  | 'storage'
  | 'access_control'
  | 'admission_control'
  | 'helm';

/**
 * Map of where found resources should go
 */
const ModernSectionMap: Record<string, ModernSection> = {
  'k8s:/pods': 'workload',
  'k8s:/replicationcontrollers': 'workload',
  'k8s:apps/deployments': 'workload',
  'k8s:apps/daemonsets': 'workload',
  'k8s:apps/replicasets': 'workload',
  'k8s:apps/statefulsets': 'workload',
  'k8s:batch/cronjobs': 'workload',
  'k8s:batch/jobs': 'workload',
  'k8s:/configmaps': 'config',
  'k8s:/secrets': 'config',
  'k8s:/resourcequotas': 'config',
  'k8s:/limitranges': 'config',
  'k8s:autoscaling/horizontalpodautoscalers': 'config',
  'k8s:policy/poddisruptionbudgets': 'config',
  'k8s:scheduling.k8s.io/priorityclasses': 'config',
  'k8s:node.k8s.io/runtimeclasses': 'config',
  'k8s:coordination.k8s.io/leases': 'config',
  'k8s:flowcontrol.apiserver.k8s.io/flowschemas': 'config',
  'k8s:flowcontrol.apiserver.k8s.io/prioritylevelconfigurations': 'config',
  'k8s:networking.k8s.io/ingresses': 'network',
  'k8s:networking.k8s.io/ingressclasses': 'network',
  'k8s:/endpoints': 'network',
  'k8s:discovery.k8s.io/endpointslices': 'network',
  'k8s:/services': 'network',
  'k8s:networking.k8s.io/networkpolicies': 'network',
  'k8s:/persistentvolumes': 'storage',
  'k8s:/persistentvolumeclaims': 'storage',
  'k8s:storage.k8s.io/storageclasses': 'storage',
  'k8s:storage.k8s.io/csidrivers': 'storage',
  'k8s:storage.k8s.io/csinodes': 'storage',
  'k8s:storage.k8s.io/volumeattachments': 'storage',
  'k8s:/serviceaccounts': 'access_control',
  'k8s:rbac.authorization.k8s.io/roles': 'access_control',
  'k8s:rbac.authorization.k8s.io/clusterroles': 'access_control',
  'k8s:rbac.authorization.k8s.io/rolebindings': 'access_control',
  'k8s:rbac.authorization.k8s.io/clusterrolebindings': 'access_control',
  'k8s:admissionregistration.k8s.io/mutatingwebhookconfigurations': 'admission_control',
  'k8s:admissionregistration.k8s.io/validatingwebhookconfigurations': 'admission_control',
  'k8s:admissionregistration.k8s.io/validatingadmissionpolicies': 'admission_control',
  'k8s:admissionregistration.k8s.io/validatingadmissionpolicybindings': 'admission_control',
  'helm:releases': 'helm',
  'helm:repositories': 'helm',
  'helm:charts': 'helm',
};

/**
 * Calculates a modern sidebar layout inspired by Kubernetes Dashboard for familiarity. Only adds
 * resources that are available.
 */
const calculateModernLayout = (
  data: readonly ResourceGroup[],
  types: readonly ResourceType[],
): Array<NavSection> => {
  if (!data) {
    return [];
  }

  const catalog = new Map(types.map((type) => [type.type, type]));
  const groupCatalog = new Map(data.map((group) => [group.id, group]));
  const available = new Set([...catalog.keys(), ...data.flatMap((group) => group.resources)]);
  const withBadge = (id: string, label: string): NavMenuItem => ({
    id,
    label,
    icon: <ResourceIcon pluginId={PLUGIN_ID} resourceKey={decodeURIComponent(id)} size={16} />,
    badge: getStateBadge(id),
  });

  // Grouped Resource areas
  const workloadResources: NavMenuItem[] = [];
  const configResources: NavMenuItem[] = [];
  const networkResources: NavMenuItem[] = [];
  const storageResources: NavMenuItem[] = [];
  const accessControlResources: NavMenuItem[] = [];
  const admissionControlResources: NavMenuItem[] = [];
  const helmResources: NavMenuItem[] = [];

  const crds: Record<string, Array<NavMenuItem>> = {};

  Object.values(data).forEach((group) => {
    if (!group) return;
    group.resources.forEach((type) => {
        const label = catalog.get(type)?.displayName ?? type;
        const navItem = withBadge(toID(type), label);
        if (primaryTypes[type]) return;
        // Unclassified catalog types remain available under their declared group.
        if (!ModernSectionMap[type]) {
          if (!crds[group.id]) {
            crds[group.id] = [];
          }
          crds[group.id].push(navItem);
        } else {
          switch (ModernSectionMap[type]) {
            case 'workload':
              workloadResources.push(navItem);
              break;
            case 'config':
              configResources.push(navItem);
              break;
            case 'network':
              networkResources.push(navItem);
              break;
            case 'storage':
              storageResources.push(navItem);
              break;
            case 'access_control':
              accessControlResources.push(navItem);
              break;
            case 'admission_control':
              admissionControlResources.push(navItem);
              break;
            case 'helm':
              helmResources.push(navItem);
              break;
          }
        }
      });
  });

  const crdChildren: NavMenuItem[] = Object.entries(crds).map(([group, entry]) => ({
    id: group,
    label: groupCatalog.get(group)?.name ?? group,
    children: entry.sort(labelSort),
    badge: getGroupBadge(entry),
  }));

  const workloadSorted = workloadResources.sort(labelSort);
  const configSorted = configResources.sort(labelSort);
  const networkSorted = networkResources.sort(labelSort);
  const storageSorted = storageResources.sort(labelSort);
  const accessSorted = accessControlResources.sort(labelSort);
  const admissionSorted = admissionControlResources.sort(labelSort);
  const helmSorted = helmResources.sort(labelSort);
  const crdSorted = crdChildren.sort(labelSort);

  const sections: NavSection[] = [
    {
      title: '',
      items: [
        { id: '__dashboard__', label: 'Dashboard', icon: ICON_GAUGE },
        ...Object.keys(primaryTypes)
          .filter((key) => available.has(key))
          .map((key) => withBadge(toID(key), catalog.get(key)?.displayName ?? ({
            'k8s:/nodes': 'Nodes',
            'k8s:events.k8s.io/events': 'Events',
            'k8s:/namespaces': 'Namespaces',
          } as Record<string, string>)[key] ?? key)),
        {
          id: 'workload',
          label: 'Workload',
          icon: ICON_BOXES,
          children: workloadSorted,
          badge: getGroupBadge(workloadSorted),
        },
        {
          id: 'config',
          label: 'Config',
          icon: ICON_CLIPBOARD,
          children: configSorted,
          badge: getGroupBadge(configSorted),
        },
        {
          id: 'network',
          label: 'Networking',
          icon: ICON_NETWORK,
          children: networkSorted,
          badge: getGroupBadge(networkSorted),
        },
        {
          id: 'storage',
          label: 'Storage',
          icon: ICON_DATABASE,
          children: storageSorted,
          badge: getGroupBadge(storageSorted),
        },
        {
          id: 'access_control',
          label: 'Access Control',
          icon: ICON_LOCK,
          children: accessSorted,
          badge: getGroupBadge(accessSorted),
        },
        {
          id: 'admission_control',
          label: 'Admission Control',
          icon: ICON_TICKET,
          children: admissionSorted,
          badge: getGroupBadge(admissionSorted),
        },
        {
          id: 'helm',
          label: 'Helm',
          icon: ICON_HELM,
          children: helmSorted,
          badge: getGroupBadge(helmSorted),
        },
        {
          id: 'crd',
          label: 'Other API Groups',
          icon: ICON_BLOCKS,
          children: crdSorted,
          badge: getGroupBadge(crdSorted),
        },
      ].filter((item) => !('children' in item) || !!item.children?.length),
    },
  ];

  return sections;
};

/**
 * Provide one of number of sidebar layouts to the caller
 */
export const useSidebarLayout = ({ connectionID }: Opts) => {
  const { settings } = usePluginContext();
  const { groups } = useResourceGroups({ pluginID: PLUGIN_ID, route: { connection: connectionID } });
  const { resourceTypes } = useResourceTypes({ pluginID: PLUGIN_ID, route: { connection: connectionID } });
  const layoutSetting = settings[`${PLUGIN_ID}.layout`] as string | undefined;
  const layout = React.useMemo(() => {
    if (!groups.data) return [];
    return layoutSetting === 'full'
      ? calculateFullLayout(groups.data, resourceTypes.data ?? [])
      : calculateModernLayout(groups.data, resourceTypes.data ?? []);
  }, [groups.data, resourceTypes.data, layoutSetting]);

  return {
    layout,
    isLoading: !groups.data,
  };
};
