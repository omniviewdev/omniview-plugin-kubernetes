import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import { Text } from '@omniviewdev/ui/typography';
import { infoRowSx, infoLabelSx } from './constants';

function InfoRow({ label, value }: { label: string; value?: string }) {
  const empty = !value;
  return (
    <>
      <Box sx={infoRowSx}>
        <Text size="xs" sx={infoLabelSx}>
          {label}
        </Text>
        <Text
          size="sm"
          weight="medium"
          sx={{
            wordBreak: 'break-all',
            opacity: empty ? 0.4 : 1,
            fontStyle: empty ? 'italic' : undefined,
          }}
        >
          {empty ? 'Not discovered' : value}
        </Text>
      </Box>
      <Divider />
    </>
  );
}

export default InfoRow;
