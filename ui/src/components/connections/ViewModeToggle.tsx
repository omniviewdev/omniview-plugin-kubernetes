import { IconButton, Stack } from '@omniviewdev/base-ui';
import React from 'react';
import { LuList, LuLayoutGrid, LuBug } from 'react-icons/lu';

import type { ViewMode } from '../../types/clusters';

type Props = {
  value: ViewMode;
  onChange: (value: ViewMode) => void;
};

const ViewModeToggle: React.FC<Props> = ({ value, onChange }) => (
  <Stack direction="row" align="center" style={{ gap: 2 }}>
    <IconButton
      size="sm"
      variant={value === 'list' ? 'soft' : 'ghost'}
      color={value === 'list' ? 'brand' : 'neutral'}
      onClick={() => onChange('list')}
      aria-label="Table view"
      aria-pressed={value === 'list'}
    >
      <LuList size={18} />
    </IconButton>
    <IconButton
      size="sm"
      variant={value === 'grid' ? 'soft' : 'ghost'}
      color={value === 'grid' ? 'brand' : 'neutral'}
      onClick={() => onChange('grid')}
      aria-label="Cards view"
      aria-pressed={value === 'grid'}
    >
      <LuLayoutGrid size={18} />
    </IconButton>
    <IconButton
      size="sm"
      variant={value === 'debug' ? 'soft' : 'ghost'}
      color={value === 'debug' ? 'brand' : 'neutral'}
      onClick={() => onChange('debug')}
      aria-label="Debug view"
      aria-pressed={value === 'debug'}
    >
      <LuBug size={18} />
    </IconButton>
  </Stack>
);

export default ViewModeToggle;
