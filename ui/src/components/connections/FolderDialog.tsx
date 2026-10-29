import { Button, Dialog, FormField, IconButton, Input, Stack, Text } from '@omniviewdev/base-ui';
import React, { useState, useRef, useMemo, useCallback } from 'react';
import { LuUpload, LuX, LuImage, LuChevronDown, LuChevronRight } from 'react-icons/lu';

import type { EnrichedConnection, FolderRuleSet } from '../../types/clusters';
import { processImageFile } from '../../utils/avatarUtils';
import { FOLDER_ICON_MAP, PRESET_COLORS } from '../../utils/folderIcons';
import { compileRuleSet, matchConnections } from '../../utils/folderRules';

import styles from './FolderDialog.module.css';
import RuleBuilder from './RuleBuilder';

export interface FolderDialogValues {
  name: string;
  color: string;
  icon: string;
  customImage?: string;
  ruleSet?: FolderRuleSet;
}

type Props = {
  open: boolean;
  mode: 'create' | 'edit';
  initial?: Partial<FolderDialogValues>;
  existingNames?: string[];
  enrichedConnections?: EnrichedConnection[];
  onSubmit: (values: FolderDialogValues) => void;
  onDelete?: () => void;
  onClose: () => void;
};

type IconTab = 'icons' | 'custom';

const iconKeys = Object.keys(FOLDER_ICON_MAP);

// ── Static styles ────────────────────────────────────────────────────────────

const formStyle: React.CSSProperties = { display: 'contents' };
const iconGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(9, 1fr)',
  gap: 4,
};
const iconBtnSquareStyle: React.CSSProperties = { aspectRatio: 1, width: '100%' };
const dropPreviewImgStyle: React.CSSProperties = {
  width: 48,
  height: 48,
  objectFit: 'contain',
  borderRadius: 4,
};
const dropHintPrimaryStyle: React.CSSProperties = { opacity: 0.6 };
const dropHintSecondaryStyle: React.CSSProperties = { opacity: 0.4 };
const deleteBtnStyle: React.CSSProperties = { marginRight: 'auto' };
const imageIconStyle: React.CSSProperties = { opacity: 0.4 };
const hiddenInputStyle: React.CSSProperties = { display: 'none' };
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

const PresetIconButton: React.FC<{
  iconKey: string;
  selected: boolean;
  onIconSelect: (key: string) => void;
}> = ({ iconKey, selected, onIconSelect }) => {
  const handleClick = () => onIconSelect(iconKey);
  // Render icon via createElement to avoid "component created during render" error.
  const icon = React.createElement(FOLDER_ICON_MAP[iconKey] ?? FOLDER_ICON_MAP.LuFolder, {
    size: 16,
  });
  return (
    <IconButton
      size="sm"
      variant={selected ? 'soft' : 'ghost'}
      color={selected ? 'brand' : 'neutral'}
      onClick={handleClick}
      aria-label={iconKey}
      aria-pressed={selected}
      style={iconBtnSquareStyle}
    >
      {icon}
    </IconButton>
  );
};

// ── Main component ───────────────────────────────────────────────────────────

const EMPTY_RULE_SET: FolderRuleSet = { logic: 'and', rules: [] };

