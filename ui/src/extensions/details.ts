import { deploymentTabs, serviceTabs } from '@omniviewdev/kubernetes-extension-points';
import { tabOutlet } from '@omniviewdev/runtime/ui/extensions/v1';
import { extensionRootOf } from '@omniviewdev/runtime/ui/v1';

import { managedBy, type LocatedObject } from './object';

export function deploymentPlacement({ uid, kind, metadata, record }: LocatedObject) {
  const manager = managedBy(metadata);
  const body = record.record.body;
  const spec = body.kind === 'map' ? body.value.spec : undefined;
  const count = spec?.kind === 'map' ? spec.value.replicas : undefined;
  const replicas =
    count?.kind === 'int64' || count?.kind === 'uint64' ? Number(count.value) : undefined;
  return {
    extensionScopeKey: uid,
    tabOutlet: tabOutlet(deploymentTabs, {
      kind,
      ...(manager === undefined ? {} : { managedBy: manager }),
      ...(replicas !== undefined && Number.isSafeInteger(replicas) && replicas >= 0
        ? { replicas }
        : {}),
    }),
  };
}

export function servicePlacement({ uid, record }: LocatedObject) {
  const root = extensionRootOf?.(record);
  return {
    extensionScopeKey: uid,
    tabOutlet: tabOutlet(serviceTabs, {}),
    ...(root === undefined ? {} : { extensionRoot: root }),
  };
}
