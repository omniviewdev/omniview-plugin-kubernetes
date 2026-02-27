// Material-ui
import Box from '@mui/material/Box';
import DialogContent from '@mui/material/DialogContent';
import Divider from '@mui/material/Divider';
import { Chip } from '@omniviewdev/ui';
import { IconButton } from '@omniviewdev/ui/buttons';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { type FC } from 'react';
import { LuX } from 'react-icons/lu';

import DynamicIcon from '../components/DynamicIcon';

const decoratorChipSx = { borderRadius: 'sm' } as const;

const containerSx = {
  borderRadius: 'md',
  p: 1,
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  maxHeight: 'calc(100vh - 64px)',
  minHeight: 'calc(100vh - 64px)',
  overflow: 'auto',
} as const;

const titleChipSx = { borderRadius: 'sm' } as const;

const titleTextSx = { flexGrow: 1 } as const;

const dialogContentSx = {
  gap: 2,
  p: 0.5,
  overflowY: 'auto',
  maxWidth: '100%',
  overflowX: 'hidden',
  scrollbarWidth: 'none',
  '&::-webkit-scrollbar': {
    display: 'none',
  },
  'ms-overflow-style': 'none',
} as const;

type Props = {
  icon?: string | React.ReactNode;
  type: string;
  title: string;
  decorator?: string | React.ReactNode;
  open: boolean;
  onClose: () => void;
  children?: React.ReactNode;
};

type JSONValue = string | number | boolean | JSONObject | JSONArray;

interface JSONObject {
  [x: string]: JSONValue;
}

type JSONArray = Array<JSONValue>;

const ResourceDrawerDecorator: FC<{
  icon: string | React.ReactNode;
  type: string;
}> = ({ icon, type }) => {
  return (
    <Chip
      size="lg"
      emphasis="soft"
      sx={decoratorChipSx}
      startAdornment={typeof icon === 'string' ? <DynamicIcon name={icon} size={16} /> : icon}
      label={
        <Text weight="semibold" size="sm">
          {type}
        </Text>
      }
    />
  );
};

const ResourceDrawerContainer: FC<Props> = ({ icon, type, title, children }) => (
  <Box
    sx={containerSx}
  >
    <Stack direction="row" alignItems="center" justifyContent={'space-between'}>
      <Chip
        size="lg"
        emphasis="ghost"
        sx={titleChipSx}
        label={<Text sx={titleTextSx}>{title}</Text>}
      />
      <Stack direction="row" gap={1}>
        <ResourceDrawerDecorator icon={icon ?? 'LuBox'} type={type} />
        <IconButton emphasis="outline" size="sm" onClick={() => {}}>
          <LuX size={20} />
        </IconButton>
      </Stack>
    </Stack>
    <Divider />
    <DialogContent
      sx={dialogContentSx}
    >
      {children}
    </DialogContent>
  </Box>
);

export default ResourceDrawerContainer;
