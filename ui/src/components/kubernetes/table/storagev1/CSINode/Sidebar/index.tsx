import { Chip } from '@omniviewdev/ui';
import { DrawerContext } from '@omniviewdev/runtime';
import { Stack } from '@omniviewdev/ui/layout';
import type { CSINode } from 'kubernetes-types/storage/v1';
import React from 'react';

import ExpandableSections, { type ExpandableSection } from '../../../../../shared/ExpandableSections';
import LabeledEntry from '../../../../../shared/LabeledEntry';
import ObjectMetaSection from '../../../../../shared/ObjectMetaSection';

const chipSx = { borderRadius: 1 } as const;

interface Props {
  ctx: DrawerContext<CSINode>;
}

export const CSINodeSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) return null;

  const node = ctx.data;
  const drivers = node.spec?.drivers;

  const sections: ExpandableSection[] = (drivers || []).map((driver, i) => ({
    title: driver.name || `Driver ${i + 1}`,
    defaultExpanded: i === 0,
    children: (
      <Stack direction="column" gap={0.5} sx={{ px: 1, py: 0.5 }}>
        <LabeledEntry label="Node ID" value={driver.nodeID} />
        {driver.topologyKeys && driver.topologyKeys.length > 0 && (
          <LabeledEntry
            label="Topology Keys"
            value={
              <Stack direction="row" gap={0.5} flexWrap="wrap">
                {driver.topologyKeys.map((key) => (
                  <Chip key={key} size="xs" emphasis="soft" color="neutral" label={key} sx={chipSx} />
                ))}
              </Stack>
            }
          />
        )}
        {driver.allocatable?.count !== undefined && (
          <LabeledEntry label="Allocatable Count" value={String(driver.allocatable.count)} />
        )}
      </Stack>
    ),
  }));

  return (
    <Stack direction="column" width="100%" spacing={2}>
      <ObjectMetaSection data={node.metadata} />
      {sections.length > 0 && <ExpandableSections sections={sections} />}
    </Stack>
  );
};

CSINodeSidebar.displayName = 'CSINodeSidebar';
export default CSINodeSidebar;
