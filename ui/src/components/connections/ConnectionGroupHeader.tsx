import { Button, Separator, Text } from '@omniviewdev/base-ui';
import React from 'react';
import { LuChevronRight } from 'react-icons/lu';

import styles from './Connections.module.css';
import ProviderIcon from './ProviderIcon';

type Props = {
  label: string;
  count: number;
  provider?: string;
  isCollapsed: boolean;
  onToggle: () => void;
};

const ConnectionGroupHeader: React.FC<Props> = ({
  label,
  count,
  provider,
  isCollapsed,
  onToggle,
}) => (
  <div className={styles.groupHeader}>
    <Button
      size="sm"
      variant="ghost"
      onClick={onToggle}
      aria-expanded={!isCollapsed}
      style={{ minInlineSize: 0, maxInlineSize: '100%' }}
    >
      <LuChevronRight
        aria-hidden
        style={{ transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)' }}
      />
      {provider && <ProviderIcon provider={provider} size={16} />}
      <Text weight="semibold" size="sm" truncate title={label}>
        {label}
      </Text>
      <Text size="xs" tone="muted" style={{ whiteSpace: 'nowrap' }}>
        {count} {count === 1 ? 'cluster' : 'clusters'}
      </Text>
    </Button>
    <Separator decorative style={{ flex: 1 }} />
  </div>
);

export default ConnectionGroupHeader;
