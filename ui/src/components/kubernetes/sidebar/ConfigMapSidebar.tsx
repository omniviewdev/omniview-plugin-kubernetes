import { DrawerContext } from '@omniviewdev/runtime';
import { Chip } from '@omniviewdev/ui';
import { Stack } from '@omniviewdev/ui/layout';
import { ConfigMap } from 'kubernetes-types/core/v1';
import React from 'react';
import { LuCode } from 'react-icons/lu';

import CodeEditor from '../../shared/CodeEditor';
import ExpandableSections from '../../shared/ExpandableSections';
import ObjectMetaSection from '../../shared/ObjectMetaSection';

const configsChipSx = { borderRadius: 'sm', mb: 1 } as const;

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
    <Stack direction="column" width={'100%'} spacing={2}>
      <ObjectMetaSection data={configMap.metadata} />

      <div>
        <Chip
          sx={configsChipSx}
          size="md"
          emphasis="soft"
          startAdornment={<LuCode />}
          label="Configs"
        />
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
