import { type DrawerComponentAction, type DrawerComponentActionListItem } from '@omniviewdev/runtime';
import type { CronJob } from 'kubernetes-types/batch/v1';
import { LuLogs, LuTrash } from 'react-icons/lu';

import { drawerActionDeps } from '../../../../shared/drawer/actionDeps';

const resourceKey = 'batch::v1::CronJob';

/** Drawer header and row menu actions for CronJobs. Handlers come from `drawerActionDeps`. */
export const drawerActions: Array<DrawerComponentAction<CronJob>> = [
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
            Are you sure you want to delete the CronJob{' '}
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
      const containers = ctx.data?.spec?.jobTemplate?.spec?.template?.spec?.containers ?? [];
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
            label: `CronJob ${ctx.data?.metadata?.name}`,
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
              label: `CronJob ${ctx.data?.metadata?.name}`,
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
