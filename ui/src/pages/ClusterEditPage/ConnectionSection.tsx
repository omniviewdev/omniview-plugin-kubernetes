import { type types } from '@omniviewdev/runtime/models';
import { Stack } from '@omniviewdev/ui/layout';
import InfoRow from './InfoRow';
import SectionWrapper from './SectionWrapper';

function ConnectionSection({ conn, formatTime }: { conn: types.Connection; formatTime: (t: string | number | null | undefined) => string }) {
  // conn.data and conn.labels are Record<string, any> from the runtime SDK; narrow to known shapes
  const connData = conn.data as Record<string, string | number | undefined>;
  const connLabels = conn.labels as Record<string, string | undefined>;
  return (
    <SectionWrapper title="Connection" description="Kubeconfig context details for this cluster.">
      <Stack direction="column" gap={0}>
        <InfoRow label="Context" value={conn.id} />
        <InfoRow
          label="Cluster"
          value={String(connLabels?.cluster ?? connData?.cluster ?? '-')}
        />
        <InfoRow
          label="Kubeconfig"
          value={String(connLabels?.kubeconfig ?? connData?.kubeconfig ?? '-')}
        />
        <InfoRow label="User" value={String(connLabels?.user ?? connData?.user ?? '-')} />
        <InfoRow label="Auth Method" value={String(connLabels?.auth_method ?? '-')} />
        <InfoRow label="Namespace" value={String(connData?.namespace ?? '(default)')} />
        <InfoRow label="Last Refresh" value={formatTime(conn.last_refresh as unknown as string)} />
      </Stack>
    </SectionWrapper>
  );
}

export default ConnectionSection;
