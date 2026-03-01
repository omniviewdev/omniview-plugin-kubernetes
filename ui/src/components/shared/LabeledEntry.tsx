import Grid from '@mui/material/Grid';
import { ClipboardText } from '@omniviewdev/ui';
import { Text } from '@omniviewdev/ui/typography';
import React from 'react';

const entryGridSx = { minHeight: 22, alignItems: 'center' } as const;
const entryLabelSx = { color: 'neutral.300' } as const;
const entryValueSx = { fontWeight: 600, fontSize: 12 } as const;

interface Props {
  label: string;
  value?: string | React.ReactNode;
  /** Grid column width for the label (out of 12). Defaults to 4. */
  labelSize?: number;
}

const LabeledEntry: React.FC<Props> = ({ label, value, labelSize = 4 }) => {
  if (value === undefined || value === null) return null;
  const clamped = Math.min(Math.max(labelSize, 1), 11);
  return (
    <Grid container spacing={0} sx={entryGridSx}>
      <Grid size={clamped}>
        <Text sx={entryLabelSx} size="xs">
          {label}
        </Text>
      </Grid>
      <Grid size={12 - clamped}>
        {typeof value === 'string' ? (
          <ClipboardText value={value} variant="inherit" sx={entryValueSx} />
        ) : (
          value
        )}
      </Grid>
    </Grid>
  );
};

export default LabeledEntry;
