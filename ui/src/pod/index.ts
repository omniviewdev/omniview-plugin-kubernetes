import type { DetailPageDefinition, DetailPageV1 } from '../contract/v1';

import { usePodPage } from './usePodPage';

/**
 * What the host draws of a Pod's page before it has read anything (the contribution contract's detail page): the kind and its tile, how a route names a Pod (its name, qualified
 * by its namespace when two tabs would read alike), the list it is read from (the crumb above it, and the sidebar entry that stays selected) and the page's tabs. The Overview is
 * the only tab built so far; the others (Events, Metrics, YAML) arrive with their own steps.
 */
export const podPageDefinition = {
  kind: 'Pod',
  tile: { icon: 'box', tone: 'blue' },
  identity: { name: 'name', facets: ['namespace'] },
  list: { page: 'pods', label: 'Pods' },
  tabs: [{ id: 'overview', label: 'Overview' }],
} satisfies DetailPageDefinition;

// The Pod page as the plugin contributes it (`contributionV1.pages`): its definition, which the host's detail page draws, and its one data hook. `satisfies` is where the page's types
// meet the contract's.
export const podPage = { kind: 'detail', definition: podPageDefinition, usePage: usePodPage } satisfies DetailPageV1;
