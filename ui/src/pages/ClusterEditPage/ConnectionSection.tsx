import { type types } from '@omniviewdev/runtime/models';
import { Stack } from '@omniviewdev/ui/layout';
import InfoRow from './InfoRow';
import SectionWrapper from './SectionWrapper';

/** Return the value if it's a non-blank string, otherwise undefined. */
function nonBlank(v: string | undefined): string | undefined {
  return v && v.trim() !== '' ? v : undefined;
}

function ConnectionSection({ conn, formatTime }: { conn: types.Connection; formatTime: (t: unknown) => string }) {
  // conn.data and conn.labels are Record<string, any> from the runtime SDK; narrow to known shapes
  const connData = conn.data as Record<string, string | number | undefined>;
  const connLabels = conn.labels as Record<string, string | undefined>;
  const trimmedNamespace = typeof connData?.namespace === 'string' ? connData.namespace.trim() : '';
  return (
    <SectionWrapper title="Connection" description="Kubeconfig context details for this cluster.">
      <Stack direction="column" gap={0}>
        <InfoRow label="Context" value={conn.id} />
        <InfoRow
          label="Cluster"
          value={nonBlank(connLabels?.cluster) ?? (connData?.cluster != null ? String(connData.cluster) : undefined)}
        />
        <InfoRow
          label="Kubeconfig"
          value={nonBlank(connLabels?.kubeconfig) ?? (connData?.kubeconfig != null ? String(connData.kubeconfig) : undefined)}
        />
        <InfoRow label="User" value={nonBlank(connLabels?.user) ?? (connData?.user != null ? String(connData.user) : undefined)} />
        <InfoRow label="Auth Method" value={connLabels?.auth_method} />
        <InfoRow label="Namespace" value={trimmedNamespace || '(default)'} />
        <InfoRow label="Last Refresh" value={formatTime(conn.last_refresh)} />
      </Stack>
    </SectionWrapper>
  );
}

export default ConnectionSection;
