import { describe, expect, it } from 'vitest';
import { clusterFolderAssignment } from './clusterFolderDrop';

describe('folder drop intent', () => {
  const source = { type: 'connection', connectionId: 'cluster', sourceGroupId: 'source' };
  it('never changes membership for cancel, outside or non-folder drops', () => {
    expect(clusterFolderAssignment(source, undefined)).toBeUndefined();
    expect(clusterFolderAssignment(source, { type: 'section' })).toBeUndefined();
    expect(
      clusterFolderAssignment(undefined, { type: 'folder-drop', groupId: 'target' }),
    ).toBeUndefined();
  });
  it('does nothing for the current folder', () => {
    expect(
      clusterFolderAssignment(source, { type: 'folder-drop', groupId: 'source' }),
    ).toBeUndefined();
  });
  it('adds to a deliberate target without encoding destructive source removal', () => {
    expect(clusterFolderAssignment(source, { type: 'folder-drop', groupId: 'target' })).toEqual({
      groupId: 'target',
      connectionId: 'cluster',
    });
  });
});
