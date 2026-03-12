import Box from '@mui/material/Box';
import { Alert } from '@omniviewdev/ui/feedback';
import { Stack } from '@omniviewdev/ui/layout';
import { Text, Heading } from '@omniviewdev/ui/typography';
import React, { useEffect } from 'react';
import { LuCircleAlert } from 'react-icons/lu';

import {
  errorHeadingSx,
  errorWrapperSx,
  errorStackSx,
  errorDetailSx,
  errorListSx,
  errorListItemSx,
  errorListItemTextSx,
  errorCodeSx,
} from './styles';

type ResourceTableErrorStateProps = {
  error: Error | null;
  resourceKey: string;
};

const ResourceTableErrorState: React.FC<ResourceTableErrorStateProps> = ({
  error,
  resourceKey,
}) => {
  const errstring = error?.toString() ?? '';
  const errlower = errstring.toLowerCase();
  useEffect(() => {
    console.error('Failed loading resources', errstring);
  }, [errstring]);

  let title = 'Failed to load resources';
  let detail = errstring;
  let suggestions: string[] = [];

  if (errlower.includes('could not find the requested resource')) {
    title = 'Resource group not found';
    detail = 'The requested resource type could not be found on this cluster.';
    suggestions = [
      'The resource group may not exist on this cluster',
      'The API group may have been removed or is not installed',
      'You may not have permission to discover this API group',
    ];
  } else if (
    errlower.includes('forbidden') ||
    errlower.includes('403')
  ) {
    title = 'Access denied';
    detail = 'You do not have permission to access this resource.';
    suggestions = [
      'Check your RBAC permissions for this resource type',
      'Contact your cluster administrator for access',
      'Verify your kubeconfig context is correct',
    ];
  } else if (
    errlower.includes('connection refused') ||
    errlower.includes('no such host') ||
    errlower.includes('network') ||
    errlower.includes('timeout') ||
    errlower.includes('etimedout') ||
    errlower.includes('econnrefused')
  ) {
    title = 'Connection error';
    detail = 'Unable to reach the cluster API server.';
    suggestions = [
      'Check that the cluster is running and reachable',
      'Verify your network connection',
      'Check if a VPN or proxy is required',
    ];
  } else if (
    errlower.includes('certificate') ||
    errlower.includes('x509') ||
    errlower.includes('tls')
  ) {
    title = 'Certificate error';
    detail = 'There was a TLS/certificate issue connecting to the cluster.';
    suggestions = [
      'The cluster certificate may have expired',
      'Your kubeconfig may reference outdated certificates',
      'Check if the CA bundle is configured correctly',
    ];
  } else if (
    errlower.includes('unauthorized') ||
    errlower.includes('401')
  ) {
    title = 'Authentication failed';
    detail = 'Your credentials were rejected by the cluster.';
    suggestions = [
      'Your auth token may have expired — try re-authenticating',
      'Check your kubeconfig credentials',
      'If using OIDC, try refreshing your login',
    ];
  }

  return (
    <Box sx={errorWrapperSx}>
      <Alert
        emphasis="soft"
        size="lg"
        startAdornment={<LuCircleAlert size={20} />}
        color="danger"
      >
        <Heading level="h4" sx={errorHeadingSx}>
          {title}
        </Heading>
      </Alert>
      <Stack direction="column" spacing={1} sx={errorStackSx}>
        <Text size="sm" sx={errorDetailSx}>
          {detail}
        </Text>
        {suggestions.length > 0 && (
          <Box component="ul" sx={errorListSx}>
            {suggestions.map((s) => (
              <Box component="li" key={s} sx={errorListItemSx}>
                <Text size="xs" sx={errorListItemTextSx}>
                  {s}
                </Text>
              </Box>
            ))}
          </Box>
        )}
        <Text
          size="xs"
          sx={errorCodeSx}
        >
          {resourceKey}: {errstring || 'Unknown error'}
        </Text>
      </Stack>
    </Box>
  );
};

export default ResourceTableErrorState;
