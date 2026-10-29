import { type DrawerComponentAction, type DrawerContext } from '@omniviewdev/runtime';
import type { Node } from 'kubernetes-types/core/v1';
import { LuArrowDownToLine, LuShieldBan, LuShieldCheck, LuTerminal, LuTrash } from 'react-icons/lu';

import { PLUGIN_ID } from '@/pluginId';

import { drawerActionDeps } from '../../../../shared/drawer/actionDeps';

const resourceKey = 'core::v1::Node';

/** Drawer header and row menu actions for Nodes. Handlers come from `drawerActionDeps`. */
export const drawerActions: Array<DrawerComponentAction<Node>> = [
  {
    title: 'Cordon',
    icon: <LuShieldBan />,
    enabled: (ctx: DrawerContext<Node>) => !ctx.data?.spec?.unschedulable,
    action: (ctx: DrawerContext<Node>) => {
      void drawerActionDeps(ctx).show({
        title: (
          <span>
            Cordon <strong>{ctx.data?.metadata?.name}</strong>?
          </span>
        ),
        body: (
          <span>
            This will mark the node as unschedulable. No new pods will be placed on it.
          </span>
        ),
        confirmLabel: 'Cordon',
        cancelLabel: 'Cancel',
        onConfirm: async () => {
          await drawerActionDeps(ctx).executeAction({
            actionID: 'cordon',
            id: ctx.data?.metadata?.name,
          });
        },
      });
    },
  },
  {
    title: 'Uncordon',
    icon: <LuShieldCheck />,
    enabled: (ctx: DrawerContext<Node>) => !!ctx.data?.spec?.unschedulable,
    action: (ctx: DrawerContext<Node>) => {
      void drawerActionDeps(ctx).show({
        title: (
          <span>
            Uncordon <strong>{ctx.data?.metadata?.name}</strong>?
          </span>
        ),
        body: <span>This will mark the node as schedulable again.</span>,
        confirmLabel: 'Uncordon',
        cancelLabel: 'Cancel',
        onConfirm: async () => {
          await drawerActionDeps(ctx).executeAction({
            actionID: 'uncordon',
            id: ctx.data?.metadata?.name,
          });
        },
      });
    },
  },
  {
    title: 'Drain',
    icon: <LuArrowDownToLine />,
    action: (ctx: DrawerContext<Node>) => {
      void drawerActionDeps(ctx).show({
        title: (
          <span>
            Drain <strong>{ctx.data?.metadata?.name}</strong>?
          </span>
        ),
        body: (
          <span>
            This will evict all pods from the node and cordon it. DaemonSet-managed pods will
            be ignored.
          </span>
        ),
        confirmLabel: 'Drain',
        cancelLabel: 'Cancel',
        onConfirm: async () => {
          await drawerActionDeps(ctx).executeAction({
            actionID: 'drain',
            id: ctx.data?.metadata?.name,
            params: {
              gracePeriodSeconds: -1,
              ignoreDaemonSets: true,
              deleteEmptyDirData: true,
              force: false,
            },
          });
        },
      });
    },
  },
  {
    title: 'Shell',
    icon: <LuTerminal />,
    action: (ctx: DrawerContext<Node>) => {
      const { nodeShellConfig } = drawerActionDeps(ctx);
      void drawerActionDeps(ctx).createExecSession({
        connectionID: ctx.resource?.connectionID ?? '',
        label: `node/${ctx.data?.metadata?.name}`,
        icon: 'LuTerminal',
        opts: {
          resource_plugin: PLUGIN_ID,
          resource_data: ctx.data,
          resource_key: resourceKey,
          params: {
            ...(nodeShellConfig?.image ? { node_shell_image: nodeShellConfig.image } : {}),
            ...(nodeShellConfig?.command
              ? { node_shell_command: nodeShellConfig.command }
              : {}),
          },
        },
      }).then(() => drawerActionDeps(ctx).closeDrawer());
    },
  },
  {
    title: 'Delete',
    icon: <LuTrash />,
    action: (ctx: DrawerContext<Node>) => {
      void drawerActionDeps(ctx).show({
        title: (
          <span>
            Delete <strong>{ctx.data?.metadata?.name}</strong>?
          </span>
        ),
        body: (
          <span>
            Are you sure you want to delete the Node <code>{ctx.data?.metadata?.name}</code>?
            This cannot be undone.
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
              namespace: '',
            },
            input: {},
          });
          drawerActionDeps(ctx).closeDrawer();
        },
      });
    },
  },
];
