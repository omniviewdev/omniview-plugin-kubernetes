import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import { Card, ExpandableSections } from '@omniviewdev/ui';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { formatRelative } from 'date-fns';
import { ObjectMeta } from 'kubernetes-types/meta/v1';
import React from 'react';

const gridCellSx = { alignItems: 'center' } as const;

const keyTextSx = { color: 'neutral.400' } as const;

const valueTextSx = { color: 'neutral.100' } as const;

const cardSx = {
  p: 0,
  gap: 0,
  borderRadius: 'sm',
} as const;

const metadataHeaderSx = { py: 1, px: 1.25 } as const;

const metadataBodySx = {
  p: 1,
  px: 1.5,
  backgroundColor: 'background.level1',
  borderBottomRightRadius: 6,
  borderBottomLeftRadius: 6,
} as const;

const annotationKeyTextSx = { fontSize: 13, fontWeight: 400 } as const;

const annotationValueTextSx = { fontSize: 13, fontWeight: 600 } as const;

interface Props {
  data?: ObjectMeta;
}

const ObjectMetaEntry: React.FC<{
  title: string;
  value: string | undefined;
}> = ({ title, value }) => (
  <Grid container spacing={0}>
    <Grid size={3} sx={gridCellSx}>
      <Text sx={keyTextSx} size="sm">
        {title}
      </Text>
    </Grid>
    <Grid size={9} sx={gridCellSx}>
      <Text weight="semibold" size="sm" sx={valueTextSx}>
        {value}
      </Text>
    </Grid>
  </Grid>
);

const ObjectMetaSection: React.FC<Props> = ({ data }) => {
  if (!data) {
    return null;
  }

  const kvSections = [
    {
      title: 'Annotations',
      defaultExpanded: false,
      children: (
        <Grid container spacing={0.25}>
          {Object.entries(data.annotations || {}).map(([key, value]) => (
            <React.Fragment key={key}>
              <Grid size={6} sx={gridCellSx}>
                <Text sx={annotationKeyTextSx} size="sm">
                  {key}
                </Text>
              </Grid>
              <Grid size={6} sx={gridCellSx}>
                <Text sx={annotationValueTextSx} size="sm">
                  {value}
                </Text>
              </Grid>
            </React.Fragment>
          ))}
        </Grid>
      ),
    },
    {
      title: 'Labels',
      defaultExpanded: false,
      children: (
        <Grid container spacing={0.25}>
          {Object.entries(data.labels || {}).map(([key, value]) => (
            <React.Fragment key={key}>
              <Grid size={6} sx={gridCellSx}>
                <Text sx={annotationKeyTextSx} size="sm">
                  {key}
                </Text>
              </Grid>
              <Grid size={6} sx={gridCellSx}>
                <Text sx={annotationValueTextSx} size="sm">
                  {value}
                </Text>
              </Grid>
            </React.Fragment>
          ))}
        </Grid>
      ),
    },
  ];

  return (
    <Stack direction="column" gap={1}>
      <Card
        sx={cardSx}
        variant="outlined"
      >
        <Box sx={metadataHeaderSx}>
          <Text weight="semibold" size="sm">
            Metadata
          </Text>
        </Box>
        <Divider />
        <Box
          sx={metadataBodySx}
        >
          <ObjectMetaEntry title="Name" value={data.name} />
          {data.namespace && <ObjectMetaEntry title="Namespace" value={data.namespace} />}
          <ObjectMetaEntry
            title="Created"
            value={
              data.creationTimestamp
                ? formatRelative(new Date(data.creationTimestamp), new Date())
                : undefined
            }
          />
          <ObjectMetaEntry title="Version" value={data.resourceVersion} />
        </Box>
      </Card>
      <ExpandableSections sections={kvSections} />
    </Stack>
  );
};

export default ObjectMetaSection;
