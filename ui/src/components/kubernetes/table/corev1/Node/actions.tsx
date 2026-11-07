import { jsonToValue, type DrawerComponentAction, type DrawerContext } from '@omniviewdev/runtime';
import type { Node } from 'kubernetes-types/core/v1';
import { LuArrowDownToLine, LuShieldBan, LuShieldCheck, LuTerminal, LuTrash } from 'react-icons/lu';

import { drawerActionDeps } from '../../../../shared/drawer/actionDeps';

const resourceKey = 'k8s:/nodes';

async function startNodeAction(
  ctx: DrawerContext<Node>,
  action: 'cordon' | 'uncordon' | 'drain',
  title: string,
  input = jsonToValue({}),
) {
  const resource = ctx.resource!;
  const deps = drawerActionDeps(ctx);
  await deps.startResourceAction({
    pluginID: resource.pluginID,
    request: { route: resource.route, reference: resource.reference, action, input },
    presentation: {
      title: `${title} ${ctx.data?.metadata?.name}`,
      actions: [
        {
          id: 'view-resource',
          kind: 'navigate-resource',
          label: 'View resource',
          target: {
            pluginID: resource.pluginID,
            targetId: resource.targetId,
            representation: resource.representation,
            reference: resource.reference,
            route: resource.route,
          },
        },
      ],
    },
  });
  deps.closeDrawer();
}

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
          <span>This will mark the node as unschedulable. No new pods will be placed on it.</span>
        ),
        confirmLabel: 'Cordon',
        cancelLabel: 'Cancel',
        onConfirm: async () => {
          await startNodeAction(ctx, 'cordon', 'Cordon');
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
          await startNodeAction(ctx, 'uncordon', 'Uncordon');
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
            This will evict all pods from the node and cordon it. DaemonSet-managed pods will be
            ignored. Each pod keeps its own termination grace period. Data in emptyDir volumes
            belonging to evicted pods will be permanently deleted.
          </span>
        ),
        confirmLabel: 'Drain',
        cancelLabel: 'Cancel',
        onConfirm: async () => {
          await startNodeAction(
            ctx,
            'drain',
            'Drain',
            jsonToValue({
              // -1 leaves Kubernetes eviction grace unset, preserving each pod's default.
              gracePeriodSeconds: -1,
              ignoreDaemonSets: true,
              deleteEmptyDirData: true,
              force: false,
            }),
          );
        },
      });
    },
  },
  {
    title: 'Shell',
    icon: <LuTerminal />,
    action: (ctx: DrawerContext<Node>) => {
      const { nodeShellConfig } = drawerActionDeps(ctx);
      void drawerActionDeps(ctx)
        .createExecSession({
          connectionID: ctx.resource?.route.connection ?? '',
          label: `node/${ctx.data?.metadata?.name}`,
          icon: 'LuTerminal',
          opts: {
            resource_plugin: ctx.resource!.reference.address.provider,
            resource_data: ctx.resource!.record!.record.body,
            reference: ctx.resource!.reference,
            route: ctx.resource!.route,
            resource_key: resourceKey,
            params: {
              ...(nodeShellConfig?.image ? { node_shell_image: nodeShellConfig.image } : {}),
              ...(nodeShellConfig?.command ? { node_shell_command: nodeShellConfig.command } : {}),
            },
          },
        })
        .then(() => drawerActionDeps(ctx).closeDrawer());
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
            Are you sure you want to delete the Node <code>{ctx.data?.metadata?.name}</code>? This
            cannot be undone.
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
];
