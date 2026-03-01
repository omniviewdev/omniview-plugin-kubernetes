import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import { DrawerContext } from '@omniviewdev/runtime';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import type { Service } from 'kubernetes-types/core/v1';
import React from 'react';

import KVCard from '../../../../../shared/KVCard';
import LabeledEntry from '../../../../../shared/LabeledEntry';
import ObjectMetaSection from '../../../../../shared/ObjectMetaSection';

import ServicePortsSection from './ServicePortsSection';
import ServiceStatusSection from './ServiceStatusSection';

const sectionBorderSx = {
  borderRadius: 1,
  border: '1px solid',
  borderColor: 'divider',
} as const;

const titleAreaSx = { py: 0.5, px: 1 } as const;

const contentAreaSx = { py: 0.5, px: 1, bgcolor: 'background.level1' } as const;

interface Props {
  ctx: DrawerContext<Service>;
}

export const ServiceSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) {
    return null;
  }

  const svc = ctx.data;
  const spec = svc.spec;
  const connectionID = ctx.resource?.connectionID || '';
  const selector = spec?.selector as Record<string, string> | undefined;

  const hasConfig =
    spec?.sessionAffinity ||
    spec?.ipFamilyPolicy ||
    (spec?.ipFamilies && spec.ipFamilies.length > 0) ||
    spec?.internalTrafficPolicy ||
    spec?.externalTrafficPolicy;

  return (
    <Stack direction="column" width={'100%'} spacing={2}>
      <Stack direction="column" spacing={0.5}>
        <ObjectMetaSection data={svc.metadata} />
        <ServiceStatusSection service={svc} connectionID={connectionID} />

        {hasConfig && (
          <Box sx={sectionBorderSx}>
            <Box sx={titleAreaSx}>
              <Text weight="semibold" size="sm">
                Configuration
              </Text>
            </Box>
            <Divider />
            <Box sx={contentAreaSx}>
              <LabeledEntry
                label="Session Affinity"
                value={spec?.sessionAffinity || 'None'}
              />
              {spec?.ipFamilyPolicy && (
                <LabeledEntry label="IP Family Policy" value={spec.ipFamilyPolicy} />
              )}
              {spec?.ipFamilies && spec.ipFamilies.length > 0 && (
                <LabeledEntry label="IP Families" value={spec.ipFamilies.join(', ')} />
              )}
              {spec?.internalTrafficPolicy && (
                <LabeledEntry label="Internal Traffic" value={spec.internalTrafficPolicy} />
              )}
              {spec?.externalTrafficPolicy && (
                <LabeledEntry label="External Traffic" value={spec.externalTrafficPolicy} />
              )}
            </Box>
          </Box>
        )}
      </Stack>

      {selector && Object.keys(selector).length > 0 && (
        <KVCard title="Selector" kvs={selector} defaultExpanded />
      )}

      <ServicePortsSection
        service={svc}
        connectionID={connectionID}
        resourceID={ctx.resource?.id || ''}
      />
    </Stack>
  );
};

ServiceSidebar.displayName = 'ServiceSidebar';
export default ServiceSidebar;
