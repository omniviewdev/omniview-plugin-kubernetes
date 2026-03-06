/* eslint-disable react-refresh/only-export-components */
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import {
  usePluginContext,
  useResourceGroups,
  useWatchState,
  WatchState,
} from '@omniviewdev/runtime';
import { types } from '@omniviewdev/runtime/models';
import type { NavSection, NavMenuItem } from '@omniviewdev/ui/sidebars';
import React from 'react';
import {
  LuBlocks,
  LuBoxes,
  LuClipboard,
  LuCloudLightning,
  LuDatabase,
  LuGauge,
  LuLayers2,
  LuLock,
  LuNetwork,
  LuServer,
  LuTicket,
} from 'react-icons/lu';
import { SiHelm } from 'react-icons/si';

import DynamicIcon from '../components/shared/Icon';
import { toResourceKey } from '../utils/resourceKey';
import { IsImage } from '../utils/url';

import { useStableObject } from './useStableRef';

type Opts = {
  connectionID: string;
};

/**
 * Get the ID from the meta object
 */
const toID = (meta: types.ResourceMeta) => `${meta.group}_${meta.version}_${meta.kind}`;

/**
 * Returns whether the item is a CRD resource or not
 */
const isCrd = (group: string) => group.includes('.') && !group.includes('.k8s.io');

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
const ICON_SERVER = <LuServer />;
const ICON_CLOUD_LIGHTNING = <LuCloudLightning />;
const ICON_LAYERS = <LuLayers2 />;
const ICON_BOXES = <LuBoxes />;
const ICON_CLIPBOARD = <LuClipboard />;
const ICON_NETWORK = <LuNetwork />;
const ICON_DATABASE = <LuDatabase />;
const ICON_LOCK = <LuLock />;
const ICON_TICKET = <LuTicket />;
const ICON_HELM = <SiHelm />;
const ICON_BLOCKS = <LuBlocks />;

// --- Module-level badge JSX constants ---

const syncingBadgeSx = { color: 'var(--ov-accent-fg, #58a6ff)' } as const;

const errorBadgeSx = { width: 8, height: 8, borderRadius: '50%', bgcolor: 'error.main', flexShrink: 0 } as const;

const SYNCING_BADGE = (
  <CircularProgress size={10} thickness={5} sx={syncingBadgeSx} />
);
const ERROR_BADGE = (
  <Box sx={errorBadgeSx} />
);

/** Get a badge for a nav item based on its watch state */
const getStateBadge = (
  navId: string,
  states?: Record<string, WatchState>,
): React.ReactNode | undefined => {
  if (!states) return undefined;
  const state = states[toResourceKey(navId)];
  if (state === WatchState.SYNCING || state === WatchState.IDLE)
    return SYNCING_BADGE;
  if (state === WatchState.ERROR || state === WatchState.FAILED || state === WatchState.FORBIDDEN) return ERROR_BADGE;
  return undefined;
};

/** Get a group-level badge by aggregating children states */
const getGroupBadge = (
  children: NavMenuItem[],
  states?: Record<string, WatchState>,
): React.ReactNode | undefined => {
  if (!states || !children?.length) return undefined;
  let hasSyncing = false;
  let hasError = false;
  for (const child of children) {
    const state = states[toResourceKey(child.id)];
    if (state === WatchState.SYNCING || state === WatchState.IDLE)
      hasSyncing = true;
    if (state === WatchState.ERROR || state === WatchState.FAILED || state === WatchState.FORBIDDEN) hasError = true;
  }
  if (hasError) return ERROR_BADGE;
  if (hasSyncing) return SYNCING_BADGE;
  return undefined;
};

/**
 * Calculates the full sidebar layout divided by the API groups
 */
