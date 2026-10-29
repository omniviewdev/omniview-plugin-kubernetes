import { type DrawerComponentAction, type DrawerContext, type DrawerComponentActionListItem } from '@omniviewdev/runtime';
import type { Deployment } from 'kubernetes-types/apps/v1';
import { LuLogs, LuPause, LuPlay, LuRefreshCw, LuScaling, LuTrash } from 'react-icons/lu';

import { drawerActionDeps } from '../../../../shared/drawer/actionDeps';

const resourceKey = 'apps::v1::Deployment';

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
          await drawerActionDeps(ctx).startStreamAction({
            actionID: 'restart',
            id: ctx.data?.metadata?.name as string,
            namespace: ctx.data?.metadata?.namespace as string,
            label: `Restart ${ctx.data?.metadata?.name}`,
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
            actionID: 'pause',
            id: ctx.data?.metadata?.name,
            namespace: ctx.data?.metadata?.namespace,
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
            actionID: 'resume',
            id: ctx.data?.metadata?.name,
            namespace: ctx.data?.metadata?.namespace,
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
            Are you sure you want to delete the Deployment{' '}
            <code>{ctx.data?.metadata?.name}</code> from{' '}
            <strong>{ctx.data?.metadata?.namespace}</strong>?
          </span>
        ),
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel',
        onConfirm: async () => {
          await drawerActionDeps(ctx).remove({
            opts: {
              connectionID: ctx.resource?.connectionID ?? '',
              resourceKey,
              resourceID: ctx.data?.metadata?.name as string,
              namespace: ctx.data?.metadata?.namespace,
            },
            input: {},
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
          return drawerActionDeps(ctx).createLogSession({
            connectionID: ctx.resource?.connectionID ?? '',
            resourceKey,
            resourceID: ctx.data?.metadata?.name as string,
            resourceData: ctx.data as Record<string, never>,
            target: '',
            label: `Deployment ${ctx.data?.metadata?.name}`,
            icon: 'LuLogs',
            params: filterParams,
          }).then(() => drawerActionDeps(ctx).closeDrawer());
        },
      });

      containers.forEach((container) => {
        list.push({
          title: container.name,
          action: () => {
            return drawerActionDeps(ctx).createLogSession({
              connectionID: ctx.resource?.connectionID ?? '',
              resourceKey,
              resourceID: ctx.data?.metadata?.name as string,
              resourceData: ctx.data as Record<string, never>,
              target: container.name,
              label: `Deployment ${ctx.data?.metadata?.name}`,
              icon: 'LuLogs',
              params: filterParams,
            }).then(() => drawerActionDeps(ctx).closeDrawer());
          },
        });
      });

      return list;
    },
  },
];

/** Saves the Editor view's changes. */
export const editorSubmit = (ctx: DrawerContext<Deployment>, value: Record<string, unknown>) => {
  const deps = drawerActionDeps(ctx);
  void deps
    .update({
      opts: {
        connectionID: ctx.resource?.connectionID ?? '',
        resourceKey,
        resourceID: ctx.data?.metadata?.name as string,
        namespace: ctx.data?.metadata?.namespace,
      },
      input: {
        input: value,
      },
    })
    .then(() => deps.closeDrawer());
};
