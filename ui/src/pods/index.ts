import type { ListPageV1 } from '../contract/v1';

import type { PodRow } from './data';
import { podsListDefinition } from './listDefinition';
import { usePodsPage } from './usePodsPage';

// The Pods list page as the plugin contributes it (`contributionV1.pages`): its definition, which the host's list page draws, and its one data hook.
// `satisfies` is where the page's types meet the contract's: a definition or a source the host's list page cannot draw does not compile here.
export const podsPage = { kind: 'list', definition: podsListDefinition, usePage: usePodsPage } satisfies ListPageV1<PodRow>;
