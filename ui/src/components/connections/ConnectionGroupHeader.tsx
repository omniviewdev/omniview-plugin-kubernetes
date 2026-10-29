import { Chip, Text } from '@omniviewdev/base-ui';
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
  // eslint-disable-next-line jsx-a11y-x/click-events-have-key-events, jsx-a11y-x/no-static-element-interactions
  <div className={styles.groupHeader} onClick={onToggle}>
    <LuChevronRight
      size={16}
      style={{
        transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
        transition: 'transform 0.15s ease',
      }}
    />
    {provider && <ProviderIcon provider={provider} size={16} />}
    <Text weight="semibold" size="sm">
      {label}
    </Text>
    <Chip size="sm" variant="soft" color="neutral">
      {String(count)}
    </Chip>
  </div>
);

export default ConnectionGroupHeader;
