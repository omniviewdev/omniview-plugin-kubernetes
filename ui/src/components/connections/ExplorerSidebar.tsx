import {
  Button,
  Dialog,
  FormField,
  IconButton,
  Input,
  Menu,
  Stack,
  Text,
} from '@omniviewdev/base-ui';
import React from 'react';
import { LuArrowDown, LuArrowUp, LuEllipsisVertical, LuFolderPlus, LuPlus } from 'react-icons/lu';
import type { ClusterPreferencesState } from '../../hooks/useClusterPreferences';
import type { ClusterLens, ClusterScope } from '../../types/clusterExplorer';
import type { ConnectionAttribute, EnrichedConnection } from '../../types/clusters';
import { computeEffectiveMembers } from '../../utils/folderRules';
import { FolderIconDisplay } from '../../utils/folderIcons';
import { ClusterFolderDropTarget } from './ClusterOrganization';
import styles from './ExplorerSidebar.module.css';

type Props = {
  scope: ClusterScope;
  onScopeChange: (scope: ClusterScope) => void;
  connections: EnrichedConnection[];
  preferences: ClusterPreferencesState;
  onCreateFolder: () => void;
  onEditFolder: (id: string) => void;
  onOrganize: () => void;
  organizing: boolean;
  currentLens: Omit<ClusterLens, 'id' | 'name'>;
  onApplyLens: (lens: ClusterLens) => void;
  attributes: ConnectionAttribute[];
  onBrowse: (key: string, value: string) => void;
};

