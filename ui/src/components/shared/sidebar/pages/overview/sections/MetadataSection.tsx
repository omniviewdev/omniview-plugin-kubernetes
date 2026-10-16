import { Card, Chip, ClipboardText, Separator, Stack, Text } from '@omniviewdev/base-ui';
import { formatRelative } from 'date-fns';
import { ObjectMeta } from 'kubernetes-types/meta/v1';
import React from 'react';

import KVCard from '../../../../KVCard';
import ResourceLinkChip, { ownerRefToResourceKey } from '../../../../ResourceLinkChip';

// ---------------------------------------------------------------------------
// Static styles
// ---------------------------------------------------------------------------

const entryGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 9fr)',
  alignItems: 'center',
};
const cellStyle: React.CSSProperties = { minWidth: 0 };
const clipboardTextStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, width: '100%', minWidth: 0 };
const cardStyle: React.CSSProperties = { padding: 0, gap: 0, borderRadius: 4, minWidth: 0 };
const cardHeaderStyle: React.CSSProperties = { paddingBlock: 4, paddingInline: 8 };
const cardBodyStyle: React.CSSProperties = {
  paddingBlock: 4,
  paddingInline: 8,
  borderBottomRightRadius: 6,
  borderBottomLeftRadius: 6,
};
const chipStyle: React.CSSProperties = { borderRadius: 8 };

interface Props {
  data?: ObjectMeta;
  /** When provided, owner reference chips become clickable and open the referenced resource's sidebar */
  connectionID?: string;
}

const ObjectMetaEntry: React.FC<{
  title: string;
  value: string | React.ReactNode | undefined;
}> = ({ title, value }) => (
  <div style={entryGridStyle}>
    <div style={cellStyle}>
      <Text tone="muted" size="xs">
        {title}
      </Text>
    </div>
    <div style={cellStyle}>
      {typeof value === 'string' ? (
        <ClipboardText value={value} truncate style={clipboardTextStyle} />
      ) : (
        value
      )}
    </div>
  </div>
);

const MetadataSection: React.FC<Props> = ({ data, connectionID }) => {
  if (!data) {
    return null;
  }

  return (
    <Stack direction="column" spacing={1}>
      <Card variant="outline" color="neutral" style={cardStyle}>
        <div style={cardHeaderStyle}>
          <Text weight="semibold" size="sm">
            Metadata
          </Text>
        </div>
        <Separator />
        <div style={cardBodyStyle}>
          <ObjectMetaEntry title="Name" value={data.name} />
          {data.namespace && <ObjectMetaEntry title="Namespace" value={data.namespace} />}
          {data.creationTimestamp && (
            <ObjectMetaEntry
              title="Created"
              value={formatRelative(new Date(data.creationTimestamp), new Date())}
            />
          )}
          {data.deletionTimestamp && (
            <ObjectMetaEntry
              title="Deletion"
              value={formatRelative(new Date(), new Date(data.deletionTimestamp))}
            />
          )}
          {data.resourceVersion && <ObjectMetaEntry title="Version" value={data.resourceVersion} />}
          {!!data.ownerReferences?.length && (
            <ObjectMetaEntry
              title={data.ownerReferences?.length > 1 ? 'Owners' : 'Owner'}
              value={
                <Stack direction="row" spacing={2}>
                  {data.ownerReferences.map((ref) =>
                    connectionID ? (
                      <ResourceLinkChip
                        key={ref.uid}
                        connectionID={connectionID}
                        resourceKey={ownerRefToResourceKey(ref)}
                        resourceID={ref.name}
                        resourceName={ref.kind}
                        namespace={data.namespace}
                      />
                    ) : (
                      <Chip key={ref.uid} size="sm" variant="soft" color="brand" style={chipStyle}>
                        {ref.kind}
                      </Chip>
                    ),
                  )}
                </Stack>
              }
            />
          )}
          {!!data.finalizers?.length && (
            <ObjectMetaEntry
              title="Finalizers"
              value={
                <Stack direction="row" spacing={2}>
                  {data.finalizers.map((finalizer) => (
                    <Chip key={finalizer} size="sm" variant="soft" color="brand" style={chipStyle}>
                      {finalizer}
                    </Chip>
                  ))}
                </Stack>
              }
            />
          )}
        </div>
      </Card>
      {data.annotations && <KVCard title="Annotations" kvs={data.annotations} />}
      {data.labels && <KVCard title="Labels" kvs={data.labels} />}
    </Stack>
  );
};

export default MetadataSection;
