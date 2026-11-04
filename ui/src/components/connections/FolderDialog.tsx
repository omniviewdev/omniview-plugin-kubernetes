import { Button, Dialog, FormField, IconPicker, Input, Stack, Text } from '@omniviewdev/base-ui';
import React, { useState, useMemo, useCallback } from 'react';
import { LuChevronDown, LuChevronRight } from 'react-icons/lu';

import type { EnrichedConnection, FolderRuleSet } from '../../types/clusters';
import { decodeClusterIcon } from '../../utils/clusterIconAssets';
import { useClusterPreferences } from '../../hooks/useClusterPreferences';
import { FOLDER_ICON_MAP, PRESET_COLORS } from '../../utils/folderIcons';
import { compileRuleSet, matchConnections } from '../../utils/folderRules';
import {
  isRetiredConnectionDataKey,
  isRetiredInventoryDataKey,
} from '../../utils/migrateFolderMetadataRules';

import styles from './FolderDialog.module.css';
import RuleBuilder from './RuleBuilder';

export interface FolderDialogValues {
  name: string;
  color: string;
  icon: string;
  customImage?: string;
  iconAssetId?: string;
  ruleSet?: FolderRuleSet;
}

type Props = {
  open: boolean;
  pluginID?: string;
  mode: 'create' | 'edit';
  initial?: Partial<FolderDialogValues>;
  existingNames?: string[];
  enrichedConnections?: EnrichedConnection[];
  onSubmit: (values: FolderDialogValues) => void;
  onDelete?: () => void;
  onClose: () => void;
};

const iconKeys = Object.keys(FOLDER_ICON_MAP);

// ── Static styles ────────────────────────────────────────────────────────────

const formStyle: React.CSSProperties = { display: 'contents' };
const deleteBtnStyle: React.CSSProperties = { marginRight: 'auto' };
const rulesToggleStyle: React.CSSProperties = {
  cursor: 'pointer',
  userSelect: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  background: 'none',
  border: 'none',
  padding: 0,
  color: 'inherit',
  font: 'inherit',
  textAlign: 'left',
};

// ── Sub-components ───────────────────────────────────────────────────────────

const ColorSwatch: React.FC<{
  swatchColor: string;
  selected: boolean;
  onColorSelect: (color: string) => void;
}> = ({ swatchColor, selected, onColorSelect }) => {
  const handleClick = () => onColorSelect(swatchColor);
  const style = useMemo<React.CSSProperties>(
    () => ({
      backgroundColor: swatchColor,
      outline: selected ? `2px solid ${swatchColor}` : '2px solid transparent',
    }),
    [swatchColor, selected],
  );
  return (
    <button
      type="button"
      aria-label={`Color ${swatchColor}`}
      aria-pressed={selected}
      className={styles.swatch}
      onClick={handleClick}
      style={style}
    />
  );
};

// ── Main component ───────────────────────────────────────────────────────────

const EMPTY_RULE_SET: FolderRuleSet = { logic: 'and', rules: [] };

