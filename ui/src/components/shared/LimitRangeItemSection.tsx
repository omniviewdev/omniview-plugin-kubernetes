import { Chip } from '@omniviewdev/ui';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import React from 'react';

import ExpandableSections, { type ExpandableSection } from './ExpandableSections';
import LabeledEntry from './LabeledEntry';

const chipSx = { borderRadius: 1 } as const;

interface LimitRangeItemLike {
  type?: string;
  default?: Record<string, string>;
  defaultRequest?: Record<string, string>;
  max?: Record<string, string>;
  min?: Record<string, string>;
  maxLimitRequestRatio?: Record<string, string>;
}

interface Props {
  limits?: LimitRangeItemLike[];
}

const KVRows: React.FC<{ title: string; kv?: Record<string, string> }> = ({ title, kv }) => {
  if (!kv || Object.keys(kv).length === 0) return null;
  return (
    <Stack direction="column" gap={0.25} sx={{ py: 0.25 }}>
      <Text size="xs" sx={{ color: 'neutral.400' }}>
        {title}
      </Text>
      {Object.entries(kv).map(([k, v]) => (
        <LabeledEntry key={k} label={k} value={v} />
      ))}
    </Stack>
  );
};

const LimitRangeItemSection: React.FC<Props> = ({ limits }) => {
  if (!limits || limits.length === 0) return null;

  const sections: ExpandableSection[] = limits.map((limit, i) => ({
    title: (
      <Stack direction="row" gap={0.75} alignItems="center">
        <Text weight="semibold" size="xs">
          {`Limit ${i + 1}`}
        </Text>
        {limit.type && (
          <Chip size="xs" emphasis="soft" color="primary" label={limit.type} sx={chipSx} />
        )}
      </Stack>
    ),
    defaultExpanded: i === 0,
    children: (
      <Stack direction="column" gap={0.5} sx={{ px: 1, py: 0.5 }}>
        <KVRows title="Default" kv={limit.default} />
        <KVRows title="Default Request" kv={limit.defaultRequest} />
        <KVRows title="Max" kv={limit.max} />
        <KVRows title="Min" kv={limit.min} />
        <KVRows title="Max Limit/Request Ratio" kv={limit.maxLimitRequestRatio} />
      </Stack>
    ),
  }));

  return <ExpandableSections sections={sections} />;
};

export default LimitRangeItemSection;
