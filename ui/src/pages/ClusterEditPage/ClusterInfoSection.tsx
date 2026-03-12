import { type types } from '@omniviewdev/runtime/models';
import { Stack } from '@omniviewdev/ui/layout';
import InfoRow from './InfoRow';
import SectionWrapper from './SectionWrapper';

function ClusterInfoSection({ conn, formatTime }: { conn: types.Connection; formatTime: (t: string | number | null | undefined) => string }) {
  // conn.data and conn.labels are Record<string, any> from the runtime SDK; narrow to known shapes
  const connData = conn.data as Record<string, string | number | undefined>;
  const connLabels = conn.labels as Record<string, string | undefined>;
  return (
    <SectionWrapper
      title="Cluster Info"
      description="Read-only information discovered from the cluster."
    >
      <Stack direction="column" gap={0}>
        <InfoRow
          label="Server"
          value={String(connData?.server_url ?? connLabels?.server ?? '-')}
        />
        <InfoRow label="Kubernetes Version" value={String(connData?.k8s_version ?? '-')} />
        <InfoRow label="Platform" value={String(connData?.k8s_platform ?? '-')} />
        <InfoRow
          label="Nodes"
          value={connData?.node_count != null ? String(connData.node_count) : '-'}
        />
        <InfoRow
          label="API Groups"
          value={connData?.api_groups != null ? String(connData.api_groups) : '-'}
        />
        <InfoRow
          label="Last Checked"
          value={connData?.last_checked ? formatTime(connData.last_checked) : '-'}
        />
      </Stack>
    </SectionWrapper>
  );
}

export default ClusterInfoSection;
