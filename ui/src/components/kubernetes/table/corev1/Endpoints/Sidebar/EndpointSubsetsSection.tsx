import { Chip, ClipboardText, Stack, Text } from '@omniviewdev/base-ui';
import type {
  EndpointAddress,
  EndpointPort,
  EndpointSubset,
} from 'kubernetes-types/core/v1';
import React from 'react';

import ExpandableSections from '../../../../../shared/ExpandableSections';
import type { ExpandableSection } from '../../../../../shared/ExpandableSections';
import ResourceLinkChip from '../../../../../shared/ResourceLinkChip';

const span4Style: React.CSSProperties = { gridColumn: 'span 4', minWidth: 0 };
const span8Style: React.CSSProperties = { gridColumn: 'span 8', minWidth: 0 };

const stackStyle1 = { gap: 6 } as const;

const sectionHeadingLabelStyle: React.CSSProperties = { color: 'var(--ov-color-fg-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: 11, flexShrink: 0 };

const sectionHeadingDividerStyle: React.CSSProperties = { flex: 1, height: '1px', background: 'var(--ov-color-border-muted)' };

const sectionHeadingStackStyle: React.CSSProperties = { marginBottom: 6 };

const chipStyle = { borderRadius: 4 } as const;
const smallChipStyle: React.CSSProperties = { ...chipStyle, fontSize: 10 };
const monoChipStyle: React.CSSProperties = { ...chipStyle, fontSize: 10, fontFamily: 'var(--ov-font-mono, monospace)' };
const titleTextStyle: React.CSSProperties = { fontSize: 12 };
const subGroupStyle: React.CSSProperties = { marginBottom: 4 };
const countChipStyle: React.CSSProperties = { ...chipStyle, flexShrink: 0 };
const sectionsStyle: React.CSSProperties = { gap: 8 };

const subLabelStyle: React.CSSProperties = { color: 'var(--ov-color-fg-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 };

const contentStyle: React.CSSProperties = { paddingBlock: 4, paddingInline: 8 };

const addrValueStyle: React.CSSProperties = { fontWeight: 600, fontSize: 11 };
const addrLabelStyle: React.CSSProperties = { color: 'var(--ov-color-fg-muted)', fontSize: 11 };
const warningSubLabelStyle: React.CSSProperties = { ...subLabelStyle, color: 'var(--ov-color-warning)' };
const addrRowStyle: React.CSSProperties = { minHeight: 20, alignItems: 'center', display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))' };

/** Build a resourceKey from an ObjectReference's apiVersion + kind */
function refToResourceKey(apiVersion?: string, kind?: string): string {
  if (!apiVersion || !kind) return '';
  const group = apiVersion.includes('/')
    ? apiVersion.replace('/', '::')
    : `core::${apiVersion}`;
  return `${group}::${kind}`;
}

const AddressRow: React.FC<{
  addr: EndpointAddress;
  connectionID?: string;
}> = ({ addr, connectionID }) => (
  <div style={addrRowStyle}>
    <div style={span4Style}>
      <ClipboardText value={addr.ip} style={addrValueStyle} />
    </div>
    <div style={span8Style}>
      <Stack direction="row" spacing={1} align="center" wrap>
        {addr.hostname && (
          <Text size="xs" style={addrLabelStyle}>
            {addr.hostname}
          </Text>
        )}
        {addr.nodeName && connectionID ? (
          <ResourceLinkChip
            connectionID={connectionID}
            resourceKey="core::v1::Node"
            resourceID={addr.nodeName}
            resourceName={addr.nodeName}
          />
        ) : addr.nodeName ? (
          <Chip size="xs" color="neutral" style={smallChipStyle} variant="outline">{addr.nodeName}</Chip>
        ) : null}
        {addr.targetRef && connectionID && addr.targetRef.name ? (
          <ResourceLinkChip
            connectionID={connectionID}
            resourceKey={
              refToResourceKey(addr.targetRef.apiVersion, addr.targetRef.kind) ||
              `core::v1::${addr.targetRef.kind || 'Pod'}`
            }
            resourceID={addr.targetRef.name}
            resourceName={addr.targetRef.name}
            namespace={addr.targetRef.namespace}
          />
        ) : addr.targetRef && addr.targetRef.name ? (
          <Chip size="xs" color="brand" style={smallChipStyle} variant="outline">{`${addr.targetRef.kind}/${addr.targetRef.name}`}</Chip>
        ) : null}
      </Stack>
    </div>
  </div>
);

const PortRow: React.FC<{ port: EndpointPort }> = ({ port }) => (
  <Chip size="xs" color="neutral" style={monoChipStyle} variant="outline">{`${port.protocol || 'TCP'}/${port.port}${port.name ? ` (${port.name})` : ''}`}</Chip>
);

interface Props {
  subsets?: EndpointSubset[];
  connectionID?: string;
}

const EndpointSubsetsSection: React.FC<Props> = ({ subsets, connectionID }) => {
  if (!subsets || subsets.length === 0) return null;

  const sections: ExpandableSection[] = subsets.map(
    (subset: EndpointSubset, idx: number) => {
      const readyCount = subset.addresses?.length || 0;
      const notReadyCount = subset.notReadyAddresses?.length || 0;

      return {
        title: (
          <Stack direction="row" spacing={0} align="center" style={stackStyle1}>
            <Text weight="semibold" size="xs" style={titleTextStyle}>
              Subset {idx + 1}
            </Text>
            {readyCount > 0 && (
              <Chip size="xs" color="success" style={chipStyle}>{`${readyCount} ready`}</Chip>
            )}
            {notReadyCount > 0 && (
              <Chip size="xs" color="warning" style={chipStyle}>{`${notReadyCount} not ready`}</Chip>
            )}
          </Stack>
        ),
        defaultExpanded: subsets.length <= 3,
        children: (
          <div style={contentStyle}>
            {subset.addresses && subset.addresses.length > 0 && (
              <div style={subGroupStyle}>
                <Text size="xs" weight="semibold" style={subLabelStyle}>
                  Ready Addresses
                </Text>
                {subset.addresses.map((addr, i) => (
                  <AddressRow key={`${addr.ip}-${addr.nodeName ?? i}`} addr={addr} connectionID={connectionID} />
                ))}
              </div>
            )}
            {subset.notReadyAddresses && subset.notReadyAddresses.length > 0 && (
              <div style={subGroupStyle}>
                <Text size="xs" weight="semibold" style={warningSubLabelStyle}>
                  Not Ready Addresses
                </Text>
                {subset.notReadyAddresses.map((addr, i) => (
                  <AddressRow key={`${addr.ip}-${addr.nodeName ?? i}`} addr={addr} connectionID={connectionID} />
                ))}
              </div>
            )}
            {subset.ports && subset.ports.length > 0 && (
              <div>
                <Text size="xs" weight="semibold" style={subLabelStyle}>
                  Ports
                </Text>
                <Stack direction="row" spacing={1} wrap>
                  {subset.ports.map((port, i) => (
                    <PortRow key={`${port.protocol}-${port.port}-${i}`} port={port} />
                  ))}
                </Stack>
              </div>
            )}
          </div>
        ),
      };
    },
  );

  return (
    <Stack direction="column" spacing={2}>
      <Stack direction="row" align="center" spacing={2} style={sectionHeadingStackStyle}>
        <Text size="xs" weight="semibold" style={sectionHeadingLabelStyle}>
          Subsets
        </Text>
        <Chip size="xs" color="brand" style={countChipStyle} variant="outline">{String(subsets.length)}</Chip>
        <div style={sectionHeadingDividerStyle} />
      </Stack>
      <ExpandableSections sections={sections} size="sm" style={sectionsStyle} />
    </Stack>
  );
};

export default EndpointSubsetsSection;
