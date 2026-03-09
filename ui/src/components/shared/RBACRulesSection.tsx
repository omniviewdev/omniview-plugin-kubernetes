import { Chip } from '@omniviewdev/ui';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import type { PolicyRule } from 'kubernetes-types/rbac/v1';
import React from 'react';

import ExpandableSections, { type ExpandableSection } from './ExpandableSections';

const chipSx = { borderRadius: 1 } as const;

const ChipList: React.FC<{ label: string; items?: string[] }> = ({ label, items }) => {
  if (!items || items.length === 0) return null;
  return (
    <Stack direction="column" gap={0.5} sx={{ py: 0.25 }}>
      <Text size="xs" sx={{ color: 'neutral.400' }}>
        {label}
      </Text>
      <Stack direction="row" gap={0.5} flexWrap="wrap">
        {items.map((item, idx) => (
          <Chip
            key={`${item}-${idx}`}
            size="xs"
            emphasis="soft"
            color="neutral"
            label={item || '*'}
            sx={chipSx}
          />
        ))}
      </Stack>
    </Stack>
  );
};

interface Props {
  rules?: PolicyRule[];
}

const RBACRulesSection: React.FC<Props> = ({ rules }) => {
  if (!rules || rules.length === 0) return null;

  const sections: ExpandableSection[] = rules.map((rule, i) => ({
    title: `Rule ${i + 1}`,
    defaultExpanded: i === 0,
    children: (
      <Stack direction="column" gap={0.5} sx={{ px: 1, py: 0.5 }}>
        <ChipList label="API Groups" items={rule.apiGroups} />
        <ChipList label="Resources" items={rule.resources} />
        <ChipList label="Verbs" items={rule.verbs} />
        <ChipList label="Resource Names" items={rule.resourceNames} />
        <ChipList label="Non-Resource URLs" items={rule.nonResourceURLs} />
      </Stack>
    ),
  }));

  return <ExpandableSections sections={sections} />;
};

export default RBACRulesSection;
