import { Separator, Text } from '@omniviewdev/base-ui';
import { Container, ContainerStatus, Pod, PodSpec } from 'kubernetes-types/core/v1';
import React from 'react';

import SectionHeading from '../shared/SectionHeading';
import { subsectionLabelStyle } from '../shared/sectionStyles';

import ContainerSlice from './ContainerSlice';

const groupHeaderStyle: React.CSSProperties = { padding: '6px 10px 2px' };
const containerBoxStyle: React.CSSProperties = {
  borderRadius: 4,
  border: '1px solid var(--ov-color-border-default)',
  backgroundColor: 'var(--ov-color-bg-surface)',
  overflow: 'hidden',
};

type ContainerType = 'container' | 'init' | 'ephemeral';

interface ParsedContainer {
  resourceID: string;
  connectionID: string;
  container: Container;
  status?: ContainerStatus;
  type: ContainerType;
}

function parseContainers(pod: Pod, resourceID: string, connectionID: string): ParsedContainer[] {
  const result: ParsedContainer[] = [];

  const containerStatusMap: Record<string, ContainerStatus> = {};
  pod.status?.containerStatuses?.forEach((cs) => {
    containerStatusMap[cs.name] = cs;
  });

  const initStatusMap: Record<string, ContainerStatus> = {};
  pod.status?.initContainerStatuses?.forEach((cs) => {
    initStatusMap[cs.name] = cs;
  });

  const ephemeralStatusMap: Record<string, ContainerStatus> = {};
  pod.status?.ephemeralContainerStatuses?.forEach((cs) => {
    ephemeralStatusMap[cs.name] = cs;
  });

  pod.spec?.initContainers?.forEach((container) => {
    result.push({
      resourceID,
      connectionID,
      container,
      status: initStatusMap[container.name],
      type: 'init',
    });
  });

  pod.spec?.containers?.forEach((container) => {
    result.push({
      resourceID,
      connectionID,
      container,
      status: containerStatusMap[container.name],
      type: 'container',
    });
  });

  pod.spec?.ephemeralContainers?.forEach((ec) => {
    result.push({
      resourceID,
      connectionID,
      container: ec,
      status: ephemeralStatusMap[ec.name],
      type: 'ephemeral',
    });
  });

  return result;
}

// ── Sub-group header for init/ephemeral containers ──
const GroupHeader: React.FC<{ label: string }> = ({ label }) => (
  <div style={groupHeaderStyle}>
    <Text size="xs" weight="semibold" tone="muted" style={subsectionLabelStyle}>
      {label}
    </Text>
  </div>
);

interface ContainersSectionProps {
  resourceID: string;
  connectionID: string;
  obj: Pod;
  /** Pod-level CPU usage in millicores (from metrics-server) */
  podCpuUsage?: number;
  /** Pod-level memory usage in bytes (from metrics-server) */
  podMemoryUsage?: number;
}

const PodContainersSection: React.FC<ContainersSectionProps> = ({
  obj,
  resourceID,
  connectionID,
  podCpuUsage,
  podMemoryUsage,
}) => {
  const parsed = parseContainers(obj, resourceID, connectionID);
  if (parsed.length === 0) return null;

  const initContainers = parsed.filter((c) => c.type === 'init');
  const regularContainers = parsed.filter((c) => c.type === 'container');
  const ephemeralContainers = parsed.filter((c) => c.type === 'ephemeral');

  return (
    <div>
      <SectionHeading label="Containers" count={parsed.length} />
      <div style={containerBoxStyle}>
        {initContainers.length > 0 && (
          <>
            <GroupHeader label="Init Containers" />
            {initContainers.map((c, i) => (
              <React.Fragment key={c.container.name}>
                {i > 0 && <Separator />}
                <ContainerSlice
                  {...c}
                  pod={obj}
                  volumes={obj.spec?.volumes}
                  podCpuUsage={podCpuUsage}
                  podMemoryUsage={podMemoryUsage}
                />
              </React.Fragment>
            ))}
            {(regularContainers.length > 0 || ephemeralContainers.length > 0) && <Separator />}
          </>
        )}
        {regularContainers.map((c, i) => (
          <React.Fragment key={c.container.name}>
            {i > 0 && <Separator />}
            <ContainerSlice
              {...c}
              pod={obj}
              volumes={obj.spec?.volumes}
              podCpuUsage={podCpuUsage}
              podMemoryUsage={podMemoryUsage}
            />
          </React.Fragment>
        ))}
        {ephemeralContainers.length > 0 && (
          <>
            {regularContainers.length > 0 && <Separator />}
            <GroupHeader label="Ephemeral Containers" />
            {ephemeralContainers.map((c, i) => (
              <React.Fragment key={c.container.name}>
                {i > 0 && <Separator />}
                <ContainerSlice
                  {...c}
                  pod={obj}
                  volumes={obj.spec?.volumes}
                  podCpuUsage={podCpuUsage}
                  podMemoryUsage={podMemoryUsage}
                />
              </React.Fragment>
            ))}
          </>
        )}
      </div>
    </div>
  );
};

export const PodContainersSectionFromPodSpec: React.FC<{
  resourceID: string;
  connectionID: string;
  spec?: PodSpec;
}> = ({ spec, resourceID, connectionID }) => {
  if (!spec?.containers) return null;

  const containers: ParsedContainer[] = [];

  spec.initContainers?.forEach((container) => {
    containers.push({ resourceID, connectionID, container, type: 'init' });
  });

  spec.containers.forEach((container) => {
    containers.push({
      resourceID,
      connectionID,
      container,
      type: 'container',
    });
  });

  const initContainers = containers.filter((c) => c.type === 'init');
  const regularContainers = containers.filter((c) => c.type === 'container');

  return (
    <div>
      <SectionHeading label="Containers" count={containers.length} />
      <div style={containerBoxStyle}>
        {initContainers.length > 0 && (
          <>
            <GroupHeader label="Init Containers" />
            {initContainers.map((c, i) => (
              <React.Fragment key={c.container.name}>
                {i > 0 && <Separator />}
                <ContainerSlice {...c} volumes={spec?.volumes} />
              </React.Fragment>
            ))}
            {regularContainers.length > 0 && <Separator />}
          </>
        )}
        {regularContainers.map((c, i) => (
          <React.Fragment key={c.container.name}>
            {i > 0 && <Separator />}
            <ContainerSlice {...c} volumes={spec?.volumes} />
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

export default PodContainersSection;
