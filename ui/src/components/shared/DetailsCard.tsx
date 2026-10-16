import { ClipboardText, Stack, Text } from '@omniviewdev/base-ui';
import React from 'react';

// project imports
import Icon from './Icon';

const outerBoxStyle: React.CSSProperties = {
  borderRadius: 4,
  border: '1px solid var(--ov-color-border-default)',
  overflow: 'hidden',
};

const sectionStyle: React.CSSProperties = {
  borderTop: '1px solid var(--ov-color-border-muted)',
};

const iconImageStyle: React.CSSProperties = { maxHeight: 16, maxWidth: 16, borderRadius: 4 };
const entryIconImageStyle: React.CSSProperties = { width: 20, height: 20, borderRadius: '50%' };
const cellStyle: React.CSSProperties = { minWidth: 0, display: 'flex', alignItems: 'center' };
const valueTextBase: React.CSSProperties = { minWidth: 0, flex: 1 };

export interface DetailsCardEntry {
  key: string;
  value: string;
  icon?: string | React.ReactNode;
  ratio?: [number, number];
  used?: string;
  defaultValue?: string;
  endAdornment?: React.ReactNode;
  startAdornment?: React.ReactNode;
}

export interface DetailsCardProps {
  title?: string;
  titleSize?: 'sm' | 'md' | 'lg';
  icon?: string | React.ReactNode;
  data: DetailsCardEntry[];
  endAdornment?: React.ReactNode;
  /** Nested details share their parent's enclosure and own only a dividing edge. */
  boundary?: 'enclosed' | 'section';
  /** Show the kv pair even if the value is undefined */
  showUndefined?: boolean;
}

const sizeConfig = {
  sm: {
    fontSize: 13,
    iconSize: 14,
    headerPy: 4,
    headerPx: 8,
    bodyP: 8,
    bodyFontSize: 13,
    gap: 4,
    gridSpacing: 4,
  },
  md: {
    fontSize: 14,
    iconSize: 14,
    headerPy: 6,
    headerPx: 10,
    bodyP: 10,
    bodyFontSize: 13,
    gap: 6,
    gridSpacing: 4,
  },
  lg: {
    fontSize: 16,
    iconSize: 16,
    headerPy: 8,
    headerPx: 10,
    bodyP: 10,
    bodyFontSize: 14,
    gap: 8,
    gridSpacing: 6,
  },
} as const;

/**
 * Renders a card for showing a key-value pairs of details
 */
export const DetailsCard: React.FC<DetailsCardProps> = ({
  title,
  titleSize = 'md',
  icon,
  data,
  endAdornment,
  showUndefined = false,
  boundary = 'enclosed',
}) => {
  const cfg = sizeConfig[titleSize];

  return (
    <div style={boundary === 'section' ? sectionStyle : outerBoxStyle}>
      {title && (
        <div
          style={{
            paddingBlock: cfg.headerPy,
            paddingInline: cfg.headerPx,
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: boundary === 'enclosed' ? '1px solid var(--ov-color-border-muted)' : undefined,
          }}
        >
          <Stack direction="row" spacing={0} align="center" style={{ gap: cfg.gap }}>
            {icon &&
              (typeof icon === 'string' ? (
                icon.startsWith('http') ? (
                  <img src={icon} alt="" style={iconImageStyle} />
                ) : (
                  <Icon name={icon} size={cfg.iconSize} />
                )
              ) : (
                icon
              ))}
            <Text style={{ fontSize: cfg.fontSize }} weight="semibold" size="sm">
              {title}
            </Text>
          </Stack>
          {endAdornment}
        </div>
      )}
      <div style={{ padding: cfg.bodyP }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(12, minmax(0, 1fr))',
            gap: cfg.gridSpacing,
          }}
        >
          {data.map((entry) => {
            if (entry.value || showUndefined) {
              return (
                <React.Fragment key={entry.key}>
                  <div style={{ ...cellStyle, gridColumn: `span ${entry.ratio?.[0] ?? 5}` }}>
                    <Stack direction="row" spacing={0} align="center" style={{ gap: 6 }}>
                      {entry.icon &&
                        (typeof entry.icon === 'string' ? (
                          entry.icon.startsWith('http') ? (
                            <img src={entry.icon} alt="" style={entryIconImageStyle} />
                          ) : (
                            <Icon name={entry.icon} size={cfg.iconSize} />
                          )
                        ) : (
                          icon
                        ))}
                      <Text style={{ fontSize: cfg.bodyFontSize }}>{entry.key}</Text>
                    </Stack>
                  </div>
                  <div style={{ ...cellStyle, gridColumn: `span ${entry.ratio?.[1] ?? 7}` }}>
                    <Stack
                      direction="row"
                      spacing={0}
                      align="center"
                      justify="between"
                      style={{ gap: 6, width: '100%', minWidth: 0 }}
                    >
                      <ClipboardText
                        value={entry.used ? `${entry.used} / ${entry.value}` : entry.value}
                        truncate
                        style={{ ...valueTextBase, fontSize: cfg.bodyFontSize }}
                      />
                      {entry.endAdornment}
                    </Stack>
                  </div>
                </React.Fragment>
              );
            }
          })}
        </div>
      </div>
    </div>
  );
};

DetailsCard.displayName = 'DetailsCard';

export default DetailsCard;
