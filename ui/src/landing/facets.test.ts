import { describe, expect, it } from 'vitest';

import { NOT_DETECTED, facetOptions, groupsOf, statedForMost } from './facets';
import type { ConnectionRow } from './model';
import { WORDS } from './testing';

// What the page of all the connections narrows and groups by besides the state: the platform and the region their labels state.

const row = (key: string, platform: string | undefined, region: string | undefined = undefined): ConnectionRow => ({
  key,
  name: key,
  description: undefined,
  state: 'disconnected',
  word: WORDS.disconnected[0],
  role: WORDS.disconnected[1],
  reason: undefined,
  busy: undefined,
  platform,
  region,
});

describe('the facets and the groups of the connections', () => {
  it('list the values the connections have, in the order of the words, each with how many have it (those that state none are in no value); draw the region only where most connections state one; and group the cards by platform only where more than one is present, the ones that state none last', () => {
    const rows = [row('a', 'kind'), row('b', 'EKS', 'us-east-1'), row('c', 'EKS', 'us-east-2'), row('d', 'GKE', 'us-east-1'), row('e', undefined), row('f', 'EKS', 'us-east-1')];

    expect(facetOptions(rows, 'platform')).toEqual([{ value: 'EKS', count: 3 }, { value: 'GKE', count: 1 }, { value: 'kind', count: 1 }]);
    expect(facetOptions(rows, 'region')).toEqual([{ value: 'us-east-1', count: 3 }, { value: 'us-east-2', count: 1 }]);
    expect(facetOptions([row('x', undefined)], 'platform')).toEqual([]);

    // Four of six state a region, which is most of them; one of two is half of them, which is not.
    expect(statedForMost(rows, 'region')).toBe(true);
    expect(statedForMost(rows.slice(0, 2), 'region')).toBe(false);
    expect(statedForMost(rows, 'platform')).toBe(true);
    expect(statedForMost([], 'platform')).toBe(false);

    expect(groupsOf(rows)?.map(({ title, rows: members }) => [title, members.map((member) => member.key)])).toEqual([
      ['EKS', ['b', 'c', 'f']],
      ['GKE', ['d']],
      ['kind', ['a']],
      [NOT_DETECTED, ['e']],
    ]);
    expect(NOT_DETECTED).toBe('Not detected');

    // One platform is not a choice between platforms, with the connections that state none beside it or not; none at all is no grouping either.
    expect(groupsOf([row('a', 'EKS'), row('b', 'EKS')])).toBeUndefined();
    expect(groupsOf([row('a', 'EKS'), row('b', undefined)])).toBeUndefined();
    expect(groupsOf([row('a', undefined)])).toBeUndefined();
  });
});