export default function ExplorerSidebar(props: Props) {
  const { preferences, connections } = props;
  const [lensDialog, setLensDialog] = React.useState<{ id?: string; name: string }>();
  const lensNameRef = React.useRef<HTMLInputElement>(null);
  const lensDialogOpen = !!lensDialog;
  React.useEffect(() => {
    if (lensDialogOpen) lensNameRef.current?.focus();
  }, [lensDialogOpen]);
  const [error, setError] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const run = async (operation: () => Promise<unknown>) => {
    setError('');
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save organization');
    }
  };
  const counts = {
    all: connections.length,
    recent: connections.filter((entry) => !!entry.lastAccessed).length,
    favorites: connections.filter((entry) => entry.isFavorite).length,
    connected: connections.filter((entry) => entry.isConnected).length,
  };
  const folders = [...preferences.customGroups].sort((left, right) => {
    const index = (id: string) => {
      const position = preferences.hubSections.findIndex(
        (section) => section.type === `group:${id}`,
      );
      return position < 0 ? Number.MAX_SAFE_INTEGER : position;
    };
    return index(left.id) - index(right.id);
  });
  const moveLens = (id: string, delta: number) => {
    const ids = preferences.savedLenses.map((lens) => lens.id);
    const from = ids.indexOf(id);
    const to = from + delta;
    if (to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    void run(() => preferences.reorderLenses(ids));
  };
  const moveFolder = (id: string, delta: number) => {
    void run(() => preferences.setHubSections((current) => {
      const sections = [...current];
      for (const folder of preferences.customGroups) {
        if (sections.some((section) => section.type === `group:${folder.id}`)) continue;
        const browse = sections.findIndex((section) => section.type === 'browse');
        sections.splice(browse < 0 ? sections.length : browse, 0, {
          type: `group:${folder.id}`,
          collapsed: false,
        });
      }
      const folderIDs = new Set(preferences.customGroups.map((folder) => `group:${folder.id}`));
      const positions = sections.flatMap((section, index) => folderIDs.has(section.type) ? [index] : []);
      const from = positions.findIndex((position) => sections[position].type === `group:${id}`);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= positions.length) return current;
      const left = positions[from];
      const right = positions[to];
      [sections[left], sections[right]] = [sections[right], sections[left]];
      return sections;
    }));
  };
  return (
    <aside className={styles.sidebar} aria-label="Cluster explorer navigation">
      <Text weight="semibold" size="sm">
        Workspace
      </Text>
      <nav className={styles.navigation} aria-label="Cluster scopes">
        {(
          [
            ['all', 'All clusters'],
            ['recent', 'Recent'],
            ['favorites', 'Pinned'],
            ['connected', 'Connected'],
          ] as const
        ).map(([scope, label]) => (
          <Button
            key={scope}
            size="sm"
            variant={props.scope === scope && !props.organizing ? 'soft' : 'ghost'}
            color="neutral"
            aria-current={props.scope === scope && !props.organizing ? 'page' : undefined}
            onClick={() => props.onScopeChange(scope)}
            className={styles.scope}
          >
            <span>{label}</span>
            <span>{counts[scope]}</span>
          </Button>
        ))}
      </nav>
      <Stack direction="row" align="center" justify="between">
        <Text size="xs" tone="muted">
          FOLDERS
        </Text>
        <IconButton
          size="xs"
          variant="ghost"
          aria-label="Create folder"
          onClick={props.onCreateFolder}
        >
          <LuFolderPlus />
        </IconButton>
      </Stack>
      {folders.map((folder, index) => {
        const asset = preferences.iconAssets.find((item) => item.id === folder.iconAssetId);
        return (
          <ClusterFolderDropTarget key={folder.id} groupId={folder.id}>
            <div className={styles.item}>
              <Button
                size="sm"
                variant={
                  props.scope === `group:${folder.id}` && !props.organizing ? 'soft' : 'ghost'
                }
                color="neutral"
                aria-current={
                  props.scope === `group:${folder.id}` && !props.organizing ? 'page' : undefined
                }
                title={folder.name}
                onClick={() => props.onScopeChange(`group:${folder.id}`)}
                className={styles.folder}
              >
                <FolderIconDisplay
                  icon={folder.icon}
                  customImage={asset?.dataUrl ?? folder.customImage}
                  color={folder.color}
                  size={16}
                />
                <span className={styles.name}>{folder.name}</span>
                <span>
                  {computeEffectiveMembers(folder.connectionIds, folder.ruleSet, connections).size}
                </span>
              </Button>
              <ItemMenu label={`Actions for folder ${folder.name}`}>
                <Menu.Item onClick={() => props.onEditFolder(folder.id)}>Edit folder</Menu.Item>
                <Menu.Item disabled={index === 0} onClick={() => moveFolder(folder.id, -1)}>
                  Move up
                </Menu.Item>
                <Menu.Item
                  disabled={index === folders.length - 1}
                  onClick={() => moveFolder(folder.id, 1)}
                >
                  Move down
                </Menu.Item>
              </ItemMenu>
            </div>
          </ClusterFolderDropTarget>
        );
      })}
      <Stack direction="row" align="center" justify="between">
        <Text size="xs" tone="muted">
          SAVED LENSES
        </Text>
        <IconButton
          size="xs"
          variant="ghost"
          aria-label="Save current lens"
          onClick={() => setLensDialog({ name: '' })}
        >
          <LuPlus />
        </IconButton>
      </Stack>
      {preferences.savedLenses.map((lens, index) => (
        <div key={lens.id} className={styles.item}>
          <Button
            size="sm"
            variant="ghost"
            color="neutral"
            onClick={() => props.onApplyLens(lens)}
            className={styles.folder}
            title={lens.name}
          >
            <span className={styles.name}>{lens.name}</span>
          </Button>
          <ItemMenu label={`Actions for lens ${lens.name}`}>
            <Menu.Item onClick={() => setLensDialog({ id: lens.id, name: lens.name })}>
              Rename lens
            </Menu.Item>
            <Menu.Item
              onClick={() => {
                void run(() =>
                  preferences.saveLens({ ...props.currentLens, id: lens.id, name: lens.name }),
                );
              }}
            >
              Replace with current view
            </Menu.Item>
            <Menu.Item
              disabled={index === 0}
              onClick={() => moveLens(lens.id, -1)}
              startDecorator={<LuArrowUp />}
            >
              Move up
            </Menu.Item>
            <Menu.Item
              disabled={index === preferences.savedLenses.length - 1}
              onClick={() => moveLens(lens.id, 1)}
              startDecorator={<LuArrowDown />}
            >
              Move down
            </Menu.Item>
            <Menu.Item
              color="danger"
              onClick={() => {
                void run(() => preferences.removeLens(lens.id));
              }}
            >
              Delete lens
            </Menu.Item>
          </ItemMenu>
        </div>
      ))}
      <details>
        <summary className={styles.browse}>Browse attributes</summary>
        {props.attributes.map((attribute) => (
          <details key={attribute.key}>
            <summary className={styles.browse}>{attribute.displayName}</summary>
            {attribute.distinctValues.map((value) => (
              <Button
                key={value}
                size="xs"
                variant="ghost"
                color="neutral"
                className={styles.attribute}
                title={value}
                onClick={() => props.onBrowse(attribute.key, value)}
              >
                {value}
              </Button>
            ))}
          </details>
        ))}
      </details>
      <Button
        size="sm"
        variant={props.organizing ? 'soft' : 'ghost'}
        color="neutral"
        onClick={props.onOrganize}
        aria-pressed={props.organizing}
      >
        Organize
      </Button>
      {error && (
        <Text size="xs" role="alert">
          {error}
        </Text>
      )}
      {lensDialog && (
        <Dialog
          open
          onClose={() => {
            if (!pending) setLensDialog(undefined);
          }}
          size="sm"
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!lensDialog.name.trim() || pending) return;
              setPending(true);
              const existing = preferences.savedLenses.find((lens) => lens.id === lensDialog.id);
              void preferences
                .saveLens({
                  ...(existing ?? props.currentLens),
                  id: lensDialog.id ?? crypto.randomUUID(),
                  name: lensDialog.name.trim(),
                })
                .then(
                  () => setLensDialog(undefined),
                  (cause: unknown) =>
                    setError(cause instanceof Error ? cause.message : 'Could not save lens'),
                )
                .finally(() => setPending(false));
            }}
          >
            <Dialog.Title>{lensDialog.id ? 'Rename lens' : 'Save current lens'}</Dialog.Title>
            <Dialog.Body>
              <FormField label="Lens name" htmlFor="cluster-lens-name">
                <Input.Control
                  id="cluster-lens-name"
                  value={lensDialog.name}
                  ref={lensNameRef}
                  onChange={(event) => setLensDialog({ ...lensDialog, name: event.target.value })}
                />
              </FormField>
              {error && <Text role="alert">{error}</Text>}
            </Dialog.Body>
            <Dialog.Footer>
              <Button
                variant="ghost"
                type="button"
                disabled={pending}
                onClick={() => setLensDialog(undefined)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !lensDialog.name.trim()}>
                Save
              </Button>
            </Dialog.Footer>
          </form>
        </Dialog>
      )}
    </aside>
  );
}

function ItemMenu({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Menu.Root size="xs">
      <Menu.Trigger
        render={
          <IconButton size="xs" variant="ghost" aria-label={label}>
            <LuEllipsisVertical />
          </IconButton>
        }
      />
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end">
          <Menu.Popup>{children}</Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
