import { type DrawerComponentAction } from '@omniviewdev/runtime';
import type { PersistentVolumeClaim } from 'kubernetes-types/core/v1';
import { LuTrash } from 'react-icons/lu';

import { drawerActionDeps } from '../../../../shared/drawer/actionDeps';

const resourceKey = 'core::v1::PersistentVolumeClaim';

/** Drawer header and row menu actions for PersistentVolumeClaims. Handlers come from `drawerActionDeps`. */
export const drawerActions: Array<DrawerComponentAction<PersistentVolumeClaim>> = [
  {
    title: 'Delete',
    icon: <LuTrash />,
    action: (ctx) =>
      drawerActionDeps(ctx).show({
        title: (
          <span>
            Delete <strong>{ctx.data?.metadata?.name}</strong>?
          </span>
        ),
        body: (
          <span>
            Are you sure you want to delete the PersistentVolumeClaim{' '}
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
      }),
  },
];
