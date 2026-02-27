import Box, { type BoxProps } from '@mui/material/Box';
import React from 'react';

/**
 * An optional side pane component for the sidenav layout.
 */
const SidePane: React.FC<BoxProps> = (props) => (
  <Box
    className="Inbox"
    {...props}
    sx={[
      {
        bgcolor: 'background.paper',
        borderRight: '1px solid',
        borderColor: 'divider',
        display: {
          xs: 'none',
          md: 'initial',
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- MUI SxProps internally uses `any`
      ...(Array.isArray(props.sx) ? props.sx : [props.sx]),
    ]}
  />
);

export default SidePane;
