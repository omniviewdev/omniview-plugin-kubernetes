import {
  DrawerComponent,
  DrawerComponentActionListItem,
  DrawerContext,
  useConfirmationModal,
  useExecuteAction,
  useLogs,
  useResourceMutations,
  useRightDrawer,
  useStreamAction,
} from '@omniviewdev/runtime';
import { ColumnDef, FilterFn } from '@tanstack/react-table';
import { Deployment } from 'kubernetes-types/apps/v1';
import { Condition } from 'kubernetes-types/meta/v1';
import React from 'react';
import { LuLogs, LuPause, LuPlay, LuRefreshCw, LuScaling, LuTrash } from 'react-icons/lu';
import { useParams } from 'react-router-dom';

// import ResourceLinkCell from '../../corev1/Pod/cells/ResourceLinkCell'
import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews';
import ResourceTable from '../../../../shared/table/ResourceTable';
import ScaleModal from '../../../actions/ScaleModal';
import ConditionsCell from '../../shared/cells/ConditionsCell';
import { withNamespacedResourceColumns } from '../../shared/columns';
import { inclusionFilter } from '../../shared/filters';

import DeploymentSidebar from './Sidebar';

const resourceKey = 'apps::v1::Deployment';

const DeploymentTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();

  const { remove, update } = useResourceMutations({ pluginID: 'kubernetes' });
  const { createLogSession } = useLogs({ pluginID: 'kubernetes' });
  const { executeAction, isExecuting } = useExecuteAction({
    pluginID: 'kubernetes',
    connectionID: id,
    resourceKey,
  });
  const { startStreamAction } = useStreamAction({
    pluginID: 'kubernetes',
    connectionID: id,
    resourceKey,
  });
  const { show } = useConfirmationModal();
  const { closeDrawer } = useRightDrawer();

  // Scale modal state
  const [scaleTarget, setScaleTarget] = React.useState<{
    name: string;
    namespace: string;
    replicas: number;
  } | null>(null);

  /**
   * Handler to go ahead and submit a resource change
   */
  const onEditorSubmit = React.useCallback(
    (ctx: DrawerContext<Deployment>, value: Record<string, unknown>) => {
      void update({
        opts: {
          connectionID: id,
          resourceKey,
          resourceID: ctx.data?.metadata?.name as string,
          namespace: ctx.data?.metadata?.namespace as string,
        },
        input: {
          input: value as Record<string, never>,
        },
      }).then(() => {
        closeDrawer();
      });
    },
    [id, update, closeDrawer],
  );

  const columns = React.useMemo<Array<ColumnDef<Deployment>>>(
    () =>
      withNamespacedResourceColumns(
        [
          {
            id: 'desired',
            header: 'Desired',
            accessorFn: (row) => row.spec?.replicas ?? 1,
            size: 80,
          },
          {
            id: 'current',
            header: 'Current',
            accessorFn: (row) => row.status?.replicas ?? 0,
            size: 80,
          },
          {
            id: 'updated',
            header: 'Updated',
            accessorFn: (row) => row.status?.updatedReplicas ?? 0,
            size: 80,
          },
          {
            id: 'ready',
            header: 'Ready',
            accessorFn: (row) => row.status?.readyReplicas ?? 0,
            size: 80,
          },
          {
            id: 'available',
            header: 'Available',
            accessorFn: (row) => row.status?.availableReplicas ?? 0,
            size: 80,
          },
          {
            id: 'unavailable',
            header: 'Unavailable',
            accessorFn: (row) => row.status?.unavailableReplicas ?? 0,
            size: 100,
            meta: {
              defaultHidden: true,
            },
          },
          {
            id: 'strategy',
            header: 'Strategy',
            accessorFn: (row) => row.spec?.strategy?.type ?? 'RollingUpdate',
            filterFn: inclusionFilter as FilterFn<Deployment>,
            size: 120,
          },
          {
            id: 'minReadySeconds',
            header: 'Min Ready Sec',
            accessorFn: (row) => `${row.spec?.minReadySeconds || 0}`,
            size: 100,
            meta: {
              defaultHidden: true,
            },
          },
          {
            id: 'progressDeadlineSeconds',
            header: 'Progress Deadline',
            accessorFn: (row) => row.spec?.progressDeadlineSeconds,
            size: 120,
            meta: {
              defaultHidden: true,
            },
          },
          {
            id: 'revision',
            header: 'Revision',
            accessorFn: (row) => row.status?.observedGeneration,
            size: 100,
            meta: {
              defaultHidden: true,
            },
          },
          {
            id: 'conditions',
            header: 'Conditions',
            accessorFn: (row) => row.status?.conditions,
            cell: ({ getValue }) => (
              <ConditionsCell
                conditions={getValue() as Condition[] | undefined}
                defaultHealthyColor="neutral"
                defaultUnhealthyColor="faded"
              />
            ),
            size: 250,
            meta: {
              defaultHidden: true,
            },
          },
        ],
        { connectionID: id, resourceKey },
      ),
    [id],
  );

  const drawer: DrawerComponent<Deployment> = React.useMemo(
    () => ({
      title: resourceKey,
      icon: <LuScaling />,
      views: createStandardViews({ SidebarComponent: DeploymentSidebar, onEditorSubmit }),
      actions: [
        {
          title: 'Restart',
          icon: <LuRefreshCw />,
          action: (ctx) => {
            void show({
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
                await startStreamAction({
                  actionID: 'restart',
                  id: ctx.data?.metadata?.name as string,
                  namespace: ctx.data?.metadata?.namespace as string,
                  label: `Restart ${ctx.data?.metadata?.name}`,
                });
                closeDrawer();
              },
            });
          },
        },
        {
          title: 'Scale',
          icon: <LuScaling />,
          action: (ctx) => {
            setScaleTarget({
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
            void show({
              title: (
                <span>
                  Pause rollout for <strong>{ctx.data?.metadata?.name}</strong>?
                </span>
              ),
              body: 'This will pause the current rollout. New changes will not be rolled out until resumed.',
              confirmLabel: 'Pause',
              cancelLabel: 'Cancel',
              onConfirm: async () => {
                await executeAction({
                  actionID: 'pause',
                  id: ctx.data?.metadata?.name as string,
                  namespace: ctx.data?.metadata?.namespace as string,
                });
                closeDrawer();
              },
            });
          },
        },
        {
          title: 'Resume Rollout',
          icon: <LuPlay />,
          enabled: (ctx) => ctx.data?.spec?.paused === true,
          action: (ctx) => {
            void show({
              title: (
                <span>
                  Resume rollout for <strong>{ctx.data?.metadata?.name}</strong>?
                </span>
              ),
              body: 'This will resume the paused rollout.',
              confirmLabel: 'Resume',
              cancelLabel: 'Cancel',
              onConfirm: async () => {
                await executeAction({
                  actionID: 'resume',
                  id: ctx.data?.metadata?.name as string,
                  namespace: ctx.data?.metadata?.namespace as string,
                });
                closeDrawer();
              },
            });
          },
        },
        {
          title: 'Delete',
          icon: <LuTrash />,
          action: (ctx) => {
            void show({
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
                await remove({
                  opts: {
                    connectionID: id,
                    resourceKey,
                    resourceID: ctx.data?.metadata?.name as string,
                    namespace: ctx.data?.metadata?.namespace as string,
                  },
                  input: {},
                });
                closeDrawer();
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
                void createLogSession({
                  connectionID: id,
                  resourceKey,
                  resourceID: ctx.data?.metadata?.name as string,
                  resourceData: ctx.data as Record<string, never>,
                  target: '',
                  label: `Deployment ${ctx.data?.metadata?.name}`,
                  icon: 'LuLogs',
                  params: filterParams,
                }).then(() => closeDrawer());
              },
            });

            containers.forEach((container) => {
              list.push({
                title: container.name,
                action: () => {
                  void createLogSession({
                    connectionID: id,
                    resourceKey,
                    resourceID: ctx.data?.metadata?.name as string,
                    resourceData: ctx.data as Record<string, never>,
                    target: container.name,
                    label: `Deployment ${ctx.data?.metadata?.name}`,
                    icon: 'LuLogs',
                    params: filterParams,
                  }).then(() => closeDrawer());
                },
              });
            });

            return list;
          },
        },
      ],
    }),
    [id, closeDrawer, createLogSession, executeAction, onEditorSubmit, remove, show, startStreamAction],
  );

  return (
    <>
      <ResourceTable
        columns={columns}
        connectionID={id}
        resourceKey={resourceKey}
        idAccessor="metadata.uid"
        memoizer="metadata.uid,metadata.resourceVersion,status.observedGeneration"
        drawer={drawer}
        toolbarFilters={[
          { columnId: 'strategy', placeholder: 'All Strategies', accessor: (r: Deployment) => r?.spec?.strategy?.type },
          { columnId: 'namespace', placeholder: 'All Namespaces', accessor: (r: Deployment) => r?.metadata?.namespace },
        ]}
      />
      {scaleTarget && (
        <ScaleModal
          open={!!scaleTarget}
          onClose={() => setScaleTarget(null)}
          onConfirm={(replicas) => {
            void executeAction({
              actionID: 'scale',
              id: scaleTarget.name,
              namespace: scaleTarget.namespace,
              params: { replicas },
            }).then(() => {
              setScaleTarget(null);
              closeDrawer();
            });
          }}
          resourceType="Deployment"
          resourceName={scaleTarget.name}
          currentReplicas={scaleTarget.replicas}
          isExecuting={isExecuting}
        />
      )}
    </>
  );
};

export default DeploymentTable;
