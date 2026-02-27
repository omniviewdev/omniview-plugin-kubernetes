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
    <Grid size={3} sx={{ alignItems: 'center' }}>
      <Text sx={{ color: 'neutral.300' }} size="xs">
        {title}
      </Text>
    </Grid>
    <Grid size={9} sx={{ alignItems: 'center' }}>
      {typeof value === 'string' ? (
        <ClipboardText value={value} variant="inherit" sx={{ fontSize: 12, fontWeight: 600 }} />
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
        sx={{
          p: 0,
          gap: 0,
          borderRadius: 1,
        }}
        variant="outlined"
      >
        <Box sx={{ py: 0.5, px: 1 }}>
          <Text weight="semibold" size="sm">
            Metadata
          </Text>
        </Box>
        <Divider />
        <Box
          sx={{
            py: 0.5,
            px: 1,
            backgroundColor: 'background.level1',
            borderBottomRightRadius: 6,
            borderBottomLeftRadius: 6,
          }}
        >
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
                        sx={{ borderRadius: 2 }}
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
                      sx={{
                        borderRadius: 2,
                      }}
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
