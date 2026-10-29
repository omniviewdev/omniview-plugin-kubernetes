import { describe, expect, it } from 'vitest';

import { destinationPath, destinationScore, prependRecent, searchDestinations } from './navigation';

describe('global resource navigation', () => {
  it('keeps selectable parent pages and excludes group-only headings', () => {
    const result = searchDestinations([{ title: 'Workloads', items: [
      { id: 'group', label: 'Controllers', children: [{ id: 'apps_v1_Deployment', label: 'Deployments' }] },
      { id: 'page/tools', label: 'Tools', selectable: true, children: [{ id: 'page/tools/audit', label: 'Audit' }] },
    ] }]);
    expect(result.map(item => [item.id, item.resourceKey])).toEqual([
      ['apps_v1_Deployment', 'apps::v1::Deployment'], ['page/tools', undefined], ['page/tools/audit', undefined],
    ]);
  });

  it('keeps disabled descendants unavailable', () => {
    const result = searchDestinations([{ title: '', items: [{ id: 'blocked', label: 'Blocked', disabled: true,
      children: [{ id: 'core_v1_Pod', label: 'Pods' }] }] }]);
    expect(result[0]).toMatchObject({ id: 'core_v1_Pod', disabled: true });
  });

  it('keeps Dashboard and underscored contributed pages navigation-only', () => {
    const result = searchDestinations([{ title: '', items: [
      { id: '__dashboard__', label: 'Dashboard' },
      { id: 'page/custom_v1_Pod', label: 'Custom page' },
      { id: 'core_v1_Pod', label: 'Pod' },
    ] }]);
    expect(result.map(item => [item.id, item.resourceKey])).toEqual([
      ['__dashboard__', undefined], ['page/custom_v1_Pod', undefined], ['core_v1_Pod', 'core::v1::Pod'],
    ]);
  });

  it('does not let a connection name or filter change route structure', () => {
    expect(destinationPath('prod/east?x=1', 'core_v1_Pod', 'api & jobs/#')).toBe(
      '/cluster/prod%2Feast%3Fx%3D1/resources/core_v1_Pod?search=api+%26+jobs%2F%23',
    );
    expect(destinationPath('prod', '__dashboard__')).toBe('/cluster/prod/resources');
    expect(destinationPath('prod', 'page/tools/audit')).toBe('/cluster/prod/resources/page/tools/audit');
  });

  it('ranks Pods above incidental pod matches', () => {
    expect(destinationScore('pod', 'Pods')).toBeGreaterThan(destinationScore('pod', 'PodDisruptionBudget'));
    expect(destinationScore('pods', 'Pods')).toBeGreaterThan(destinationScore('pods', 'HorizontalPodAutoscaler'));
  });

  it('moves a repeated destination first and caps history at eight', () => {
    expect(prependRecent(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 'd')).toEqual(['d', 'a', 'b', 'c', 'e', 'f', 'g', 'h']);
    expect(prependRecent(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 'i')).toEqual(['i', 'a', 'b', 'c', 'd', 'e', 'f', 'g']);
  });
});
