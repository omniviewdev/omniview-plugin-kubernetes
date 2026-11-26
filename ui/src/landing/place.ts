import type { Narrowing } from './model';

// The place of the page of all the connections, as its route says it. The window keeps a place for a tab (its page and its parameters) and saves it with the tab, so what is in the route survives a reload, is what the
// sidebar's entries open the page with and what Back and Forward step through: the state filter the strip shows and the values of the facets. A change of the parameters alone keeps the page's Body (`context.setParams`, a
// link, an entry of the sidebar, Back and Forward all give the same Body the new `context.route.params`), so what is not in the route is the Body's own state and stays across them: the search, how the connections are drawn
// (the table or the cards) and the order of the table.

/** Everything the route says of the page of all the connections. */
export type Place = Narrowing;

/** The names of the route's parameters. */
const STATE = 'state';
const PLATFORM = 'platform';
const REGION = 'region';

const decoded = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    // Text that was typed into an address by hand: it is read as it was written.
    return value;
  }
};

/** The values of a facet as a parameter holds them: each encoded, so that no value can pass for two, and separated by commas. */
const valuesOf = (text: string | undefined): readonly string[] => (text === undefined ? [] : text.split(',').filter((value) => value !== '').map(decoded));

/** The place a route's parameters say. A route with none says every connection; what is not known is left out: a state that is not one. */
export function placeOf(params: Readonly<Record<string, string>>): Place {
  const state = params[STATE];
  return { scope: state === 'connected' || state === 'attention' ? state : null, platform: valuesOf(params[PLATFORM]), region: valuesOf(params[REGION]) };
}

/** The route parameters that say a place: only what is not the default, so that every connection has none. */
export function paramsOf({ scope, platform, region }: Place): Readonly<Record<string, string>> {
  const encode = (values: readonly string[]): string => values.map(encodeURIComponent).join(',');
  return {
    ...(scope === null ? {} : { [STATE]: scope }),
    ...(platform.length === 0 ? {} : { [PLATFORM]: encode(platform) }),
    ...(region.length === 0 ? {} : { [REGION]: encode(region) }),
  };
}