const FolderDialog: React.FC<Props> = ({
  open,
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
  const [iconTab, setIconTab] = useState<IconTab>(initial?.customImage ? 'custom' : 'icons');
  const [dragOver, setDragOver] = useState(false);
  const [imageError, setImageError] = useState('');
  const [ruleSet, setRuleSet] = useState<FolderRuleSet>(initial?.ruleSet ?? EMPTY_RULE_SET);
  const [rulesExpanded, setRulesExpanded] = useState((initial?.ruleSet?.rules.length ?? 0) > 0);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        for (const key of Object.keys(conn.connection.data)) dataKeys.add(key);
      }
    }
    for (const key of [...labelKeys].sort()) {
      fields.push({ value: `label:${key}`, label: `Label: ${key}` });
    }
    for (const key of [...dataKeys].sort()) {
      fields.push({ value: `data:${key}`, label: `Data: ${key}` });
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
    try {
      const dataUrl = await processImageFile(file, 64, 0.85, 100_000);
      setCustomImage(dataUrl);
    } catch (err) {
      setImageError(err instanceof Error ? err.message : 'Failed to process image');
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleImageFile(file);
    e.target.value = '';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith('image/')) void handleImageFile(file);
  };

  const handleReplaceClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    fileInputRef.current?.click();
  };

  const handleRemoveImage = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCustomImage(undefined);
  };

  const handleDropZoneClick = () => {
    if (!customImage) fileInputRef.current?.click();
  };

  const handleColorInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setColor(e.target.value);
  };

  const handleSetIconsTab = () => setIconTab('icons');
  const handleSetCustomTab = () => setIconTab('custom');

  // ── Derived state ────────────────────────────────────────────────────────

  const trimmed = name.trim();
  const isDuplicate =
    trimmed.length > 0 &&
    existingNames.some((n) => n.toLowerCase() === trimmed.toLowerCase()) &&
    trimmed.toLowerCase() !== (initial?.name ?? '').toLowerCase();
  const canSubmit = trimmed.length > 0 && !isDuplicate;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      name: trimmed,
      color,
      icon,
      customImage: iconTab === 'custom' ? customImage : undefined,
      ruleSet: ruleSet.rules.length > 0 ? ruleSet : undefined,
    });
  };

  // ── Memoized dynamic styles ──────────────────────────────────────────────

  const isCustomColor = !PRESET_COLORS.includes(color);

  const colorPickerLabelStyle = useMemo<React.CSSProperties>(
    () => ({
      backgroundColor: isCustomColor ? color : '#888',
      outline: isCustomColor ? `2px solid ${color}` : '2px solid transparent',
    }),
    [color, isCustomColor],
  );

  const dropZoneClassName = [
    styles.dropZone,
    customImage ? styles.dropZoneFilled : styles.dropZoneEmpty,
    dragOver ? styles.dropZoneActive : '',
  ]
    .filter(Boolean)
    .join(' ');

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

            {/* Icon section with tabs */}
            <Stack direction="column" style={{ gap: 6 }}>
              <Stack direction="row" align="center" spacing={2}>
                <Text weight="semibold" size="sm" tone="default">
                  Icon
                </Text>
                <Stack direction="row" style={{ gap: 2 }}>
                  <Button
                    size="xs"
                    variant={iconTab === 'icons' ? 'soft' : 'ghost'}
                    color={iconTab === 'icons' ? 'brand' : 'neutral'}
                    onClick={handleSetIconsTab}
                  >
                    Presets
                  </Button>
                  <Button
                    size="xs"
                    variant={iconTab === 'custom' ? 'soft' : 'ghost'}
                    color={iconTab === 'custom' ? 'brand' : 'neutral'}
                    onClick={handleSetCustomTab}
                  >
                    Custom Image
                  </Button>
                </Stack>
              </Stack>

              {iconTab === 'icons' ? (
                <div style={iconGridStyle}>
                  {iconKeys.map((key) => (
                    <PresetIconButton
                      key={key}
                      iconKey={key}
                      selected={icon === key}
                      onIconSelect={setIcon}
                    />
                  ))}
                </div>
              ) : (
                <Stack direction="column" align="stretch" spacing={2}>
                  {/* Drag-and-drop zone */}
                  {/* eslint-disable-next-line jsx-a11y-x/click-events-have-key-events, jsx-a11y-x/no-static-element-interactions */}
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={handleDropZoneClick}
                    className={dropZoneClassName}
                  >
                    {customImage ? (
                      <Stack
                        direction="column"
                        align="center"
                        style={{ gap: 6, padding: '8px 0' }}
                      >
                        <img
                          src={customImage}
                          alt="Custom icon preview"
                          style={dropPreviewImgStyle}
                        />
                        <Stack direction="row" spacing={1}>
                          <Button
                            size="xs"
                            variant="soft"
                            color="neutral"
                            startDecorator={<LuUpload size={12} />}
                            onClick={handleReplaceClick}
                          >
                            Replace
                          </Button>
                          <IconButton
                            size="xs"
                            variant="soft"
                            color="danger"
                            onClick={handleRemoveImage}
                            aria-label="Remove image"
                          >
                            <LuX size={12} />
                          </IconButton>
                        </Stack>
                      </Stack>
                    ) : (
                      <Stack
                        direction="column"
                        align="center"
                        spacing={1}
                        style={{ padding: '12px 0' }}
                      >
                        <LuImage size={24} style={imageIconStyle} />
                        <Text size="xs" style={dropHintPrimaryStyle}>
                          Drag &amp; drop an image here
                        </Text>
                        <Text size="xs" style={dropHintSecondaryStyle}>
                          or click to browse (PNG, JPG, SVG)
                        </Text>
                      </Stack>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".png,.jpg,.jpeg,.svg,image/*"
                    onChange={handleFileChange}
                    style={hiddenInputStyle}
                  />
                  {imageError && (
                    <Text size="xs" tone="danger">
                      {imageError}
                    </Text>
                  )}
                </Stack>
              )}
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
