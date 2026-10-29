import { usePluginRouter } from '@omniviewdev/runtime';
import { useParams } from 'react-router';

import ClusterConnectionBoundary from '../components/connections/ClusterConnectionBoundary';

import ClusterResourcesPage from './ClusterResourcesPage';

export default function ClusterResourcesRoute() {
  const { id = '' } = useParams<{ id: string }>();
  const { navigate } = usePluginRouter();
  return (
    <ClusterConnectionBoundary
      connectionID={id}
      onEditConnection={() => navigate(`/cluster/${encodeURIComponent(id)}/edit`)}
      onBack={() => navigate('/clusters')}
    >
      <ClusterResourcesPage />
    </ClusterConnectionBoundary>
  );
}
