import {
  type DrawerComponentAction,
  type DrawerComponentActionListItem,
} from '@omniviewdev/runtime';
import type { Deployment } from 'kubernetes-types/apps/v1';
import { LuLogs, LuPause, LuPlay, LuRefreshCw, LuScaling, LuTrash } from 'react-icons/lu';

import { drawerActionDeps } from '../../../../shared/drawer/actionDeps';

const resourceKey = 'k8s:apps/deployments';

/** Drawer header and row menu actions for Deployments. Handlers come from `drawerActionDeps`. */
export const drawerActions: Array<DrawerComponentAction<Deployment>> = [
  {
    title: 'Restart',
    icon: <LuRefreshCw />,
    action: (ctx) => {
      void drawerActionDeps(ctx).show({
        title: (
          <span>
            Restart <strong>{ctx.data?.metadata?.name}</strong>?
          </span>
        ),
        body: (
          <span>
            This will perform a rolling restart of the Deployment{' '}
            <code>{ctx.data?.metadata?.name}</code> in{' '}
            <strong>{ctx.data?.metadata?.namespace}</strong>.
          </span>
        ),
        confirmLabel: 'Restart',
        cancelLabel: 'Cancel',
        onConfirm: async () => {
          await drawerActionDeps(ctx).startResourceAction({
            pluginID: ctx.resource!.pluginID,
            request: {
              route: ctx.resource!.route,
              reference: ctx.resource!.reference,
              action: 'restart',
              input: { kind: 'map', value: {} },
            },
            presentation: {
              title: `Restart ${ctx.data?.metadata?.name}`,
              actions: [
                {
                  id: 'view-resource',
                  kind: 'navigate-resource',
                  label: 'View resource',
                  target: {
                    pluginID: ctx.resource!.pluginID,
                    targetId: ctx.resource!.targetId,
                    representation: ctx.resource!.representation,
                    reference: ctx.resource!.reference,
                    route: ctx.resource!.route,
                  },
                },
              ],
            },
          });
          drawerActionDeps(ctx).closeDrawer();
        },
      });
    },
  },
  {
    title: 'Scale',
    icon: <LuScaling />,
    action: (ctx) => {
      drawerActionDeps(ctx).openScale({
        resource: ctx.resource!,
        name: ctx.data?.metadata?.name as string,
        namespace: ctx.data?.metadata?.namespace as string,
        replicas: ctx.data?.spec?.replicas ?? 1,
      });
    },
  },
  {
    title: 'Pause Rollout',
    icon: <LuPause />,
    enabled: (ctx) => !ctx.data?.spec?.paused,
    action: (ctx) => {
      void drawerActionDeps(ctx).show({
        title: (
          <span>
            Pause rollout for <strong>{ctx.data?.metadata?.name}</strong>?
          </span>
        ),
        body: 'This will pause the current rollout. New changes will not be rolled out until resumed.',
        confirmLabel: 'Pause',
        cancelLabel: 'Cancel',
        onConfirm: async () => {
          await drawerActionDeps(ctx).executeAction({
            route: ctx.resource!.route,
            reference: ctx.resource!.reference,
            action: 'pause',
            input: { kind: 'map', value: {} },
          });
          drawerActionDeps(ctx).closeDrawer();
        },
      });
    },
  },
  {
    title: 'Resume Rollout',
    icon: <LuPlay />,
    enabled: (ctx) => ctx.data?.spec?.paused === true,
    action: (ctx) => {
      void drawerActionDeps(ctx).show({
        title: (
          <span>
            Resume rollout for <strong>{ctx.data?.metadata?.name}</strong>?
          </span>
        ),
        body: 'This will resume the paused rollout.',
        confirmLabel: 'Resume',
        cancelLabel: 'Cancel',
        onConfirm: async () => {
          await drawerActionDeps(ctx).executeAction({
            route: ctx.resource!.route,
            reference: ctx.resource!.reference,
            action: 'resume',
            input: { kind: 'map', value: {} },
          });
          drawerActionDeps(ctx).closeDrawer();
        },
      });
    },
  },
  {
    title: 'Delete',
    icon: <LuTrash />,
    action: (ctx) => {
      void drawerActionDeps(ctx).show({
        title: (
          <span>
            Delete <strong>{ctx.data?.metadata?.name}</strong>?
          </span>
        ),
        body: (
          <span>
            Are you sure you want to delete the Deployment <code>{ctx.data?.metadata?.name}</code>{' '}
            from <strong>{ctx.data?.metadata?.namespace}</strong>?
          </span>
        ),
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel',
        onConfirm: async () => {
          await drawerActionDeps(ctx).mutate({
            route: ctx.resource!.route,
            reference: ctx.resource!.reference,
            operation: 'delete',
            input: { kind: 'map', value: {} },
          });
          drawerActionDeps(ctx).closeDrawer();
        },
      });
    },
  },
  {
    title: 'Logs',
    icon: <LuLogs />,
    enabled: true,
    list: (ctx) => {
      const list: Array<DrawerComponentActionListItem> = [];
      const containers = ctx.data?.spec?.template?.spec?.containers ?? [];
      const filterParams = { filter_labels: 'pod,container' };

      list.push({
        title: 'All Containers',
        action: () => {
          return drawerActionDeps(ctx)
            .createLogSession({
              connectionID: ctx.resource?.route.connection ?? '',
              resourceKey,
              resourceID: ctx.data?.metadata?.name as string,
              resourceData: ctx.resource!.record!.record.body,
              reference: ctx.resource!.reference,
              route: ctx.resource!.route,
              target: '',
              label: `Deployment ${ctx.data?.metadata?.name}`,
              icon: 'LuLogs',
              params: filterParams,
            })
            .then(() => drawerActionDeps(ctx).closeDrawer());
        },
      });

      containers.forEach((container) => {
        list.push({
          title: container.name,
          action: () => {
            return drawerActionDeps(ctx)
              .createLogSession({
                connectionID: ctx.resource?.route.connection ?? '',
                resourceKey,
                resourceID: ctx.data?.metadata?.name as string,
                resourceData: ctx.resource!.record!.record.body,
                reference: ctx.resource!.reference,
                route: ctx.resource!.route,
                target: container.name,
                label: `Deployment ${ctx.data?.metadata?.name}`,
                icon: 'LuLogs',
                params: filterParams,
              })
              .then(() => drawerActionDeps(ctx).closeDrawer());
          },
        });
      });

      return list;
    },
  },
];
