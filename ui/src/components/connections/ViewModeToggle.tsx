import { Button, Stack } from '@omniviewdev/base-ui';
import React from 'react';
import { LuList, LuLayoutGrid, LuBug } from 'react-icons/lu';

import type { ViewMode } from '../../types/clusters';

type Props = {
  value: ViewMode;
  onChange: (value: ViewMode) => void;
};

const ViewModeToggle: React.FC<Props> = ({ value, onChange }) => (
  <Stack direction="row" align="center" style={{ gap: 'var(--ov-space-stack-xs)' }}>
    <Button
      size="sm"
      variant={value === 'grid' ? 'soft' : 'outline'}
      color={value === 'grid' ? 'brand' : 'neutral'}
      onClick={() => onChange('grid')}
      aria-label="Cards view"
      aria-pressed={value === 'grid'}
    >
      <LuLayoutGrid aria-hidden /> Cards
    </Button>
    <Button
      size="sm"
      variant={value === 'list' ? 'soft' : 'outline'}
      color={value === 'list' ? 'brand' : 'neutral'}
      onClick={() => onChange('list')}
      aria-label="Table view"
      aria-pressed={value === 'list'}
    >
      <LuList aria-hidden /> Table
    </Button>
    <Button
      size="sm"
      variant={value === 'debug' ? 'soft' : 'outline'}
      color={value === 'debug' ? 'brand' : 'neutral'}
      onClick={() => onChange('debug')}
      aria-label="Debug view"
      aria-pressed={value === 'debug'}
    >
      <LuBug aria-hidden /> Debug
    </Button>
  </Stack>
);

export default ViewModeToggle;
