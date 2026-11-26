import { describe, expect, it } from 'vitest';

import { paramsOf, placeOf, type Place } from './place';

// The place of the page of all the connections as its route says it: what the sidebar's entries open the page with, what a reload comes back to, and what the strip and the facets move the tab to.

describe('the place a route says', () => {
  it('reads the state and the values of each facet from the parameters, writes only what is not the default (so that every connection is a route with none), and reads what it does not know as the default', () => {
    expect(placeOf({})).toEqual({ scope: null, platform: [], region: [] });
    expect(paramsOf(placeOf({}))).toEqual({});

    const said: Place = { scope: 'attention', platform: ['EKS', 'Docker Desktop'], region: ['us-east-1'] };
    expect(paramsOf(said)).toEqual({ state: 'attention', platform: 'EKS,Docker%20Desktop', region: 'us-east-1' });
    expect(placeOf(paramsOf(said))).toEqual(said);

    // A value is its own, whatever characters it has: a comma or a percent sign in one is not a second value or an escape.
    const odd: Place = { scope: 'connected', platform: ['a,b', '100%', ''], region: [] };
    expect(placeOf(paramsOf(odd)).platform).toEqual(['a,b', '100%']);

    // A route typed by hand: a state that is not one, empty values and an escape that is not valid are what a route with none says, or the text as it was written.
    expect(placeOf({ state: 'bogus', view: 'grid', platform: ',,', region: '%E0%A4%A' })).toEqual({ scope: null, platform: [], region: ['%E0%A4%A'] });
  });
});
