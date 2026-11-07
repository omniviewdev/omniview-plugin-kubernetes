import { useNotifications } from '@omniviewdev/runtime';
import { useEffect, useRef, useState } from 'react';
import { migrateColumnPreferences, migrateSidebarOrder } from '../utils/legacyMigration';

const reportedIssuesKey = 'kubernetes-legacy-preference-reported';

function unreportedIssues(issues: string[]): string[] {
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(reportedIssuesKey) ?? '[]');
    const reported = new Set(Array.isArray(saved) ? saved.filter((item): item is string => typeof item === 'string') : []);
    const fresh = issues.filter(issue => !reported.has(issue));
    if (fresh.length) {
      fresh.forEach(issue => reported.add(issue));
      window.localStorage.setItem(reportedIssuesKey, JSON.stringify([...reported]));
    }
    return fresh;
  } catch {
    return issues;
  }
}

export function useLegacyColumnMigration(connectionIDs: readonly string[] | undefined): boolean {
  const { notify } = useNotifications();
  const connectionKey = connectionIDs === undefined ? undefined : JSON.stringify([...new Set(connectionIDs)].sort());
  const migrate = () => {
    if (connectionIDs === undefined) {
      return [];
    }

    try {
      const issues = [
        ...migrateColumnPreferences(window.localStorage, connectionIDs),
        ...migrateSidebarOrder(window.localStorage),
      ];
      const bootstrap = (window as Window & { __OMNIVIEW_BOOTSTRAP__?: { storageKey(key: string): string | null } }).__OMNIVIEW_BOOTSTRAP__;
      const prefix = bootstrap?.storageKey('');
      if (prefix) {
        issues.push(...migrateColumnPreferences(window.localStorage, connectionIDs, prefix));
        issues.push(...migrateSidebarOrder(window.localStorage, prefix));
      }

      return issues;
    }
    catch (error) {
      console.warn('Kubernetes preference migration failed', error);
      return ['Browser storage was unavailable'];
    }
  };
  const [migration, setMigration] = useState(() => ({ key: connectionKey, issues: migrate() }));
  // Children read saved preferences in their state initializers, before effects run.
  if (migration.key !== connectionKey) {
    setMigration({ key: connectionKey, issues: migrate() });
  }

  const reported = useRef<typeof migration | null>(null);
  useEffect(() => {
    if (reported.current === migration) {
      return;
    }

    reported.current = migration;
    const fresh = unreportedIssues(migration.issues);
    if (!fresh.length) {
      return;
    }

    const details = fresh.join('\n');
    console.warn('Kubernetes legacy preferences could not be migrated:', details);
    void notify({ title: 'Some Kubernetes preferences could not be migrated', severity: 'warning', details });
  }, [migration, notify]);

  return connectionKey !== undefined && migration.key === connectionKey;
}
