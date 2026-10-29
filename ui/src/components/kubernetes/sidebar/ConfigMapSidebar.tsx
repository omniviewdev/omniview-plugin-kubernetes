import { Chip, Stack } from '@omniviewdev/base-ui';
import { DrawerContext } from '@omniviewdev/runtime';
import { ConfigMap } from 'kubernetes-types/core/v1';
import React from 'react';
import { LuCode } from 'react-icons/lu';

import CodeEditor from '../../shared/CodeEditor';
import ExpandableSections from '../../shared/ExpandableSections';
import ObjectMetaSection from '../../shared/ObjectMetaSection';

const configsChipStyle: React.CSSProperties = { borderRadius: 'var(--ov-radius-sm)', marginBottom: 8 };

interface Props {
  ctx: DrawerContext<ConfigMap>;
}

/**
 * Renders a sidebar for a ConfigMap resource
 */
export const ConfigMapSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) {
    return null;
  }

  const configMap = ctx.data;

  // compose your component here
  return (
    <Stack direction="column" spacing={4} style={{ width: '100%' }}>
      <ObjectMetaSection data={configMap.metadata} connectionID={ctx.resource?.connectionID} />

      <div>
        <Chip style={configsChipStyle} size="md" variant="soft" startDecorator={<LuCode />}>
          Configs
        </Chip>
        {configMap.data !== undefined && (
          <ExpandableSections
            sections={Object.entries(configMap.data).map(([key, value], idx) => ({
              title: key,
              icon: 'LuFile',
              defaultExpanded: idx === 0,
              children: (
                <CodeEditor
                  value={value}
                  height="40vh"
                  filename={`${configMap.metadata?.uid}/${key}`}
                  readOnly={true}
                />
              ),
            }))}
          />
        )}
      </div>
    </Stack>
  );
};

ConfigMapSidebar.displayName = 'ConfigMapSidebar';
export default ConfigMapSidebar;
