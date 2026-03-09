import { DrawerContext } from '@omniviewdev/runtime';
import { ResourceClient } from '@omniviewdev/runtime/api';
import { Stack } from '@omniviewdev/ui/layout';
import { useQuery } from '@tanstack/react-query';
import type { Condition, ObjectMeta } from 'kubernetes-types/meta/v1';
import get from 'lodash.get';
import jsonpath from 'jsonpath';
import React from 'react';

import ConditionChip from '../ConditionChip';
import KVCard from '../KVCard';
import LabeledEntry from '../LabeledEntry';
import ObjectMetaSection from '../ObjectMetaSection';
import SidebarSection from '../SidebarSection';

function extractValue(data: Record<string, unknown>, accessor: string): string {
  const parts = accessor.split(',');
  for (const part of parts) {
    const trimmed = part.trim();
    let val: unknown;
    if (trimmed.startsWith('$.')) {
      try {
        val = jsonpath.value(data, trimmed);
      } catch {
        val = undefined;
      }
    } else {
      val = get(data, trimmed);
    }
    if (val !== undefined && val !== null && val !== '') {
      return String(val);
    }
  }
  return '';
}

const SKIP_COLUMNS = new Set(['name', 'namespace', 'age', 'created', 'creation timestamp']);

interface Props {
  ctx: DrawerContext;
}

const GenericResourceSidebar: React.FC<Props> = ({ ctx }) => {
  const data = ctx.data as Record<string, unknown> | undefined;
  const resourceKey = ctx.resource?.key || '';
  const pluginID = ctx.resource?.pluginID || 'kubernetes';

  const { data: definition } = useQuery({
    queryKey: [pluginID, 'resource_definition', resourceKey],
    queryFn: () => ResourceClient.GetResourceDefinition(pluginID, resourceKey),
    retry: false,
    enabled: !!resourceKey,
  });

  if (!data) return null;

  const metadata = data.metadata as ObjectMeta | undefined;
  const status = data.status as Record<string, unknown> | undefined;
  const spec = data.spec as Record<string, unknown> | undefined;

  const conditions = (status?.conditions || []) as Condition[];

  // Try spec.selector.matchLabels first, then spec.selector as flat map
  const selectorObj = spec?.selector as Record<string, unknown> | undefined;
  const selector: Record<string, string> | undefined =
    (selectorObj?.matchLabels as Record<string, string> | undefined) ??
    (selectorObj && typeof selectorObj === 'object' && !Array.isArray(selectorObj)
      ? (Object.fromEntries(
          Object.entries(selectorObj).filter(
            ([, v]) => typeof v === 'string',
          ),
        ) as Record<string, string>)
      : undefined);

  // Extract key fields from column definitions
  const keyFields: Array<{ header: string; value: string }> = [];
  if (definition?.columnDefs) {
    for (const col of definition.columnDefs) {
      if (col.hidden) continue;
      if (SKIP_COLUMNS.has(col.id?.toLowerCase() || '')) continue;
      if (SKIP_COLUMNS.has(col.header?.toLowerCase() || '')) continue;
      const val = extractValue(data, col.accessor);
      if (val) {
        keyFields.push({ header: col.header, value: val });
      }
    }
  }

  return (
    <Stack direction="column" width="100%" spacing={2}>
      <Stack direction="column" spacing={0.5}>
        <ObjectMetaSection data={metadata} />

        {keyFields.length > 0 && (
          <SidebarSection title="Key Fields">
            {keyFields.map((f) => (
              <LabeledEntry key={f.header} label={f.header} value={f.value} />
            ))}
          </SidebarSection>
        )}

        {conditions.length > 0 && (
          <SidebarSection title="Conditions" bodySx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {conditions.map((c) => (
              <ConditionChip
                key={c.type}
                condition={c}
              />
            ))}
          </SidebarSection>
        )}
      </Stack>

      {selector && Object.keys(selector).length > 0 && (
        <KVCard title="Selector" kvs={selector} defaultExpanded />
      )}
    </Stack>
  );
};

GenericResourceSidebar.displayName = 'GenericResourceSidebar';
export default GenericResourceSidebar;
