import Box, { type BoxProps } from '@mui/material/Box';
import React from 'react';

/**
 * The root component for the generic sidemenu layout
 */
const Root: React.FC<BoxProps> = (props: BoxProps) => (
  <Box
    {...props}
    sx={[
      {
        bgcolor: 'background.default',
        display: 'flex',
        flexDirection: 'row',
        flexGrow: 1,
        overflow: 'hidden',
      },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- MUI SxProps internally uses `any`
      ...(Array.isArray(props.sx) ? props.sx : [props.sx]),
    ]}
  />
);

export default Root;
