import Box, { type BoxProps } from '@mui/material/Box';
import React from 'react';

/**
 * The main component for the sidenav layout.
 */
const Main: React.FC<BoxProps> = (props) => (
  <Box
    component="main"
    className="Main"
    {...props}
    sx={[
      { width: '100%', overflow: 'hidden', flex: 1 },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- MUI SxProps internally uses `any`
      ...(Array.isArray(props.sx) ? props.sx : [props.sx]),
    ]}
  />
);

export default Main;