const FolderDialog: React.FC<Props> = ({
  open,
  pluginID = 'kubernetes',
  mode,
  initial,
  existingNames = [],
  enrichedConnections = [],
  onSubmit,
  onDelete,
  onClose,
}) => {
  // Component is conditionally rendered in parent (unmounts when closed),
  // so useState initializers are sufficient — no useEffect needed for reset.
  const [name, setName] = useState(initial?.name ?? '');
  const [color, setColor] = useState(initial?.color ?? PRESET_COLORS[0]);
  const [icon, setIcon] = useState(initial?.icon ?? 'LuFolder');
  const [customImage, setCustomImage] = useState<string | undefined>(initial?.customImage);
  const [iconAssetId, setIconAssetId] = useState(initial?.iconAssetId);
  const [imageError, setImageError] = useState('');
  const [uploadPending, setUploadPending] = useState(false);
  const [removePending, setRemovePending] = useState(false);
  const [removeError, setRemoveError] = useState('');
  const [assetName, setAssetName] = useState('');
  const preferences = useClusterPreferences(pluginID);
  const { iconAssets } = preferences;
  const [ruleSet, setRuleSet] = useState<FolderRuleSet>(initial?.ruleSet ?? EMPTY_RULE_SET);
  const [rulesExpanded, setRulesExpanded] = useState((initial?.ruleSet?.rules.length ?? 0) > 0);

  // ── Rules helpers ───────────────────────────────────────────────────────

  const availableFields = useMemo(() => {
    const fields: { value: string; label: string }[] = [
      { value: 'name', label: 'Name' },
      { value: 'id', label: 'ID' },
      { value: 'provider', label: 'Provider' },
      { value: 'isConnected', label: 'Connected' },
      { value: 'tag', label: 'Tag' },
    ];
    const labelKeys = new Set<string>();
    const dataKeys = new Set<string>();
    for (const conn of enrichedConnections) {
      if (conn.connection.labels) {
        for (const key of Object.keys(conn.connection.labels)) labelKeys.add(key);
      }
      if (conn.connection.data) {
        for (const key of Object.keys(conn.connection.data)) {
          if (!isRetiredConnectionDataKey(key)) dataKeys.add(key);
        }
      }
    }
    for (const key of [...labelKeys].sort()) {
      fields.push({ value: `label:${key}`, label: `Label: ${key}` });
    }
    for (const key of [...dataKeys].sort()) {
      fields.push({ value: `data:${key}`, label: `Data: ${key}` });
    }
    for (const key of [
      'kubernetes.server_url',
      'kubernetes.server_version',
      'kubernetes.server_platform',
    ]) {
      fields.push({ value: `metadata:${key}`, label: `Metadata: ${key}` });
    }
    return fields;
  }, [enrichedConnections]);

  const matchCount = useMemo(() => {
    if (ruleSet.rules.length === 0) return 0;
    const compiled = compileRuleSet(ruleSet);
    return matchConnections(compiled, enrichedConnections).size;
  }, [ruleSet, enrichedConnections]);

  const handleRuleSetChange = useCallback((rs: FolderRuleSet) => {
    setRuleSet(rs);
  }, []);

  const toggleRulesExpanded = useCallback(() => {
    setRulesExpanded((prev) => !prev);
  }, []);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleImageFile = async (file: File) => {
    setImageError('');
    setUploadPending(true);
    try {
      const dataUrl = await decodeClusterIcon(file);
      const asset = await preferences.addIconAsset({
        id: crypto.randomUUID(),
        name: assetName.trim() || file.name.replace(/\.[^.]+$/, ''),
        dataUrl,
        createdAt: Date.now(),
      });
      setIconAssetId(asset.id);
      setCustomImage(asset.dataUrl);
    } catch (err) {
      setImageError(err instanceof Error ? err.message : 'Failed to process image');
    } finally {
      setUploadPending(false);
    }
  };
  const handleRemoveAsset = async (id: string) => {
    setRemovePending(true);
    setRemoveError('');
    try {
      await preferences.removeIconAsset(id);
      if (iconAssetId === id) {
        const removedAsset = iconAssets.find((asset) => asset.id === id);
        if (removedAsset) setCustomImage(removedAsset.dataUrl);
        setIconAssetId(undefined);
      }
    } catch (error) {
      setRemoveError(error instanceof Error ? error.message : 'Failed to remove icon');
    } finally {
      setRemovePending(false);
    }
  };

  const handleColorInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setColor(e.target.value);
  };

  // ── Derived state ────────────────────────────────────────────────────────

  const trimmed = name.trim();
  const isDuplicate =
    trimmed.length > 0 &&
    existingNames.some((n) => n.toLowerCase() === trimmed.toLowerCase()) &&
    trimmed.toLowerCase() !== (initial?.name ?? '').toLowerCase();
  const canSubmit = trimmed.length > 0 && !isDuplicate && !uploadPending && !removePending;
  const selectedAssetId = iconAssets.some((asset) => asset.id === iconAssetId)
    ? iconAssetId
    : undefined;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      name: trimmed,
      color,
      icon,
      customImage,
      iconAssetId: selectedAssetId,
      ruleSet: ruleSet.rules.length > 0 ? ruleSet : undefined,
    });
  };

  // ── Memoized dynamic styles ──────────────────────────────────────────────

  const isCustomColor = !PRESET_COLORS.includes(color);

  const colorPickerLabelStyle = useMemo<React.CSSProperties>(
    () => ({
      backgroundColor: isCustomColor ? color : 'var(--ov-color-bg-surface)',
      outline: isCustomColor ? `2px solid ${color}` : '2px solid transparent',
    }),
    [color, isCustomColor],
  );

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onClose={onClose} size="md">
      <form onSubmit={handleSubmit} style={formStyle}>
        <Dialog.Title>{mode === 'create' ? 'New Folder' : 'Edit Folder'}</Dialog.Title>
        <Dialog.Body>
          <Stack direction="column" style={{ gap: 12, minWidth: 360 }}>
            <FormField
              label="Name"
              htmlFor="folder-dialog-name"
              error={isDuplicate ? 'A folder with this name already exists' : undefined}
            >
              <Input.Control
                id="folder-dialog-name"
                // eslint-disable-next-line jsx-a11y-x/no-autofocus
                autoFocus
                size="sm"
                placeholder="e.g. Production Suite"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </FormField>

            {/* Color section */}
            <Stack direction="column" style={{ gap: 6 }}>
              <Text weight="semibold" size="sm" tone="default">
                Color
              </Text>
              <Stack direction="row" wrap align="center" style={{ gap: 6 }}>
                {PRESET_COLORS.map((c) => (
                  <ColorSwatch
                    key={c}
                    swatchColor={c}
                    selected={color === c}
                    onColorSelect={setColor}
                  />
                ))}
                {/* Custom hex color picker */}
                <label className={styles.colorPicker} style={colorPickerLabelStyle}>
                  <span className={styles.colorPickerHash}>#</span>
                  <input
                    type="color"
                    aria-label="Custom color"
                    value={color}
                    onChange={handleColorInputChange}
                    className={styles.colorPickerInput}
                  />
                </label>
              </Stack>
            </Stack>

            <Stack direction="column" style={{ gap: 6 }}>
              <FormField label="Custom icon name" htmlFor="folder-icon-name">
                <Input.Control
                  id="folder-icon-name"
                  size="sm"
                  value={assetName}
                  placeholder="Defaults to uploaded filename"
                  onChange={(event) => setAssetName(event.target.value)}
                />
              </FormField>
              <IconPicker
                accept={['image/png', 'image/jpeg', 'image/webp']}
                label="Folder icon"
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = uploadPending || removePending ? 'none' : 'copy';
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (uploadPending || removePending) return;
                  const file = event.dataTransfer.files[0];
                  if (file) void handleImageFile(file);
                }}
                value={selectedAssetId ?? (customImage ? 'legacy-image' : icon)}
                items={[
                  ...iconKeys.map((key) => ({
                    id: key,
                    label: key.replace(/^Lu/, ''),
                    kind: 'preset' as const,
                    icon: React.createElement(FOLDER_ICON_MAP[key], { size: 16 }),
                  })),
                  ...iconAssets.map((asset) => ({
                    id: asset.id,
                    label: asset.name,
                    kind: 'image' as const,
                    src: asset.dataUrl,
                    removable: true,
                  })),
                  ...(customImage && !selectedAssetId
                    ? [
                        {
                          id: 'legacy-image',
                          label: 'Current custom image',
                          kind: 'image' as const,
                          src: customImage,
                        },
                      ]
                    : []),
                ]}
                onValueChange={(id) => {
                  const asset = iconAssets.find((entry) => entry.id === id);
                  setIconAssetId(asset?.id);
                  if (asset) setCustomImage(asset.dataUrl);
                  else if (id !== 'legacy-image') {
                    setCustomImage(undefined);
                    setIcon(id ?? 'LuFolder');
                  }
                }}
                onUpload={(file) => {
                  void handleImageFile(file);
                }}
                uploadPending={uploadPending}
                uploadError={imageError}
                onRemove={(id) => {
                  void handleRemoveAsset(id);
                }}
                removePending={removePending}
                removeError={removeError}
              />
              <Text size="xs" tone="muted">
                Removing a library icon keeps its image on folders already using it.
              </Text>
            </Stack>

            {/* Auto-match Rules (collapsible) */}
            <Stack direction="column" style={{ gap: 6 }}>
              <button
                type="button"
                onClick={toggleRulesExpanded}
                aria-expanded={rulesExpanded}
                style={rulesToggleStyle}
              >
                {rulesExpanded ? <LuChevronDown size={14} /> : <LuChevronRight size={14} />}
                <Text weight="semibold" size="sm" tone="default">
                  Auto-match Rules
                </Text>
                {ruleSet.rules.length > 0 && (
                  <Text size="xs" style={{ opacity: 0.5 }}>
                    ({ruleSet.rules.length})
                  </Text>
                )}
              </button>
              {ruleSet.rules.some(
                (rule) =>
                  rule.field.startsWith('data:') && isRetiredInventoryDataKey(rule.field.slice(5)),
              ) && (
                <Text size="sm" role="alert">
                  Review required: saved inventory and last-checked rules are unsupported. These
                  rules never match, including negative rules. Edit or remove them explicitly.
                </Text>
              )}
              {rulesExpanded && (
                <RuleBuilder
                  ruleSet={ruleSet}
                  onChange={handleRuleSetChange}
                  matchCount={matchCount}
                  availableFields={availableFields}
                />
              )}
            </Stack>
          </Stack>
        </Dialog.Body>
        <Dialog.Footer>
          {mode === 'edit' && onDelete && (
            <Button variant="ghost" color="danger" onClick={onDelete} style={deleteBtnStyle}>
              Delete
            </Button>
          )}
          <Button variant="ghost" color="neutral" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="solid" color="brand" disabled={!canSubmit}>
            {mode === 'create' ? 'Create' : 'Save'}
          </Button>
        </Dialog.Footer>
      </form>
    </Dialog>
  );
};

export default FolderDialog;
