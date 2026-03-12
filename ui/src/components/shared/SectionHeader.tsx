import Box from '@mui/material/Box';
import { Text } from '@omniviewdev/ui/typography';

// ── Styles ──────────────────────────────────────────────────────────────────

const simpleSx = { px: 0.5, pt: 1.25, pb: 0.5 } as const;

const simpleTitleSx = {
  color: 'var(--ov-fg-faint, rgba(255,255,255,0.4))',
  textTransform: 'uppercase',
  letterSpacing: '0.07em',
  fontWeight: 600,
} as const;

const richWrapperSx = {
  display: 'flex',
  alignItems: 'center',
  gap: 0.75,
  px: 1.5,
  py: 0.75,
  bgcolor: 'var(--ov-bg-surface)',
  borderBottom: '1px solid var(--ov-border-muted)',
} as const;

const iconSx = { display: 'flex', color: 'var(--ov-fg-faint)', fontSize: 12 } as const;
const richTitleSx = { color: 'var(--ov-fg-muted)', flex: 1 } as const;
const countSx = { color: 'var(--ov-fg-faint)' } as const;

// ── Component ───────────────────────────────────────────────────────────────

type Props = {
  title: string;
  icon?: React.ReactNode;
  count?: number;
};

const SectionHeader: React.FC<Props> = ({ title, icon, count }) => {
  if (!icon) {
    return (
      <Box sx={simpleSx}>
        <Text size="xs" sx={simpleTitleSx}>
          {title}
        </Text>
      </Box>
    );
  }

  return (
    <Box sx={richWrapperSx}>
      <Box sx={iconSx}>{icon}</Box>
      <Text weight="semibold" size="xs" sx={richTitleSx}>
        {title}
      </Text>
      {count !== undefined && count > 0 && (
        <Text size="xs" sx={countSx}>
          {count}
        </Text>
      )}
    </Box>
  );
};

SectionHeader.displayName = 'SectionHeader';
export default SectionHeader;
