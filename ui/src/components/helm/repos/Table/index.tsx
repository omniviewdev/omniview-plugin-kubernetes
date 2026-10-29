import { Button } from '@omniviewdev/base-ui';
import { DrawerComponent } from '@omniviewdev/runtime';
import React from 'react';
import { LuPlus } from 'react-icons/lu';
import { SiHelm } from 'react-icons/si';
import { useParams } from 'react-router'

import { createStandardViews } from '../../../shared/sidebar/createDrawerViews';
import ResourceTable from '../../../shared/table/ResourceTable';
import RepoSidebar from '../RepoSidebar';

import AddRepoDialog from './RepoActions';
import { resourceKey } from './styles';
import type { HelmRepo } from './types';
import useRepoColumns from './useRepoColumns';

const HelmRepoTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();
  const [showAddRepo, setShowAddRepo] = React.useState(false);

  const columns = useRepoColumns();

  const drawer: DrawerComponent<HelmRepo> = React.useMemo(
    () => ({
      title: 'Repository',
      icon: <SiHelm />,
      views: createStandardViews({ SidebarComponent: RepoSidebar }),
      actions: [],
    }),
    [],
  );

  return (
    <>
      <ResourceTable
        columns={columns}
        connectionID={id}
        resourceKey={resourceKey}
        idAccessor="name"
        drawer={drawer}
        hideNamespaceSelector
        createEnabled={false}
        toolbarActions={
          <Button
            size="xs"
            variant="outline"
            color="brand"
            startDecorator={<LuPlus size={12} />}
            onClick={() => setShowAddRepo(true)}
          >
            Add Repo
          </Button>
        }
      />
      <AddRepoDialog open={showAddRepo} onClose={() => setShowAddRepo(false)} connectionID={id} />
    </>
  );
};

export default HelmRepoTable;
