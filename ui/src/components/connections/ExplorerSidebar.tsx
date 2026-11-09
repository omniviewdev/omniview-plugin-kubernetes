import {
  Button,
  ButtonGroup,
  Dialog,
  FormField,
  IconButton,
  Input,
  Menu,
  Overline,
  Stack,
  Text,
} from '@omniviewdev/base-ui';
import React from 'react';
import {
  LuArrowDown,
  LuArrowUp,
  LuArrowUpRight,
  LuEllipsisVertical,
  LuFolderPlus,
} from 'react-icons/lu';

import type { ClusterPreferencesState } from '../../hooks/useClusterPreferences';
import type { ClusterLens, ClusterScope } from '../../types/clusterExplorer';
import type { ConnectionAttribute, EnrichedConnection } from '../../types/clusters';
import { FolderIconDisplay, resolveFolderImage } from '../../utils/folderIcons';
import { computeEffectiveMembers } from '../../utils/folderRules';

import { ClusterFolderDropTarget } from './ClusterOrganization';
import styles from './ExplorerSidebar.module.css';
import ProviderIcon from './ProviderIcon';

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

const SCOPES = [
  ['all', 'All clusters'],
  ['recent', 'Recent'],
  ['favorites', 'Pinned'],
  ['connected', 'Connected'],
] as const;

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
  const foldersLabelId = React.useId();
  const lensesLabelId = React.useId();
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
    void run(() =>
      preferences.setHubSections((current) => {
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
        const positions = sections.flatMap((section, index) =>
          folderIDs.has(section.type) ? [index] : [],
        );
        const from = positions.findIndex((position) => sections[position].type === `group:${id}`);
        const to = from + delta;
        if (from < 0 || to < 0 || to >= positions.length) return current;
        const left = positions[from];
        const right = positions[to];
        [sections[left], sections[right]] = [sections[right], sections[left]];
        return sections;
      }),
    );
  };
  return (
    <aside className={styles.sidebar} aria-label="Cluster explorer navigation">
      <div className={styles.brand}>
        <span className={styles.brandMark} aria-hidden="true">
          <ProviderIcon provider="generic" />
        </span>
        <Text weight="semibold" size="lg" truncate>
          Kubernetes
        </Text>
      </div>
      <div className={styles.section}>
        <Overline size="sm" className={styles.sectionLabel}>
          Workspace
        </Overline>
        <nav className={styles.navigation} aria-label="Cluster scopes">
          {SCOPES.map(([scope, label]) => (
            <SidebarRow
              key={scope}
              label={label}
              count={counts[scope]}
              current={props.scope === scope && !props.organizing}
              onClick={() => props.onScopeChange(scope)}
            />
          ))}
        </nav>
      </div>
      <div className={styles.section}>
        <Stack direction="row" align="center" justify="between" className={styles.sectionHeader}>
          <Overline size="sm" id={foldersLabelId}>
            Folders
          </Overline>
          <IconButton
            size="sm"
            variant="ghost"
            aria-label="Create folder"
            onClick={props.onCreateFolder}
          >
            <LuFolderPlus />
          </IconButton>
        </Stack>
        {folders.length > 0 && (
          <div className={styles.rows} role="group" aria-labelledby={foldersLabelId}>
            {folders.map((folder, index) => (
              <ClusterFolderDropTarget key={folder.id} groupId={folder.id}>
                <div className={styles.item}>
                  <SidebarRow
                    label={folder.name}
                    title={folder.name}
                    icon={
                      <span className={styles.folderIcon}>
                        <FolderIconDisplay
                          icon={folder.icon}
                          customImage={resolveFolderImage(folder, preferences.iconAssets)}
                          color={folder.color}
                          size={16}
                        />
                      </span>
                    }
                    count={
                      computeEffectiveMembers(folder.connectionIds, folder.ruleSet, connections)
                        .size
                    }
                    current={props.scope === `group:${folder.id}` && !props.organizing}
                    onClick={() => props.onScopeChange(`group:${folder.id}`)}
                  />
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
            ))}
          </div>
        )}
      </div>
      <div className={styles.section}>
        <Overline size="sm" id={lensesLabelId} className={styles.sectionLabel}>
          Saved lenses
        </Overline>
        {preferences.savedLenses.length > 0 && (
          <div className={styles.rows} role="group" aria-labelledby={lensesLabelId}>
            {preferences.savedLenses.map((lens, index) => (
              <div key={lens.id} className={styles.item}>
                <SidebarRow
                  label={lens.name}
                  title={lens.name}
                  trailing={<LuArrowUpRight aria-hidden="true" />}
                  onClick={() => props.onApplyLens(lens)}
                />
                <ItemMenu label={`Actions for lens ${lens.name}`}>
                  <Menu.Item onClick={() => setLensDialog({ id: lens.id, name: lens.name })}>
                    Rename lens
                  </Menu.Item>
                  <Menu.Item
                    onClick={() => {
                      void run(() =>
                        preferences.saveLens({
                          ...props.currentLens,
                          id: lens.id,
                          name: lens.name,
                        }),
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
          </div>
        )}
        <ButtonGroup attached={false} aria-label="Explorer actions" className={styles.actions}>
          <ButtonGroup.Button
            aria-label="Save current lens"
            onClick={() => setLensDialog({ name: '' })}
          >
            + Lens
          </ButtonGroup.Button>
          <ButtonGroup.Button
            color={props.organizing ? 'brand' : 'neutral'}
            aria-pressed={props.organizing}
            onClick={props.onOrganize}
          >
            Organize
          </ButtonGroup.Button>
        </ButtonGroup>
        {error && (
          <Text size="sm" tone="danger" role="alert" className={styles.error}>
            {error}
          </Text>
        )}
      </div>
      {props.attributes.length > 0 && (
        <Menu.Root>
          <Menu.Trigger render={<Button size="sm" variant="ghost" />}>
            Browse attributes
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner sideOffset={4}>
              <Menu.Popup>
                {props.attributes.map((attribute) => (
                  <Menu.SubmenuRoot key={attribute.key}>
                    <Menu.SubmenuTrigger showCaret>{attribute.displayName}</Menu.SubmenuTrigger>
                    <Menu.Portal>
                      <Menu.Positioner sideOffset={4}>
                        <Menu.Popup>
                          {attribute.distinctValues.map((value) => (
                            <Menu.Item
                              key={value}
                              onClick={() => props.onBrowse(attribute.key, value)}
                            >
                              {value}
                            </Menu.Item>
                          ))}
                        </Menu.Popup>
                      </Menu.Positioner>
                    </Menu.Portal>
                  </Menu.SubmenuRoot>
                ))}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
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

type SidebarRowProps = {
  label: string;
  title?: string;
  current?: boolean;
  count?: number;
  icon?: React.ReactNode;
  trailing?: React.ReactNode;
  onClick: () => void;
};

/** One full-width navigation row: leading icon, truncating label, then count or affordance. */
function SidebarRow({
  label,
  title,
  current = false,
  count,
  icon,
  trailing,
  onClick,
}: SidebarRowProps) {
  return (
    <Button
      size="md"
      variant={current ? 'soft' : 'ghost'}
      color={current ? 'brand' : 'neutral'}
      aria-current={current ? 'page' : undefined}
      title={title}
      onClick={onClick}
      className={styles.row}
      startDecorator={icon}
      endDecorator={trailing}
    >
      <Text truncate tone={current ? 'brand' : 'default'} className={styles.label}>
        {label}
      </Text>
      {count === undefined ? null : (
        <Text size="xs" tone="muted" className={styles.count}>
          {count}
        </Text>
      )}
    </Button>
  );
}

function ItemMenu({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Menu.Root size="xs">
      <Menu.Trigger
        render={
          <IconButton size="sm" variant="ghost" aria-label={label}>
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
