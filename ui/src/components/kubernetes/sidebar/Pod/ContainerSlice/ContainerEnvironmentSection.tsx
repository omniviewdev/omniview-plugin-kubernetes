import { Chip, Grid } from '@omniviewdev/base-ui';
import type { Container, Pod } from 'kubernetes-types/core/v1';
import React from 'react';

import DetailsCard, { type DetailsCardEntry } from '../../../../shared/DetailsCard';
import ResourceLinkChip from '../../../../shared/ResourceLinkChip';

import { resolveFieldRef, resolveResourceFieldRef } from './helpers';

const refChipStyle: React.CSSProperties = { borderRadius: 4, flexShrink: 0 };

// ────────────────────────────────────────────────────────────────────────────
// Environment variable formatting (resolves dynamic refs)
// ────────────────────────────────────────────────────────────────────────────

function formatEnvEntry(
  env: NonNullable<Container['env']>[number],
  pod?: Pod,
  container?: Container,
  connectionID?: string,
): DetailsCardEntry {
  const ns = pod?.metadata?.namespace;

  if (env.valueFrom) {
    const vf = env.valueFrom;

    if (vf.configMapKeyRef) {
      const cmName = vf.configMapKeyRef.name || '?';
      return {
        key: env.name,
        value: `${cmName} \u2192 ${vf.configMapKeyRef.key}`,
        icon: 'LuFileText',
        ratio: [5, 7],
        endAdornment:
          connectionID && cmName !== '?' ? (
            <ResourceLinkChip
              connectionID={connectionID}
              resourceKey="core::v1::ConfigMap"
              resourceID={cmName}
              resourceName="ConfigMap"
              namespace={ns}
            />
          ) : (
            <Chip size="xs" variant="soft" color="brand" style={refChipStyle}>
              ConfigMap
            </Chip>
          ),
      };
    }

    if (vf.secretKeyRef) {
      const secretName = vf.secretKeyRef.name || '?';
      return {
        key: env.name,
        value: `${secretName} \u2192 ${vf.secretKeyRef.key}`,
        icon: 'LuKeyRound',
        ratio: [5, 7],
        endAdornment:
          connectionID && secretName !== '?' ? (
            <ResourceLinkChip
              connectionID={connectionID}
              resourceKey="core::v1::Secret"
              resourceID={secretName}
              resourceName="Secret"
              namespace={ns}
            />
          ) : (
            <Chip size="xs" variant="soft" color="warning" style={refChipStyle}>
              Secret
            </Chip>
          ),
      };
    }

    if (vf.fieldRef) {
      const resolved = pod ? resolveFieldRef(pod, vf.fieldRef.fieldPath) : undefined;
      return {
        key: env.name,
        value: resolved || vf.fieldRef.fieldPath,
        icon: 'LuLink2',
        ratio: [5, 7],
        endAdornment: (
          <Chip size="xs" variant="soft" color="neutral" style={refChipStyle}>
            {resolved ? vf.fieldRef.fieldPath : 'FieldRef'}
          </Chip>
        ),
      };
    }

    if (vf.resourceFieldRef) {
      const resolved = container
        ? resolveResourceFieldRef(container, vf.resourceFieldRef.resource)
        : undefined;
      return {
        key: env.name,
        value: resolved || vf.resourceFieldRef.resource,
        icon: 'LuCpu',
        ratio: [5, 7],
        endAdornment: (
          <Chip size="xs" variant="soft" color="neutral" style={refChipStyle}>
            {resolved ? vf.resourceFieldRef.resource : 'Resource'}
          </Chip>
        ),
      };
    }

    return { key: env.name, value: '(ref)', ratio: [5, 7] };
  }

  return {
    key: env.name,
    value: env.value || '',
    ratio: [5, 7],
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────

export interface ContainerEnvironmentSectionProps {
  container: Container;
  pod?: Pod;
  connectionID: string;
}

const ContainerEnvironmentSection: React.FC<ContainerEnvironmentSectionProps> = ({
  container,
  pod,
  connectionID,
}) => {
  const envData: DetailsCardEntry[] | undefined = container.env?.map((env) =>
    formatEnvEntry(env, pod, container, connectionID),
  );

  if (!envData || envData.length === 0) return null;

  return (
    <Grid.Item span={12}>
      <DetailsCard boundary="section" title="Environment Variables" titleSize="sm" icon="LuKey" data={envData} />
    </Grid.Item>
  );
};

export default ContainerEnvironmentSection;
