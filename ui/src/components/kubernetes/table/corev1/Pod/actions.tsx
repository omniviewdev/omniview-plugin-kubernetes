import { type DrawerComponentAction, type DrawerContext, type DrawerComponentActionListItem } from '@omniviewdev/runtime';
import type { Pod } from 'kubernetes-types/core/v1';
import { LuBugPlay, LuChevronDown, LuLogs, LuScaling, LuTerminal, LuTrash } from 'react-icons/lu';

import { drawerActionDeps } from '../../../../shared/drawer/actionDeps';
import { isMissingShellError, runningDebugTargets } from '../../../../../features/debug/targets';

const debugInput = (ctx: DrawerContext<Pod>, targetContainerName: string) => {
  const pod = ctx.data;
  if (!pod || !runningDebugTargets(pod).includes(targetContainerName)) throw new Error('Debug target is no longer available');
  return {
    connectionID: ctx.resource?.connectionID ?? '',
    resourceID: pod.metadata!.name!,
    namespace: pod.metadata!.namespace!,
    podUID: pod.metadata!.uid!,
    targetContainerName,
    resourceData: pod,
  };
};

const resourceKey = 'core::v1::Pod';

/** Drawer header and row menu actions for Pods. Handlers come from `drawerActionDeps`. */
export const drawerActions: Array<DrawerComponentAction<Pod>> = [
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
            Are you sure you want to delete the Pod <code>{ctx.data?.metadata?.name}</code>{' '}
            from <strong>{ctx.data?.metadata?.namespace}</strong>?
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
              namespace: ctx.data?.metadata?.namespace as string,
            },
            input: {},
          });
          drawerActionDeps(ctx).closeDrawer();
        },
      });
    },
  },
  {
    title: 'Exec',
    icon: <LuTerminal />,
    enabled: true,
    list: (ctx) => {
      const list: Array<DrawerComponentActionListItem> = [];

      ctx.data?.spec?.containers?.forEach((container) => {
        list.push({
          title: container.name,
          action: () => {
            const recoveryTarget = runningDebugTargets(ctx.data).includes(container.name) ? debugInput(ctx, container.name) : null;
            return drawerActionDeps(ctx).createExecSession({
              connectionID: ctx.resource?.connectionID ?? '',
              label: `${ctx.data?.metadata?.name}/${container.name}`,
              icon: 'LuContainer',
              recovery: {
                label: 'Debug this container',
                canRecover: (error) => recoveryTarget !== null && isMissingShellError(error),
                run: () => {
                  if (!recoveryTarget) return Promise.reject(new Error('Original container is no longer available'));
                  return drawerActionDeps(ctx).startDebug(recoveryTarget);
                },
              },
              opts: {
                resource_plugin: 'kubernetes',
                resource_data: ctx.data,
                resource_key: ctx.resource?.key,
                params: { container: container.name },
              },
            }).then((session) => { if (session) drawerActionDeps(ctx).closeDrawer(); });
          },
        });
      });
      ctx.data?.spec?.ephemeralContainers?.forEach((container) => {
        list.push({
          title: container.name,
          action: () => {
            return drawerActionDeps(ctx).createExecSession({
              connectionID: ctx.resource?.connectionID ?? '',
              label: `${ctx.data?.metadata?.name}/${container.name}`,
              icon: 'LuContainer',
              opts: {
                resource_plugin: 'kubernetes',
                resource_data: ctx.data,
                resource_key: ctx.resource?.key,
                params: { mode: 'attach', container: container.name, pod_uid: ctx.data?.metadata?.uid },
              },
            }).then((session) => { if (session) drawerActionDeps(ctx).closeDrawer(); });
          },
        });
      });

      return list;
    },
  },
  {
    title: 'Logs',
    icon: <LuLogs />,
    enabled: true,
    list: (ctx) => {
      const list: Array<DrawerComponentActionListItem> = [];
      const containers = ctx.data?.spec?.containers ?? [];
      const initContainers = ctx.data?.spec?.initContainers ?? [];
      const ephemeralContainers = ctx.data?.spec?.ephemeralContainers ?? [];
      const allContainers = [...containers, ...initContainers, ...ephemeralContainers];
      const filterParams = { filter_labels: 'container' };

      if (allContainers.length > 1) {
        list.push({
          title: 'All Containers',
          action: () => {
            return drawerActionDeps(ctx).createLogSession({
              connectionID: ctx.resource?.connectionID ?? '',
              resourceKey,
              resourceID: ctx.data?.metadata?.name as string,
              resourceData: ctx.data as Record<string, unknown>,
              target: '',
              label: `Pod ${ctx.data?.metadata?.name}`,
              icon: 'LuLogs',
              params: filterParams,
            }).then(() => drawerActionDeps(ctx).closeDrawer());
          },
        });
      }

      containers.forEach((container) => {
        list.push({
          title: container.name,
          action: () => {
            return drawerActionDeps(ctx).createLogSession({
              connectionID: ctx.resource?.connectionID ?? '',
              resourceKey,
              resourceID: ctx.data?.metadata?.name as string,
              resourceData: ctx.data as Record<string, unknown>,
              target: container.name,
              label: `Pod ${ctx.data?.metadata?.name}`,
              icon: 'LuLogs',
              params: filterParams,
            }).then(() => drawerActionDeps(ctx).closeDrawer());
          },
        });
      });
      initContainers.forEach((container) => {
        list.push({
          title: `${container.name} (init)`,
          action: () => {
            return drawerActionDeps(ctx).createLogSession({
              connectionID: ctx.resource?.connectionID ?? '',
              resourceKey,
              resourceID: ctx.data?.metadata?.name as string,
              resourceData: ctx.data as Record<string, unknown>,
              target: container.name,
              label: `Pod ${ctx.data?.metadata?.name}`,
              icon: 'LuLogs',
              params: filterParams,
            }).then(() => drawerActionDeps(ctx).closeDrawer());
          },
        });
      });
      ephemeralContainers.forEach((container) => {
        list.push({
          title: `${container.name} (ephemeral)`,
          action: () => {
            return drawerActionDeps(ctx).createLogSession({
              connectionID: ctx.resource?.connectionID ?? '',
              resourceKey,
              resourceID: ctx.data?.metadata?.name as string,
              resourceData: ctx.data as Record<string, unknown>,
              target: container.name,
              label: `Pod ${ctx.data?.metadata?.name}`,
              icon: 'LuLogs',
              params: filterParams,
            }).then(() => drawerActionDeps(ctx).closeDrawer());
          },
        });
      });

      return list;
    },
  },
  {
    title: 'Debug',
    icon: <LuBugPlay />,
    enabled: (ctx) => runningDebugTargets(ctx.data).length > 0,
    action: (ctx) => {
      const targets = runningDebugTargets(ctx.data);
      if (targets.length !== 1) throw new Error('Choose an available Debug target');
      return drawerActionDeps(ctx).startDebug(debugInput(ctx, targets[0]));
    },
    list: (ctx) => {
      const targets = runningDebugTargets(ctx.data);
      return targets.map(name => ({
        title: name,
        action: () => drawerActionDeps(ctx).startDebug(debugInput(ctx, name)),
      }));
    },
  },
  {
    title: 'Debug options',
    icon: <LuChevronDown />,
    enabled: (ctx) => runningDebugTargets(ctx.data).length > 0,
    list: (ctx) => runningDebugTargets(ctx.data).map(name => ({
      title: name,
      action: () => drawerActionDeps(ctx).openDebugOptions(debugInput(ctx, name)),
    })),
  },
  {
    title: 'Resize',
    icon: <LuScaling />,
    enabled: false,
    action: () => { /* TODO: implement resize */ },
  },
];

/** Saves the Editor view's changes. */
export const editorSubmit = (ctx: DrawerContext<Pod>, value: Record<string, unknown>) => {
  const deps = drawerActionDeps(ctx);
  void deps
    .update({
      opts: {
        connectionID: ctx.resource?.connectionID ?? '',
        resourceKey,
        resourceID: ctx.data?.metadata?.name as string,
        namespace: ctx.data?.metadata?.namespace as string,
      },
      input: {
        input: value,
      },
    })
    .then(() => deps.closeDrawer());
};
