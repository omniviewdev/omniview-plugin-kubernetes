import Box from '@mui/material/Box';
import Table from '@mui/material/Table';
import { Chip } from '@omniviewdev/ui';
import { Text } from '@omniviewdev/ui/typography';
import { IngressBackend, IngressRule } from 'kubernetes-types/networking/v1';
import React from 'react';

import { BrowserOpenURL } from '../../../../utils/ide';

const tableSx = { '--TableCell-paddingY': '0rem' } as const;
const backendEndAdornmentSx = { borderRadius: 'sm', px: 1 } as const;
const backendChipSx = { borderRadius: 'sm', p: 0.25 } as const;
const portLabelSx = { px: 1 } as const;

interface Props {
  rule: IngressRule;
}

export const RuleTable: React.FC<Props> = ({ rule }) => {
  const handleLinkClick = (host?: string, path?: string) => {
    if (host) {
      const targetHost = host.startsWith('http') ? host : 'https://' + host;
      const targetPath = path?.startsWith('/') ? path : '/' + path;
      BrowserOpenURL(targetHost + targetPath);
    }
  };

  return (
    <Table
      aria-label="rules table"
      sx={tableSx}
    >
      <thead>
        <tr>
          <th style={{ height: '30px', paddingBottom: '6px' }}>Path</th>
          <th style={{ height: '30px', paddingBottom: '6px', width: '150px' }}>Type</th>
          <th style={{ height: '30px', paddingBottom: '6px' }}>Target</th>
        </tr>
      </thead>
      <tbody>
        {rule.http?.paths.map((path) => (
          <tr
            key={`${path.path ?? '/'}-${path.pathType}`}
            style={{
              padding: '0.5rem',
            }}
          >
            <td
              style={{
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                cursor: 'pointer',
                height: '1.5rem',
              }}
              onClick={() => handleLinkClick(rule.host, path.path)}
            >
              {path.path ?? '/'}
            </td>
            <td>{path.pathType}</td>
            <td>
              <IngressBackendChip backend={path.backend} />
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
};

const IngressBackendChip: React.FC<{ backend: IngressBackend }> = ({ backend }) => {
  if (backend.service !== undefined) {
    return (
      backend.service.port && (
        <Chip
          endAdornment={
            <Box sx={backendEndAdornmentSx}>
              <Text size="xs">{backend.service.name}</Text>
            </Box>
          }
          sx={backendChipSx}
          size="sm"
          emphasis="outline"
          label={
            <Text size="xs" sx={portLabelSx}>
              {backend.service.port.number ?? backend.service.port.name}
            </Text>
          }
        />
      )
    );
  }
};

export default RuleTable;
