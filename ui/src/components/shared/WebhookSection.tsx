import { Chip, Stack, Text } from '@omniviewdev/base-ui';
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

const chipStyle: React.CSSProperties = { borderRadius: 4 };
const bodyStyle: React.CSSProperties = { paddingInline: 8, paddingBlock: 4 };
const chipRowStyle: React.CSSProperties = { gap: 2, paddingBlock: 2 };
const ruleStyle: React.CSSProperties = {
  gap: 2,
  paddingBlock: 2,
  paddingLeft: 4,
  borderLeft: '2px solid var(--ov-color-border-muted)',
};

const ChipRow: React.FC<{ label: string; items?: string[] }> = ({ label, items }) => {
  if (!items || items.length === 0) return null;
  return (
    <Stack direction="column" spacing={0} style={chipRowStyle}>
      <Text size="xs" tone="muted">
        {label}
      </Text>
      <Stack direction="row" spacing={1} wrap>
        {items.map((item, idx) => (
          <Chip key={`${item}-${idx}`} size="xs" variant="soft" color="neutral" style={chipStyle}>
            {item}
          </Chip>
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
      <Stack direction="column" spacing={1} style={bodyStyle}>
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
            spacing={0}
            style={ruleStyle}
          >
            <Text size="xs" weight="semibold" tone="muted">
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
