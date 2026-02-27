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

interface JSONArray extends Array<JSONValue> {}

const ResourceDrawerDecorator: FC<{
  icon: string | React.ReactNode;
  type: string;
}> = ({ icon, type }) => {
  return (
    <Chip
      size="lg"
      emphasis="soft"
      sx={{ borderRadius: 'sm' }}
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
    sx={{
      borderRadius: 'md',
      p: 1,
      display: 'flex',
      flexDirection: 'column',
      gap: 1,
      maxHeight: 'calc(100vh - 64px)',
      minHeight: 'calc(100vh - 64px)',
      overflow: 'auto',
    }}
  >
    <Stack direction="row" alignItems="center" justifyContent={'space-between'}>
      <Chip
        size="lg"
        emphasis="ghost"
        sx={{ borderRadius: 'sm' }}
        label={<Text sx={{ flexGrow: 1 }}>{title}</Text>}
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
      sx={{
        gap: 2,
        p: 0.5,
        overflowY: 'auto',
        maxWidth: '100%',
        overflowX: 'hidden',
        scrollbarWidth: 'none',
        // hide scrollbar
        '&::-webkit-scrollbar': {
          display: 'none',
        },
        'ms-overflow-style': 'none',
      }}
    >
      {children}
    </DialogContent>
  </Box>
);

export default ResourceDrawerContainer;
