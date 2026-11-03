import { Chip, ClipboardText, Stack, Text } from '@omniviewdev/base-ui';
import React from 'react';

import ExpandableSections from './ExpandableSections';

const titleTextStyle: React.CSSProperties = { fontSize: 'var(--ov-font-size-caption)' };
const titleRowStyle: React.CSSProperties = { gap: 6 };

const chipStyle: React.CSSProperties = { borderRadius: 4 };

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 2,
  alignItems: 'center',
  paddingInline: 8,
  paddingBlock: 4,
};

const keyTextStyle: React.CSSProperties = { fontSize: 'var(--ov-font-size-caption)', fontWeight: 400, width: '100%', minWidth: 0 };

const valueTextStyle: React.CSSProperties = { fontSize: 'var(--ov-font-size-caption)', fontWeight: 600, width: '100%', minWidth: 0 };

interface Props {
  title: string;
  kvs: Record<string, string>;
  defaultExpanded?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const KVCard: React.FC<Props> = ({ title, kvs, defaultExpanded, size = 'sm' }) => {
  const sections = [
    {
      title: (
        <Stack direction="row" spacing={0} align="center" style={titleRowStyle}>
          <Text weight="semibold" size="xs" style={titleTextStyle}>
            {title}
          </Text>
          <Chip size="xs" variant="outline" color="brand" style={chipStyle}>
            {String(Object.keys(kvs).length)}
          </Chip>
        </Stack>
      ),
      defaultExpanded: defaultExpanded && Object.keys(kvs).length > 0,
      children: (
        <div style={gridStyle}>
          {Object.entries(kvs).map(([key, value]) => (
            <React.Fragment key={key}>
              <ClipboardText value={key} truncate style={keyTextStyle} />
              <ClipboardText value={value} truncate style={valueTextStyle} />
            </React.Fragment>
          ))}
        </div>
      ),
    },
  ];

  return <ExpandableSections sections={sections} size={size} />;
};

export default KVCard;
