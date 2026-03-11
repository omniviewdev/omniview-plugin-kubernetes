import { Chip } from '@omniviewdev/ui';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import React from 'react';

import ExpandableSections, { type ExpandableSection } from './ExpandableSections';
import LabeledEntry from './LabeledEntry';

interface WebhookRule {
  operations?: string[];
  apiGroups?: string[];
  apiVersions?: string[];
  resources?: string[];
  scope?: string;
}

interface WebhookLike {
  name?: string;
  clientConfig?: {
    service?: { namespace?: string; name?: string; path?: string; port?: number };
    url?: string;
  };
  failurePolicy?: string;
  sideEffects?: string;
  admissionReviewVersions?: string[];
  timeoutSeconds?: number;
  matchPolicy?: string;
  rules?: WebhookRule[];
  reinvocationPolicy?: string;
}

interface Props {
  webhooks?: WebhookLike[];
}

const chipSx = { borderRadius: 1 } as const;

const ChipRow: React.FC<{ label: string; items?: string[] }> = ({ label, items }) => {
  if (!items || items.length === 0) return null;
  return (
    <Stack direction="column" gap={0.25} sx={{ py: 0.25 }}>
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
            label={item}
            sx={chipSx}
          />
        ))}
      </Stack>
    </Stack>
  );
};

const WebhookSection: React.FC<Props> = ({ webhooks }) => {
  if (!webhooks || webhooks.length === 0) return null;

  const sections: ExpandableSection[] = webhooks.map((wh, i) => ({
    title: wh.name || `Webhook ${i + 1}`,
    defaultExpanded: i === 0,
    children: (
      <Stack direction="column" gap={0.5} sx={{ px: 1, py: 0.5 }}>
        {wh.clientConfig?.service && (
          <LabeledEntry
            label="Service"
            value={`${wh.clientConfig.service.namespace}/${wh.clientConfig.service.name}${wh.clientConfig.service.path || ''}:${wh.clientConfig.service.port || 443}`}
          />
        )}
        {wh.clientConfig?.url && <LabeledEntry label="URL" value={wh.clientConfig.url} />}
        <LabeledEntry label="Failure Policy" value={wh.failurePolicy} />
        <LabeledEntry label="Side Effects" value={wh.sideEffects} />
        <LabeledEntry
          label="Timeout"
          value={wh.timeoutSeconds ? `${wh.timeoutSeconds}s` : undefined}
        />
        <LabeledEntry label="Match Policy" value={wh.matchPolicy} />
        {wh.reinvocationPolicy && (
          <LabeledEntry label="Reinvocation" value={wh.reinvocationPolicy} />
        )}
        <ChipRow label="Admission Review Versions" items={wh.admissionReviewVersions} />
        {wh.rules?.map((rule, ri) => (
          <Stack
            key={ri}
            direction="column"
            gap={0.25}
            sx={{ py: 0.25, pl: 0.5, borderLeft: '2px solid', borderColor: 'divider' }}
          >
            <Text size="xs" weight="semibold" sx={{ color: 'neutral.300' }}>
              Rule {ri + 1}
            </Text>
            <ChipRow label="Operations" items={rule.operations} />
            <ChipRow label="API Groups" items={rule.apiGroups} />
            <ChipRow label="API Versions" items={rule.apiVersions} />
            <ChipRow label="Resources" items={rule.resources} />
            {rule.scope && <LabeledEntry label="Scope" value={rule.scope} />}
          </Stack>
        ))}
      </Stack>
    ),
  }));

  return <ExpandableSections sections={sections} />;
};

export default WebhookSection;
