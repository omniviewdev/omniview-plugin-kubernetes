import { Chip } from '@omniviewdev/ui';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import React from 'react';

import ExpandableSections, { type ExpandableSection } from './ExpandableSections';
import KVCard from './KVCard';

interface NamedRuleWithOperations {
  operations?: string[];
  apiGroups?: string[];
  apiVersions?: string[];
  resources?: string[];
  resourceNames?: string[];
  scope?: string;
}

interface MatchResources {
  resourceRules?: NamedRuleWithOperations[];
  excludeResourceRules?: NamedRuleWithOperations[];
  matchPolicy?: string;
  namespaceSelector?: { matchLabels?: Record<string, string> };
  objectSelector?: { matchLabels?: Record<string, string> };
}

interface Props {
  matchResources?: MatchResources;
}

const chipSx = { borderRadius: 1 } as const;

const ChipGroup: React.FC<{ label: string; items?: string[] }> = ({ label, items }) => {
  if (!items || items.length === 0) return null;
  return (
    <Stack direction="column" gap={0.25}>
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

const RulesList: React.FC<{ title: string; rules?: NamedRuleWithOperations[] }> = ({
  title,
  rules,
}) => {
  if (!rules || rules.length === 0) return null;

  const sections: ExpandableSection[] = rules.map((rule, i) => ({
    title: `${title} ${i + 1}`,
    defaultExpanded: i === 0,
    children: (
      <Stack direction="column" gap={0.5} sx={{ px: 1, py: 0.5 }}>
        <ChipGroup label="Operations" items={rule.operations} />
        <ChipGroup label="API Groups" items={rule.apiGroups} />
        <ChipGroup label="API Versions" items={rule.apiVersions} />
        <ChipGroup label="Resources" items={rule.resources} />
        <ChipGroup label="Resource Names" items={rule.resourceNames} />
        {rule.scope && <ChipGroup label="Scope" items={[rule.scope]} />}
      </Stack>
    ),
  }));

  return <ExpandableSections sections={sections} />;
};

const MatchResourcesSection: React.FC<Props> = ({ matchResources }) => {
  if (!matchResources) return null;

  return (
    <Stack direction="column" gap={1}>
      <RulesList title="Resource Rule" rules={matchResources.resourceRules} />
      <RulesList title="Exclude Rule" rules={matchResources.excludeResourceRules} />
      {matchResources.namespaceSelector?.matchLabels &&
        Object.keys(matchResources.namespaceSelector.matchLabels).length > 0 && (
          <KVCard
            title="Namespace Selector"
            kvs={matchResources.namespaceSelector.matchLabels}
            defaultExpanded
          />
        )}
      {matchResources.objectSelector?.matchLabels &&
        Object.keys(matchResources.objectSelector.matchLabels).length > 0 && (
          <KVCard
            title="Object Selector"
            kvs={matchResources.objectSelector.matchLabels}
            defaultExpanded
          />
        )}
    </Stack>
  );
};

export default MatchResourcesSection;
