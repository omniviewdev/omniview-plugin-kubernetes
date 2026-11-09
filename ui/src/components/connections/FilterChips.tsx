import { Chip, Stack, Text } from '@omniviewdev/base-ui';
import type { ComponentColor } from '@omniviewdev/base-ui';
import React from 'react';
import { LuX } from 'react-icons/lu';

import type { FilterState, ConnectionAttribute } from '../../types/clusters';
import { getProviderLabel } from '../../utils/providers';

const separatorStyle: React.CSSProperties = { opacity: 0.5, padding: '0 4px' };

type Props = {
  filters: FilterState;
  availableProviders: string[];
  availableAttributes: ConnectionAttribute[];
  availableTags: string[];
  onToggleProvider: (provider: string) => void;
  onToggleStatus: (status: 'connected' | 'disconnected') => void;
  onToggleTag: (tag: string) => void;
  onToggleLabelFilter: (key: string, value: string) => void;
  onClearAll: () => void;
};

type ToggleChipProps = {
  active: boolean;
  activeColor: ComponentColor;
  onClick: () => void;
  children: React.ReactNode;
  endDecorator?: React.ReactNode;
};

const ToggleChip: React.FC<ToggleChipProps> = ({
  active,
  activeColor,
  onClick,
  children,
  endDecorator,
}) => (
  <Chip
    as="button"
    clickable
    size="xs"
    variant={active ? 'soft' : 'outline'}
    color={active ? activeColor : 'neutral'}
    aria-pressed={active}
    onClick={onClick}
    endDecorator={endDecorator}
  >
    {children}
  </Chip>
);

const FilterChips: React.FC<Props> = ({
  filters,
  availableProviders,
  availableAttributes,
  availableTags,
  onToggleProvider,
  onToggleStatus,
  onToggleTag,
  onToggleLabelFilter,
  onClearAll,
}) => {
  const hasActiveFilters =
    (filters.providers?.length ?? 0) > 0 ||
    (filters.environments?.length ?? 0) > 0 ||
    (filters.status?.length ?? 0) > 0 ||
    (filters.tags?.length ?? 0) > 0 ||
    Object.values(filters.labels ?? {}).some((v) => v.length > 0);

  const showProviders = availableProviders.length > 1;
  const showTags = availableTags.length > 0;

  // Show attribute filter chips for high-coverage attributes with 2-8 distinct values
  const filterableAttrs = availableAttributes.filter(
    (a) => a.coverage >= 0.3 && a.distinctValues.length >= 2 && a.distinctValues.length <= 8,
  );

  return (
    <Stack direction="row" align="center" wrap style={{ gap: 6 }}>
      {/* Provider chips */}
      {showProviders &&
        availableProviders.map((provider) => (
          <ToggleChip
            key={provider}
            active={!!filters.providers?.includes(provider)}
            activeColor="brand"
            onClick={() => onToggleProvider(provider)}
          >
            {getProviderLabel(provider)}
          </ToggleChip>
        ))}

      {/* Status chips */}
      <ToggleChip
        active={!!filters.status?.includes('connected')}
        activeColor="success"
        onClick={() => onToggleStatus('connected')}
      >
        Connected
      </ToggleChip>
      <ToggleChip
        active={!!filters.status?.includes('disconnected')}
        activeColor="neutral"
        onClick={() => onToggleStatus('disconnected')}
      >
        Disconnected
      </ToggleChip>

      {/* Tag chips */}
      {showTags && (
        <>
          <Text size="xs" style={separatorStyle}>
            |
          </Text>
          {availableTags.map((tag) => (
            <ToggleChip
              key={`tag:${tag}`}
              active={!!filters.tags?.includes(tag)}
              activeColor="warning"
              onClick={() => onToggleTag(tag)}
            >
              {tag}
            </ToggleChip>
          ))}
        </>
      )}

      {/* Dynamic attribute filter chips */}
      {filterableAttrs.map((attr) => (
        <React.Fragment key={`attr:${attr.key}`}>
          <Text size="xs" style={separatorStyle}>
            |
          </Text>
          {attr.distinctValues.map((val) => {
            const isActive = filters.labels?.[attr.key]?.includes(val) ?? false;
            return (
              <ToggleChip
                key={`${attr.key}:${val}`}
                active={isActive}
                activeColor="brand"
                onClick={() => onToggleLabelFilter(attr.key, val)}
              >
                {val}
              </ToggleChip>
            );
          })}
        </React.Fragment>
      ))}

      {/* Clear all */}
      {hasActiveFilters && (
        <Chip
          as="button"
          clickable
          size="xs"
          variant="outline"
          color="danger"
          onClick={onClearAll}
          endDecorator={<LuX size={12} />}
        >
          Clear
        </Chip>
      )}
    </Stack>
  );
};

export default FilterChips;
