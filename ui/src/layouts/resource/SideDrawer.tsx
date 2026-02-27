import Box, { type BoxProps } from '@mui/material/Box';
import React from 'react';

const backdropSx = {
  position: 'absolute',
  inset: 0,
  bgcolor: 'rgba(0, 0, 0, 0.5)',
} as const;

const drawerContentSx = {
  minWidth: 256,
  width: 'max-content',
  height: '100%',
  p: 2,
  boxShadow: 6,
  bgcolor: 'background.paper',
} as const;

type Props = BoxProps & {
  onClose: React.MouseEventHandler<HTMLDivElement>;
};

/**
 * An optional side drawer component for the sidenav layout.
 */
const SideDrawer: React.FC<Props> = ({ onClose, ...props }) => (
  <Box
    {...props}
    sx={[
      {
        position: 'fixed',
        zIndex: 1200,
        width: '100%',
        height: '100%',
      },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- MUI SxProps internally uses `any`
      ...(Array.isArray(props.sx) ? props.sx : [props.sx]),
    ]}
  >
    <Box
      role="button"
      onClick={onClose}
      sx={backdropSx}
    />
    <Box
      sx={drawerContentSx}
    >
      {props.children}
    </Box>
  </Box>
);

export default SideDrawer;
