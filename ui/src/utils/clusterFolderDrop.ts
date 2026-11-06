export interface ClusterFolderAssignment {
  groupId: string;
  connectionId: string;
}

/** A cancelled, outside, or same-folder drop never mutates membership. */
export function clusterFolderAssignment(
  source?: Record<string, unknown>,
  target?: Record<string, unknown>,
): ClusterFolderAssignment | undefined {
  if (source?.type !== 'connection' || target?.type !== 'folder-drop') return;
  if (typeof source.connectionId !== 'string' || typeof target.groupId !== 'string') return;
  if (source.sourceGroupId === target.groupId) return;
  return { groupId: target.groupId, connectionId: source.connectionId };
}
