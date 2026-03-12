import { DrawerComponent } from '@omniviewdev/runtime';
import { Button } from '@omniviewdev/ui/buttons';
import React from 'react';
import { LuPlus } from 'react-icons/lu';
import { SiHelm } from 'react-icons/si';
import { useParams } from 'react-router-dom';

import { createStandardViews } from '../../../shared/sidebar/createDrawerViews';
import ResourceTable from '../../../shared/table/ResourceTable';

import RepoSidebar from '../RepoSidebar';

import AddRepoDialog from './RepoActions';
import useRepoColumns from './useRepoColumns';
import { resourceKey } from './styles';
import type { HelmRepo } from './types';

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
        memoizer="name"
        drawer={drawer}
        hideNamespaceSelector
        createEnabled={false}
        toolbarActions={
          <Button
            size="xs"
            emphasis="outline"
            color="primary"
            startIcon={<LuPlus size={12} />}
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