const calculateFullLayout = (
  data: Record<string, types.ResourceGroup>,
  watchStates?: Record<string, WatchState>,
): Array<NavSection> => {
  if (!data) {
    return [];
  }

  const coreSection: NavMenuItem[] = [];
  const crdSection: NavMenuItem[] = [];

  const grouped: NavMenuItem[] = Object.values(data)
    .map((group) => {
      const children: NavMenuItem[] = [];

      Object.entries(group.resources).forEach(([_, metas]) => {
        metas.forEach((meta) => {
          children.push({
            id: toID(meta),
            label: meta.kind,
            icon: resolveIcon(meta.icon),
            badge: getStateBadge(toID(meta), watchStates),
          });
        });
      });

      children.sort((a, b) => a.label.localeCompare(b.label));

      const item: NavMenuItem = {
        id: group.id,
        label: group.name,
        icon: resolveIcon(group.icon),
        children,
        badge: getGroupBadge(children, watchStates),
      };

      return item;
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  grouped.forEach((group) => {
    if (isCrd(group.label)) {
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
    { title: 'Custom Resource Definitions', items: crdSection },
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
  // Workload
  Pod: 'workload',
  ReplicationController: 'workload',
  Deployment: 'workload',
  DaemonSet: 'workload',
  ReplicaSet: 'workload',
  StatefulSet: 'workload',
  CronJob: 'workload',
  Job: 'workload',

  // Config
  ConfigMap: 'config',
  Secret: 'config',
  ResourceQuota: 'config',
  LimitRange: 'config',
  HorizontalPodAutoscaler: 'config',
  PodDisruptionBudget: 'config',
  PriorityClass: 'config',
  RuntimeClass: 'config',
  Lease: 'config',
  FlowSchema: 'config',
  PriorityLevelConfiguration: 'config',

  // Networking
  Ingress: 'network',
  IngressClass: 'network',
  Endpoints: 'network',
  EndpointSlice: 'network',
  Service: 'network',
  NetworkPolicy: 'network',

  // Storage
  PersistentVolume: 'storage',
  PersistentVolumeClaim: 'storage',
  StorageClass: 'storage',
  CSIDriver: 'storage',
  CSINode: 'storage',
  VolumeAttachment: 'storage',

  // Access Control
  ServiceAccount: 'access_control',
  Role: 'access_control',
  ClusterRole: 'access_control',
  RoleBinding: 'access_control',
  ClusterRoleBinding: 'access_control',

  // Admission Control
  MutatingWebhookConfiguration: 'admission_control',
  ValidatingWebhookConfiguration: 'admission_control',
  ValidatingAdmissionPolicy: 'admission_control',
  ValidatingAdmissionPolicyBinding: 'admission_control',

  // Helm
  Release: 'helm',
  Repository: 'helm',
  Chart: 'helm',
};

/**
 * Calculates a modern sidebar layout inspired by Kubernetes Dashboard for familiarity. Only adds
 * resources that are available.
 */
const calculateModernLayout = (
  data: Record<string, types.ResourceGroup>,
  watchStates?: Record<string, WatchState>,
): Array<NavSection> => {
  if (!data) {
    return [];
  }

  const withBadge = (id: string, label: string): NavMenuItem => ({
    id,
    label,
    badge: getStateBadge(id, watchStates),
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
    Object.entries(group.resources).forEach(([_, metas]) => {
      metas.forEach((meta) => {
        const navItem = withBadge(toID(meta), meta.kind);
        // if CRD, push to CRD
        if (isCrd(meta.group)) {
          if (!crds[meta.group]) {
            crds[meta.group] = [];
          }
          crds[meta.group].push(navItem);
        } else {
          switch (ModernSectionMap[meta.kind]) {
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
  });

  const crdChildren: NavMenuItem[] = Object.entries(crds).map(([group, entry]) => ({
    id: group,
    label: group,
    children: entry.sort(labelSort),
    badge: getGroupBadge(entry, watchStates),
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
        {
          id: 'core_v1_Node',
          label: 'Nodes',
          icon: ICON_SERVER,
          badge: getStateBadge('core_v1_Node', watchStates),
        },
        {
          id: 'events_v1_Event',
          label: 'Events',
          icon: ICON_CLOUD_LIGHTNING,
          badge: getStateBadge('events_v1_Event', watchStates),
        },
        {
          id: 'core_v1_Namespace',
          label: 'Namespaces',
          icon: ICON_LAYERS,
          badge: getStateBadge('core_v1_Namespace', watchStates),
        },
        {
          id: 'workload',
          label: 'Workload',
          icon: ICON_BOXES,
          children: workloadSorted,
          badge: getGroupBadge(workloadSorted, watchStates),
        },
        {
          id: 'config',
          label: 'Config',
          icon: ICON_CLIPBOARD,
          children: configSorted,
          badge: getGroupBadge(configSorted, watchStates),
        },
        {
          id: 'network',
          label: 'Networking',
          icon: ICON_NETWORK,
          children: networkSorted,
          badge: getGroupBadge(networkSorted, watchStates),
        },
        {
          id: 'storage',
          label: 'Storage',
          icon: ICON_DATABASE,
          children: storageSorted,
          badge: getGroupBadge(storageSorted, watchStates),
        },
        {
          id: 'access_control',
          label: 'Access Control',
          icon: ICON_LOCK,
          children: accessSorted,
          badge: getGroupBadge(accessSorted, watchStates),
        },
        {
          id: 'admission_control',
          label: 'Admission Control',
          icon: ICON_TICKET,
          children: admissionSorted,
          badge: getGroupBadge(admissionSorted, watchStates),
        },
        {
          id: 'helm',
          label: 'Helm',
          icon: ICON_HELM,
          children: helmSorted,
          badge: getGroupBadge(helmSorted, watchStates),
        },
        {
          id: 'crd',
          label: 'Custom Resource Definitions',
          icon: ICON_BLOCKS,
          children: crdSorted,
          badge: getGroupBadge(crdSorted, watchStates),
        },
      ],
    },
  ];

  return sections;
};

/**
 * Provide one of number of sidebar layouts to the caller
 */
export const useSidebarLayout = ({ connectionID }: Opts) => {
  const { settings } = usePluginContext();
  const { groups } = useResourceGroups({ pluginID: 'kubernetes', connectionID });
  const { summary, isFullySynced } = useWatchState({ pluginID: 'kubernetes', connectionID });

  // Stabilize the watchStates reference so we don't recalculate on every
  // watch event when the actual values haven't changed.
  const watchStates = useStableObject(summary.data?.resources);

  const layoutSetting = settings['kubernetes.layout'] as string | undefined;

  const [layout, setLayout] = React.useState<Array<NavSection>>([]);
  const [isLoading, setIsLoading] = React.useState<boolean>(true);

  // Track whether we've ever computed a layout (for debounce logic)
  const hasInitialLayout = React.useRef(false);

  /**
   * Renders the full layout divided by the API groups.
   * During active sync, debounce updates by 500ms to avoid re-computing
   * the full sidebar layout on every watch state change.
   */
  React.useEffect(() => {
    if (!groups.data) {
      return;
    }

    const compute = () => {
      setIsLoading(true);
      switch (layoutSetting) {
        case 'modern':
          setLayout(calculateModernLayout(groups.data, watchStates));
          break;
        case 'full':
          setLayout(calculateFullLayout(groups.data, watchStates));
          break;
        default:
          setLayout(calculateModernLayout(groups.data, watchStates));
          break;
      }
      setIsLoading(false);
      hasInitialLayout.current = true;
    };

    // No debounce on first layout or when fully synced
    if (!hasInitialLayout.current || isFullySynced) {
      compute();
      return;
    }

    // Debounce during active sync to avoid hundreds of recalculations
    const timer = setTimeout(compute, 500);
    return () => clearTimeout(timer);
  }, [groups.data, layoutSetting, watchStates, isFullySynced]);

  return {
    layout,
    isLoading,
  };
};
