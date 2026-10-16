import { Chip, Stack, Text } from '@omniviewdev/base-ui';
import React from 'react';

const headingStackStyle: React.CSSProperties = { marginBottom: 6 };

const headingLabelStyle: React.CSSProperties = {
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  fontSize: 11,
  flexShrink: 0,
};

const countChipStyle: React.CSSProperties = { borderRadius: 4, flexShrink: 0 };

const headingRuleStyle: React.CSSProperties = {
  flex: 1,
  height: 1,
  backgroundColor: 'var(--ov-color-border-muted)',
};

/**
 * IDE-style section heading: uppercase label, count chip and a trailing rule.
 */
const SectionHeading: React.FC<{ label: string; count: number }> = ({ label, count }) => (
  <Stack direction="row" align="center" spacing={2} style={headingStackStyle}>
    <Text size="xs" weight="semibold" tone="muted" style={headingLabelStyle}>
      {label}
    </Text>
    <Chip size="xs" variant="outline" color="brand" style={countChipStyle}>
      {String(count)}
    </Chip>
    <div style={headingRuleStyle} />
  </Stack>
);

export default SectionHeading;
