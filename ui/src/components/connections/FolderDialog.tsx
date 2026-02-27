import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import { Button, IconButton } from '@omniviewdev/ui/buttons';
import { TextField, FormField } from '@omniviewdev/ui/inputs';
import { Stack } from '@omniviewdev/ui/layout';
import { Modal } from '@omniviewdev/ui/overlays';
import { Text } from '@omniviewdev/ui/typography';
import React, { useState, useRef, useMemo } from 'react';
import { LuUpload, LuX, LuImage } from 'react-icons/lu';

import { processImageFile } from '../../utils/avatarUtils';
import { FOLDER_ICON_MAP, PRESET_COLORS } from '../../utils/folderIcons';

export interface FolderDialogValues {
  name: string;
  color: string;
  icon: string;
  customImage?: string;
}

type Props = {
  open: boolean;
  mode: 'create' | 'edit';
  initial?: Partial<FolderDialogValues>;
  existingNames?: string[];
  onSubmit: (values: FolderDialogValues) => void;
  onDelete?: () => void;
  onClose: () => void;
};

type IconTab = 'icons' | 'custom';

const iconKeys = Object.keys(FOLDER_ICON_MAP);

// ── Static styles ────────────────────────────────────────────────────────────

const sxModalBox = { minWidth: 360, p: 1.5 } as const;
const sxTitleText = { mb: 1 } as const;
const sxFormStack = { pt: 1.5 } as const;
const sxIconGrid = { display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)', gap: 0.5 } as const;
const sxIconBtnSquare = { aspectRatio: 1 } as const;
const sxColorPickerSpan = {
  fontSize: 11,
  fontWeight: 700,
  color: '#fff',
  lineHeight: 1,
  userSelect: 'none',
} as const;
const sxColorPickerInput = {
  position: 'absolute',
  inset: 0,
  opacity: 0,
  width: '100%',
  height: '100%',
  cursor: 'pointer',
  border: 'none',
  padding: 0,
} as const;
const sxDropPreviewImg = { width: 48, height: 48, objectFit: 'contain', borderRadius: 1 } as const;
const sxDropPreviewPad = { py: 1 } as const;
const sxDropEmptyPad = { py: 1.5 } as const;
const sxDropHintPrimary = { opacity: 0.6 } as const;
const sxDropHintSecondary = { opacity: 0.4 } as const;
const sxButtonRow = { mt: 1.5 } as const;
const sxDeleteBtn = { mr: 'auto' } as const;
const imageIconStyle = { opacity: 0.4 } as const;
const hiddenInputStyle: React.CSSProperties = { display: 'none' };

// ── Sub-components ───────────────────────────────────────────────────────────

const ColorSwatch: React.FC<{
  swatchColor: string;
  selected: boolean;
  onColorSelect: (color: string) => void;
}> = ({ swatchColor, selected, onColorSelect }) => {
  const handleClick = () => onColorSelect(swatchColor);
  const sx = useMemo(
    () => ({
      width: 22,
      height: 22,
      borderRadius: '50%',
      backgroundColor: swatchColor,
      cursor: 'pointer',
      outline: selected ? `2px solid ${swatchColor}` : '2px solid transparent',
      outlineOffset: 2,
      transition: 'outline-color 0.1s',
      '&:hover': { opacity: 0.8 },
    }),
    [swatchColor, selected],
  );
  return <Box onClick={handleClick} sx={sx} />;
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
      emphasis={selected ? 'soft' : 'ghost'}
      color={selected ? 'primary' : 'neutral'}
      onClick={handleClick}
      sx={sxIconBtnSquare}
    >
      {icon}
    </IconButton>
  );
};

// ── Main component ───────────────────────────────────────────────────────────

