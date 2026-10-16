import { Chip, ClipboardText, Stack, Text } from '@omniviewdev/base-ui';
import type { Endpoint } from 'kubernetes-types/discovery/v1';
import React from 'react';

import ExpandableSections from '../../../../../shared/ExpandableSections';
import type { ExpandableSection } from '../../../../../shared/ExpandableSections';
import ResourceLinkChip from '../../../../../shared/ResourceLinkChip';

const stackStyle1 = { gap: 6 } as const;

const sectionHeadingLabelStyle: React.CSSProperties = { color: 'var(--ov-color-fg-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: 11, flexShrink: 0 };

const sectionHeadingDividerStyle: React.CSSProperties = { flex: 1, height: '1px', background: 'var(--ov-color-border-muted)' };

const sectionHeadingStackStyle: React.CSSProperties = { marginBottom: 6 };

const chipStyle = { borderRadius: 4 } as const;
const monoTitleStyle: React.CSSProperties = { fontSize: 12, fontFamily: 'var(--ov-font-mono, monospace)' };
const subGroupStyle: React.CSSProperties = { marginBottom: 4 };
const smallChipStyle: React.CSSProperties = { ...chipStyle, fontSize: 10 };
const countChipStyle: React.CSSProperties = { ...chipStyle, flexShrink: 0 };
const sectionsStyle: React.CSSProperties = { gap: 8 };

const chipRowStyle: React.CSSProperties = { marginTop: 4 };
const subLabelStyle: React.CSSProperties = { color: 'var(--ov-color-fg-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 };

const contentStyle: React.CSSProperties = { paddingBlock: 4, paddingInline: 8 };
const addrValueStyle: React.CSSProperties = { fontWeight: 600, fontSize: 11 };

/** Build a resourceKey from an ObjectReference's apiVersion + kind */
function refToResourceKey(apiVersion?: string, kind?: string): string {
  if (!apiVersion || !kind) return '';
  const group = apiVersion.includes('/')
    ? apiVersion.replace('/', '::')
    : `core::${apiVersion}`;
  return `${group}::${kind}`;
}

const ConditionChips: React.FC<{ ep: Endpoint }> = ({ ep }) => {
  const conds = ep.conditions;
  if (!conds) return null;

  return (
    <Stack direction="row" spacing={1}>
      {conds.ready != null && (
        <Chip size="xs" color={conds.ready ? 'success' : 'neutral'} style={{ ...chipStyle, ...(conds.ready ? {} : { opacity: 0.45 }) }}>Ready</Chip>
      )}
      {conds.serving != null && (
        <Chip size="xs" color={conds.serving ? 'success' : 'neutral'} style={{ ...chipStyle, ...(conds.serving ? {} : { opacity: 0.45 }) }}>Serving</Chip>
      )}
      {conds.terminating != null && conds.terminating && (
        <Chip size="xs" color="warning" style={chipStyle}>Terminating</Chip>
      )}
    </Stack>
  );
};

interface Props {
  endpoints?: Endpoint[];
  connectionID?: string;
}

const SliceEndpointsSection: React.FC<Props> = ({ endpoints, connectionID }) => {
  if (!endpoints || endpoints.length === 0) return null;

  const sections: ExpandableSection[] = endpoints.map((ep: Endpoint, idx: number) => {
    const primaryAddr = ep.addresses?.[0] ?? '';
    const isReady = ep.conditions?.ready !== false;

    return {
      title: (
        <Stack direction="row" spacing={0} align="center" style={stackStyle1}>
          <Text weight="semibold" size="xs" style={monoTitleStyle}>
            {primaryAddr || `endpoint-${idx}`}
          </Text>
          {!isReady && (
            <Chip size="xs" color="warning" style={chipStyle}>Not Ready</Chip>
          )}
        </Stack>
      ),
      defaultExpanded: endpoints.length <= 5,
      children: (
        <div style={contentStyle}>
          {/* Addresses */}
          {ep.addresses && ep.addresses.length > 0 && (
            <div style={subGroupStyle}>
              <Text size="xs" weight="semibold" style={subLabelStyle}>
                Addresses
              </Text>
              <Stack direction="row" spacing={1} wrap>
                {ep.addresses.map((addr) => (
                  <ClipboardText key={addr} value={addr} style={addrValueStyle} />
                ))}
              </Stack>
            </div>
          )}

          {/* Conditions */}
          <ConditionChips ep={ep} />

          {/* Additional info */}
          <Stack direction="row" spacing={1} wrap style={chipRowStyle}>
            {ep.hostname && (
              <Chip size="xs" color="neutral" style={smallChipStyle} variant="outline">{`host: ${ep.hostname}`}</Chip>
            )}
            {ep.zone && (
              <Chip size="xs" color="neutral" style={smallChipStyle} variant="outline">{`zone: ${ep.zone}`}</Chip>
            )}
            {ep.nodeName && connectionID ? (
              <ResourceLinkChip
                connectionID={connectionID}
                resourceKey="core::v1::Node"
                resourceID={ep.nodeName}
                resourceName={ep.nodeName}
              />
            ) : ep.nodeName ? (
              <Chip size="xs" color="neutral" style={smallChipStyle} variant="outline">{`node: ${ep.nodeName}`}</Chip>
            ) : null}
            {ep.targetRef && connectionID && ep.targetRef.name ? (
              <ResourceLinkChip
                connectionID={connectionID}
                resourceKey={
                  refToResourceKey(ep.targetRef.apiVersion, ep.targetRef.kind) ||
                  `core::v1::${ep.targetRef.kind || 'Pod'}`
                }
                resourceID={ep.targetRef.name}
                resourceName={ep.targetRef.name}
                namespace={ep.targetRef.namespace}
              />
            ) : ep.targetRef && ep.targetRef.name ? (
              <Chip size="xs" color="brand" style={smallChipStyle} variant="outline">{`${ep.targetRef.kind}/${ep.targetRef.name}`}</Chip>
            ) : null}
          </Stack>
        </div>
      ),
    };
  });

  return (
    <Stack direction="column" spacing={2}>
      <Stack direction="row" align="center" spacing={2} style={sectionHeadingStackStyle}>
        <Text size="xs" weight="semibold" style={sectionHeadingLabelStyle}>
          Endpoints
        </Text>
        <Chip size="xs" color="brand" style={countChipStyle} variant="outline">{String(endpoints.length)}</Chip>
        <div style={sectionHeadingDividerStyle} />
      </Stack>
      <ExpandableSections sections={sections} size="sm" style={sectionsStyle} />
    </Stack>
  );
};

export default SliceEndpointsSection;
