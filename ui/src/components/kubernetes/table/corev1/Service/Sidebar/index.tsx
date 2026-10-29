import { Stack, Text, Separator } from '@omniviewdev/base-ui';
import { DrawerContext } from '@omniviewdev/runtime';
import type { Service } from 'kubernetes-types/core/v1';
import React from 'react';

import KVCard from '../../../../../shared/KVCard';
import LabeledEntry from '../../../../../shared/LabeledEntry';
import ObjectMetaSection from '../../../../../shared/ObjectMetaSection';

import ServicePortsSection from './ServicePortsSection';
import ServiceStatusSection from './ServiceStatusSection';

const fullWidthStyle = { width: '100%' } as const;

const sectionBorderStyle: React.CSSProperties = { borderRadius: 4, border: '1px solid', borderColor: 'var(--ov-color-border-default)' };

const titleAreaStyle: React.CSSProperties = { paddingBlock: 4, paddingInline: 8 };

const contentAreaStyle: React.CSSProperties = { paddingBlock: 4, paddingInline: 8, background: 'var(--ov-color-bg-surface-raised)' };

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
  const selector = spec?.selector;

  const hasConfig =
    spec?.sessionAffinity ||
    spec?.ipFamilyPolicy ||
    (spec?.ipFamilies && spec.ipFamilies.length > 0) ||
    spec?.internalTrafficPolicy ||
    spec?.externalTrafficPolicy;

  return (
    <Stack direction="column" spacing={4} style={fullWidthStyle}>
      <Stack direction="column" spacing={1}>
        <ObjectMetaSection data={svc.metadata} connectionID={ctx.resource?.connectionID} />
        <ServiceStatusSection service={svc} connectionID={connectionID} />

        {hasConfig && (
          <div style={sectionBorderStyle}>
            <div style={titleAreaStyle}>
              <Text weight="semibold" size="sm">
                Configuration
              </Text>
            </div>
            <Separator />
            <div style={contentAreaStyle}>
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
            </div>
          </div>
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