const FolderDialog: React.FC<Props> = ({
  open,
  mode,
  initial,
  existingNames = [],
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
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    });
  };

  // ── Memoized dynamic styles ──────────────────────────────────────────────

  const isCustomColor = !PRESET_COLORS.includes(color);

  const sxColorPickerLabel = useMemo(
    () => ({
      width: 22,
      height: 22,
      borderRadius: '50%',
      backgroundColor: isCustomColor ? color : '#888',
      cursor: 'pointer',
      outline: isCustomColor ? `2px solid ${color}` : '2px solid transparent',
      outlineOffset: 2,
      position: 'relative' as const,
      overflow: 'hidden' as const,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      '&:hover': { opacity: 0.8 },
    }),
    [color, isCustomColor],
  );

  const sxDropZone = useMemo(
    () => ({
      position: 'relative' as const,
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 100,
      borderRadius: 1,
      border: '2px dashed',
      borderColor: dragOver ? 'primary.500' : customImage ? 'divider' : 'neutral.300',
      backgroundColor: dragOver ? 'primary.softBg' : 'transparent',
      cursor: customImage ? 'default' : 'pointer',
      transition: 'border-color 0.15s, background-color 0.15s',
      '&:hover': customImage
        ? {}
        : { borderColor: 'primary.400', backgroundColor: 'primary.softBg' },
    }),
    [dragOver, customImage],
  );

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <Modal open={open} onClose={onClose}>
      <Box sx={sxModalBox}>
        <form onSubmit={handleSubmit}>
          <Text weight="semibold" size="lg" sx={sxTitleText}>
            {mode === 'create' ? 'New Folder' : 'Edit Folder'}
          </Text>
          <Divider />
          <Stack gap={1.5} sx={sxFormStack}>
            <FormField
              label="Name"
              error={isDuplicate ? 'A folder with this name already exists' : undefined}
            >
              <TextField
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                size="sm"
                placeholder="e.g. Production Suite"
                value={name}
                onChange={setName}
              />
            </FormField>

            {/* Color section */}
            <Stack gap={0.75}>
              <Text weight="semibold" size="sm">
                Color
              </Text>
              <Stack direction="row" gap={0.75} flexWrap="wrap" alignItems="center">
                {PRESET_COLORS.map((c) => (
                  <ColorSwatch
                    key={c}
                    swatchColor={c}
                    selected={color === c}
                    onColorSelect={setColor}
                  />
                ))}
                {/* Custom hex color picker */}
                <Box component="label" sx={sxColorPickerLabel}>
                  <Box component="span" sx={sxColorPickerSpan}>
                    #
                  </Box>
                  <Box
                    component="input"
                    type="color"
                    value={color}
                    onChange={handleColorInputChange}
                    sx={sxColorPickerInput}
                  />
                </Box>
              </Stack>
            </Stack>

            {/* Icon section with tabs */}
            <Stack gap={0.75}>
              <Stack direction="row" alignItems="center" gap={1}>
                <Text weight="semibold" size="sm">
                  Icon
                </Text>
                <Stack direction="row" gap={0.25}>
                  <Button
                    size="xs"
                    emphasis={iconTab === 'icons' ? 'soft' : 'ghost'}
                    color={iconTab === 'icons' ? 'primary' : 'neutral'}
                    onClick={handleSetIconsTab}
                  >
                    Presets
                  </Button>
                  <Button
                    size="xs"
                    emphasis={iconTab === 'custom' ? 'soft' : 'ghost'}
                    color={iconTab === 'custom' ? 'primary' : 'neutral'}
                    onClick={handleSetCustomTab}
                  >
                    Custom Image
                  </Button>
                </Stack>
              </Stack>

              {iconTab === 'icons' ? (
                <Box sx={sxIconGrid}>
                  {iconKeys.map((key) => (
                    <PresetIconButton
                      key={key}
                      iconKey={key}
                      selected={icon === key}
                      onIconSelect={setIcon}
                    />
                  ))}
                </Box>
              ) : (
                <Stack gap={1} alignItems="stretch">
                  {/* Drag-and-drop zone */}
                  <Box
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={handleDropZoneClick}
                    sx={sxDropZone}
                  >
                    {customImage ? (
                      <Stack alignItems="center" gap={0.75} sx={sxDropPreviewPad}>
                        <Box
                          component="img"
                          src={customImage}
                          alt="Custom icon preview"
                          sx={sxDropPreviewImg}
                        />
                        <Stack direction="row" gap={0.5}>
                          <Button
                            size="xs"
                            emphasis="soft"
                            color="neutral"
                            onClick={handleReplaceClick}
                          >
                            <LuUpload size={12} />
                            Replace
                          </Button>
                          <IconButton
                            size="xs"
                            emphasis="soft"
                            color="danger"
                            onClick={handleRemoveImage}
                            aria-label="Remove image"
                          >
                            <LuX size={12} />
                          </IconButton>
                        </Stack>
                      </Stack>
                    ) : (
                      <Stack alignItems="center" gap={0.5} sx={sxDropEmptyPad}>
                        <LuImage size={24} style={imageIconStyle} />
                        <Text size="xs" sx={sxDropHintPrimary}>
                          Drag &amp; drop an image here
                        </Text>
                        <Text size="xs" sx={sxDropHintSecondary}>
                          or click to browse (PNG, JPG, SVG)
                        </Text>
                      </Stack>
                    )}
                  </Box>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".png,.jpg,.jpeg,.svg,image/*"
                    onChange={handleFileChange}
                    style={hiddenInputStyle}
                  />
                  {imageError && (
                    <Text size="xs" color="danger">
                      {imageError}
                    </Text>
                  )}
                </Stack>
              )}
            </Stack>
          </Stack>
          <Stack direction="row" justifyContent="flex-end" gap={1} sx={sxButtonRow}>
            {mode === 'edit' && onDelete && (
              <Button emphasis="ghost" color="danger" onClick={onDelete} sx={sxDeleteBtn}>
                Delete
              </Button>
            )}
            <Button emphasis="ghost" color="neutral" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" emphasis="solid" color="primary" disabled={!canSubmit}>
              {mode === 'create' ? 'Create' : 'Save'}
            </Button>
          </Stack>
        </form>
      </Box>
    </Modal>
  );
};

export default FolderDialog;
