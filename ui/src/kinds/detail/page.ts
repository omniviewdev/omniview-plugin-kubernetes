import type { LinkTarget } from '@omniviewdev/kit';

import type { DetailPageV1 } from '../../contract/v1';

import type { ObjectRef } from './overview';
import { useKindDetailPage, type DetailedKind } from './useKindDetailPage';

// The page of one object as the plugin contributes it (`contributionV1.pages`): its static definition, which the host's detail page draws before it has read anything, and its one data hook. This is the ONE
// detail contribution beside `listPage` (`../list.tsx`): every kind that has an overview has `detailPage(definition, resolve)`, and nothing here knows which kind it is given. The return type is where
// the page's types meet the contract's.
export function detailPage(kind: DetailedKind, resolve: (ref: ObjectRef) => LinkTarget | undefined): DetailPageV1 {
  return {
    kind: 'detail',
    definition: {
      kind: kind.kind,
      tile: kind.tile,
      // A route names the object by its name, qualified by its namespace when the kind lives in one and two tabs would read alike.
      identity: { name: 'name', ...(kind.detail.identity.length === 2 ? { facets: ['namespace'] } : {}) },
      // The list the object is read from: the crumb above it, and the sidebar entry that stays selected while the object is open.
      list: { page: kind.page, label: kind.nouns.other },
      tabs: [{ id: 'overview', label: 'Overview' }],
    },
    usePage: (context) => useKindDetailPage(kind, context, resolve),
  };
}
