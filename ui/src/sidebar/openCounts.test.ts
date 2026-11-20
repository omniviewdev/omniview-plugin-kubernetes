import { afterEach, describe, expect, it, vi } from 'vitest';

import { getOpenCounts, openKey, publishOpenCount, resetOpenCounts, subscribeOpenCounts } from './openCounts';

// The counts of the lists that are open: a list that is mounted knows how many objects its kind has, live and from the very source it lists, and says so here, so that the sidebar draws that number and does not
// ask for it a second time. Module-level, because the list and the sidebar are two components of the host that share nothing else (they are not one tree).

const pods = openKey('kubernetes', 'kind-a', 'k8s:/pods');
const deployments = openKey('kubernetes', 'kind-a', 'k8s:apps/deployments');

afterEach(() => {
  resetOpenCounts();
});

describe('openKey: which list a count is of', () => {
  it('names the plugin, the connection and the type, and tells two lists apart that differ in any of them', () => {
    const keys = [
      openKey('kubernetes', 'kind-a', 'k8s:/pods'),
      openKey('kubernetes-qa', 'kind-a', 'k8s:/pods'),
      openKey('kubernetes', 'kind-b', 'k8s:/pods'),
      openKey('kubernetes', 'kind-a', 'k8s:apps/deployments'),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('cannot be made to collide by a name that holds what separates the parts', () => {
    expect(openKey('a', 'b:c', 'd')).not.toBe(openKey('a:b', 'c', 'd'));
    expect(openKey('a', 'b', 'c d')).not.toBe(openKey('a', 'b c', 'd'));
  });
});

describe('publishOpenCount: a list that is open says how many', () => {
  it('holds nothing until a list is open', () => {
    expect(getOpenCounts().size).toBe(0);
  });

  it('holds the count a list publishes, by the list', () => {
    publishOpenCount(pods, 12);
    publishOpenCount(deployments, { value: 300, approximate: true });

    expect(getOpenCounts().get(pods)).toBe(12);
    expect(getOpenCounts().get(deployments)).toEqual({ value: 300, approximate: true });
    expect(getOpenCounts().size).toBe(2);
  });

  it('holds a list that has no number to say yet: it is open, and the sidebar need not ask', () => {
    publishOpenCount(pods, null);

    expect(getOpenCounts().has(pods)).toBe(true);
    expect(getOpenCounts().get(pods)).toBeNull();
  });

  it('holds zero as a count', () => {
    publishOpenCount(pods, 0);

    expect(getOpenCounts().get(pods)).toBe(0);
  });

  it('is the list that goes, when it goes: its count is withdrawn, and the others stay', () => {
    const withdraw = publishOpenCount(pods, 12);
    publishOpenCount(deployments, 3);

    withdraw();

    expect(getOpenCounts().has(pods)).toBe(false);
    expect(getOpenCounts().get(deployments)).toBe(3);
  });

  it('withdraws once: a second withdrawal does nothing, not even for a list that has since published again', () => {
    const withdraw = publishOpenCount(pods, 12);
    withdraw();
    publishOpenCount(pods, 13);

    withdraw();

    expect(getOpenCounts().get(pods)).toBe(13);
  });

  it('lets the later of two open lists of one kind speak, and the earlier one again when it goes: the kind is open until both are gone', () => {
    const first = publishOpenCount(pods, 10);
    const second = publishOpenCount(pods, 11);
    expect(getOpenCounts().get(pods)).toBe(11);

    second();
    expect(getOpenCounts().get(pods)).toBe(10);

    first();
    expect(getOpenCounts().has(pods)).toBe(false);
  });

  it('lets the earlier list go first without silencing the later one', () => {
    const first = publishOpenCount(pods, 10);
    publishOpenCount(pods, 11);

    first();

    expect(getOpenCounts().get(pods)).toBe(11);
  });
});

describe('getOpenCounts: the same snapshot until something changes', () => {
  it('is the same map for as long as nothing is published or withdrawn, so a component that reads it re-renders for nothing else', () => {
    publishOpenCount(pods, 12);
    const snapshot = getOpenCounts();

    expect(getOpenCounts()).toBe(snapshot);
  });

  it('is another map after a change, and the map that was handed out is left as it was', () => {
    const withdraw = publishOpenCount(pods, 12);
    const before = getOpenCounts();

    publishOpenCount(deployments, 3);
    const after = getOpenCounts();
    withdraw();

    expect(after).not.toBe(before);
    expect([...before]).toEqual([[pods, 12]]);
    expect([...after].map(([key]) => key)).toEqual([pods, deployments]);
  });

  it('is the same empty map while nothing was ever published', () => {
    expect(getOpenCounts()).toBe(getOpenCounts());
  });
});

describe('subscribeOpenCounts: who is told', () => {
  it('tells a subscriber when a count is published, and when one is withdrawn', () => {
    const listener = vi.fn();
    subscribeOpenCounts(listener);

    const withdraw = publishOpenCount(pods, 12);
    expect(listener).toHaveBeenCalledTimes(1);

    withdraw();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('tells nobody of a withdrawal that withdraws nothing', () => {
    const withdraw = publishOpenCount(pods, 12);
    withdraw();
    const listener = vi.fn();
    subscribeOpenCounts(listener);

    withdraw();

    expect(listener).not.toHaveBeenCalled();
  });

  it('tells every subscriber, and none that has unsubscribed', () => {
    const one = vi.fn();
    const another = vi.fn();
    const unsubscribe = subscribeOpenCounts(one);
    subscribeOpenCounts(another);

    unsubscribe();
    publishOpenCount(pods, 12);

    expect(one).not.toHaveBeenCalled();
    expect(another).toHaveBeenCalledTimes(1);
  });

  it('has the new snapshot ready when it tells', () => {
    let seen: unknown;
    subscribeOpenCounts(() => {
      seen = getOpenCounts().get(pods);
    });

    publishOpenCount(pods, 12);

    expect(seen).toBe(12);
  });
});

describe('resetOpenCounts: for the tests, which share one module', () => {
  it('forgets every list that is open, and tells its subscribers', () => {
    const withdraw = publishOpenCount(pods, 12);
    publishOpenCount(deployments, 3);
    const listener = vi.fn();
    subscribeOpenCounts(listener);

    resetOpenCounts();

    expect(getOpenCounts().size).toBe(0);
    expect(listener).toHaveBeenCalledTimes(1);

    // A list that was open before the reset withdraws nothing now.
    withdraw();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('tells nobody when nothing was open', () => {
    const listener = vi.fn();
    subscribeOpenCounts(listener);

    resetOpenCounts();

    expect(listener).not.toHaveBeenCalled();
  });
});
