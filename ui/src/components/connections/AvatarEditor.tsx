import { Button, Stack, Text } from '@omniviewdev/base-ui';
import React from 'react';
import { LuUpload, LuPalette, LuRotateCcw } from 'react-icons/lu';

import { getInitials, processImageFile } from '../../utils/avatarUtils';
import { stringToColor } from '../../utils/color';
import { PRESET_COLORS } from '../../utils/folderIcons';

import styles from './Connections.module.css';

const avatarImageStyle: React.CSSProperties = {
  width: 96,
  height: 96,
  borderRadius: 8,
  objectFit: 'cover',
  display: 'block',
};

const initialsStyle: React.CSSProperties = {
  width: 96,
  height: 96,
  borderRadius: 8,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#fff',
  fontSize: '1.75rem',
  fontFamily: 'var(--ov-font-sans)',
  userSelect: 'none',
};

type AvatarEditorProps = {
  name: string;
  avatarUrl: string;
  avatarColor: string;
  onAvatarUrlChange: (url: string) => void;
  onAvatarColorChange: (color: string) => void;
};

const AvatarEditor: React.FC<AvatarEditorProps> = ({
  name,
  avatarUrl,
  avatarColor,
  onAvatarUrlChange,
  onAvatarColorChange,
}) => {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [showColors, setShowColors] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const [error, setError] = React.useState('');

  const initials = getInitials(name);
  const bgColor = avatarColor || stringToColor(name);

  const handleFile = async (file: File) => {
    setError('');
    try {
      const dataUrl = await processImageFile(file);
      onAvatarUrlChange(dataUrl);
      onAvatarColorChange('');
      setShowColors(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process image');
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    // Reset so the same file can be re-selected
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith('image/')) void handleFile(file);
  };

  const handleColorPick = (color: string) => {
    onAvatarColorChange(color);
    onAvatarUrlChange('');
  };

  const handleReset = () => {
    onAvatarUrlChange('');
    onAvatarColorChange('');
    setShowColors(false);
    setError('');
  };

  return (
    <Stack direction="column" align="center" style={{ minWidth: 180, gap: 12 }}>
      {/* Preview with drag-drop and hover overlay */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        style={{
          position: 'relative',
          width: 96,
          height: 96,
          borderRadius: 8,
          outline: dragOver ? '2px dashed var(--ov-color-brand-500)' : '2px solid transparent',
          outlineOffset: 2,
          transition: 'outline-color 0.15s',
        }}
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="" style={avatarImageStyle} />
        ) : (
          <div style={{ ...initialsStyle, backgroundColor: bgColor }}>{initials}</div>
        )}
        {/* Hover overlay */}
        {/* eslint-disable-next-line jsx-a11y-x/click-events-have-key-events, jsx-a11y-x/no-static-element-interactions */}
        <div className={styles.avatarOverlay} onClick={() => fileInputRef.current?.click()}>
          <LuUpload size={24} color="white" />
        </div>
      </div>

      {/* Actions */}
      <Stack direction="row" style={{ gap: 6 }}>
        <Button
          size="sm"
          variant="outline"
          color="neutral"
          startDecorator={<LuUpload size={14} />}
          onClick={() => fileInputRef.current?.click()}
        >
          Upload
        </Button>
        <Button
          size="sm"
          variant={showColors ? 'solid' : 'outline'}
          color={showColors ? 'brand' : 'neutral'}
          startDecorator={<LuPalette size={14} />}
          onClick={() => setShowColors((v) => !v)}
        >
          Color
        </Button>
        {(avatarUrl || avatarColor) && (
          <Button
            size="sm"
            variant="outline"
            color="neutral"
            startDecorator={<LuRotateCcw size={14} />}
            onClick={handleReset}
          >
            Reset
          </Button>
        )}
      </Stack>

      <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleFileInput} />

      {/* Color swatches */}
      {showColors && (
        <Stack direction="row" wrap justify="center" style={{ gap: 6 }}>
          {PRESET_COLORS.map((color) => (
            <button
              type="button"
              key={color}
              aria-label={`Use color ${color}`}
              onClick={() => handleColorPick(color)}
              className={
                avatarColor === color
                  ? `${styles.colorSwatch} ${styles.colorSwatchSelected}`
                  : styles.colorSwatch
              }
              style={{ backgroundColor: color }}
            />
          ))}
        </Stack>
      )}

      {/* Error */}
      {error && (
        <Text size="xs" tone="danger">
          {error}
        </Text>
      )}
    </Stack>
  );
};

export default AvatarEditor;
