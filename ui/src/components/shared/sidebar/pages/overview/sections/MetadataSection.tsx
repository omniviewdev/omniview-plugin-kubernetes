import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import { Card, Chip, ClipboardText } from '@omniviewdev/ui';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { formatRelative } from 'date-fns';
import { ObjectMeta } from 'kubernetes-types/meta/v1';
import React from 'react';

import KVCard from '../../../../KVCard';
import ResourceLinkChip, { ownerRefToResourceKey } from '../../../../ResourceLinkChip';

// ---------------------------------------------------------------------------
// Static styles
// ---------------------------------------------------------------------------

const gridAlignSx = { alignItems: 'center' } as const;
const entryTitleSx = { color: 'neutral.300' } as const;
const clipboardTextSx = { fontSize: 12, fontWeight: 600 } as const;
const cardSx = { p: 0, gap: 0, borderRadius: 1 } as const;
const cardHeaderSx = { py: 0.5, px: 1 } as const;
const cardBodySx = {
  py: 0.5,
  px: 1,
  backgroundColor: 'background.level1',
  borderBottomRightRadius: 6,
  borderBottomLeftRadius: 6,
} as const;
const chipSx = { borderRadius: 2 } as const;

interface Props {
  data?: ObjectMeta;
  /** When provided, owner reference chips become clickable and open the referenced resource's sidebar */
  connectionID?: string;
}

const ObjectMetaEntry: React.FC<{
  title: string;
  value: string | React.ReactNode | undefined;
}> = ({ title, value }) => (
  <Grid container spacing={0}>
    <Grid size={3} sx={gridAlignSx}>
      <Text sx={entryTitleSx} size="xs">
        {title}
      </Text>
    </Grid>
    <Grid size={9} sx={gridAlignSx}>
      {typeof value === 'string' ? (
        <ClipboardText value={value} variant="inherit" sx={clipboardTextSx} />
      ) : (
        value
      )}
    </Grid>
  </Grid>
);

const MetadataSection: React.FC<Props> = ({ data, connectionID }) => {
  if (!data) {
    return null;
  }

  return (
    <Stack direction="column" gap={0.5}>
      <Card
        sx={cardSx}
        variant="outlined"
      >
        <Box sx={cardHeaderSx}>
          <Text weight="semibold" size="sm">
            Metadata
          </Text>
        </Box>
        <Divider />
        <Box sx={cardBodySx}>
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
                <Stack direction="row">
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
                      <Chip
                        key={ref.uid}
                        size="sm"
                        emphasis="soft"
                        color="primary"
                        sx={chipSx}
                        label={ref.kind}
                      />
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
                <Stack direction="row">
                  {data.finalizers.map((finalizer) => (
                    <Chip
                      key={finalizer}
                      size="sm"
                      emphasis="soft"
                      color="primary"
                      sx={chipSx}
                      label={finalizer}
                    />
                  ))}
                </Stack>
              }
            />
          )}
        </Box>
      </Card>
      {data.annotations && <KVCard title="Annotations" kvs={data.annotations} />}
      {data.labels && <KVCard title="Labels" kvs={data.labels} />}
    </Stack>
  );
};

export default MetadataSection;
