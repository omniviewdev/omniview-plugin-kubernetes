import { type types } from '@omniviewdev/runtime/models';
import { Stack } from '@omniviewdev/ui/layout';
import InfoRow from './InfoRow';
import SectionWrapper from './SectionWrapper';

function ClusterInfoSection({ conn, formatTime }: { conn: types.Connection; formatTime: (t: unknown) => string }) {
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
          value={connData?.server_url != null ? String(connData.server_url) : (connLabels?.server ?? undefined)}
        />
        <InfoRow label="Kubernetes Version" value={connData?.k8s_version != null ? String(connData.k8s_version) : undefined} />
        <InfoRow label="Platform" value={connData?.k8s_platform != null ? String(connData.k8s_platform) : undefined} />
        <InfoRow
          label="Nodes"
          value={connData?.node_count != null ? String(connData.node_count) : undefined}
        />
        <InfoRow
          label="API Groups"
          value={connData?.api_groups != null ? String(connData.api_groups) : undefined}
        />
        <InfoRow
          label="Last Checked"
          value={connData?.last_checked ? formatTime(connData.last_checked) : undefined}
        />
      </Stack>
    </SectionWrapper>
  );
}

export default ClusterInfoSection;
