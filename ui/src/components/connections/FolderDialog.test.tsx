import React from 'react';
import type * as BaseUI from '@omniviewdev/base-ui';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FolderDialog from './FolderDialog';

const state = vi.hoisted(() => ({
  asset: { id: 'logo', name: 'Logo', dataUrl: 'data:image/png;base64,YQ==', createdAt: 1 },
  assets: [] as { id: string; name: string; dataUrl: string; createdAt: number }[],
  remove: vi.fn(),
  accept: [] as string[],
  add: vi.fn(),
  decode: vi.fn(),
}));
vi.mock('../../hooks/useClusterPreferences', () => ({
  useClusterPreferences: () => ({
    iconAssets: state.assets,
    addIconAsset: state.add,
    removeIconAsset: state.remove,
  }),
}));
vi.mock('../../utils/clusterIconAssets', () => ({
  decodeClusterIcon: state.decode,
}));
vi.mock('@omniviewdev/base-ui', async () => {
  const actual = await vi.importActual<typeof BaseUI>('@omniviewdev/base-ui');
  return {
    ...actual,
    IconPicker: ({
      onRemove,
      accept,
      onDragOver,
      onDrop,
      uploadError,
    }: React.HTMLAttributes<HTMLDivElement> & {
      onRemove: (id: string) => void;
      accept: string[];
      uploadError?: string;
    }) => {
      state.accept = accept;
      return (
        <div data-testid="icon-drop-target" onDragOver={onDragOver} onDrop={onDrop}>
          <button type="button" onClick={() => onRemove('logo')}>
            Remove library icon
          </button>
          {uploadError && <span role="alert">{uploadError}</span>}
        </div>
      );
    },
  };
});

afterEach(cleanup);
beforeEach(() => {
  state.assets = [state.asset];
  state.remove.mockReset();
  state.remove.mockResolvedValue(undefined);
  state.add.mockReset();
  state.add.mockResolvedValue(state.asset);
  state.decode.mockReset();
  state.decode.mockResolvedValue(state.asset.dataUrl);
});

describe('folder icon library removal', () => {
  it('keeps the inline image without restoring an asset removed by another window', async () => {
    const submit = vi.fn();
    const props = {
      open: true,
      mode: 'edit' as const,
      initial: { name: 'Folder', iconAssetId: 'logo', customImage: state.asset.dataUrl },
      onSubmit: submit,
      onClose: vi.fn(),
    };
    const { rerender } = render(<FolderDialog {...props} />);
    state.assets = [];
    rerender(<FolderDialog {...props} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save' }));
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ iconAssetId: undefined, customImage: state.asset.dataUrl }),
    );
  });
  it('saves the removed referenced raster image as an inline fallback', async () => {
    const submit = vi.fn();
    render(
      <FolderDialog
        open
        mode="edit"
        initial={{ name: 'Folder', iconAssetId: 'logo', customImage: 'older-image' }}
        onSubmit={submit}
        onClose={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Remove library icon' }));
    await waitFor(() => expect(state.remove).toHaveBeenCalledWith('logo'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ iconAssetId: undefined, customImage: state.asset.dataUrl }),
    );
    expect(state.accept).toEqual(['image/png', 'image/jpeg', 'image/webp']);
  });
  it('keeps the referenced icon when library deletion fails', async () => {
    state.remove.mockRejectedValue(new Error('offline'));
    const submit = vi.fn();
    render(
      <FolderDialog
        open
        mode="edit"
        initial={{ name: 'Folder', iconAssetId: 'logo' }}
        onSubmit={submit}
        onClose={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Remove library icon' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled());
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ iconAssetId: 'logo' }));
  });
  it('imports dropped files through the same raster decoder and keeps decode errors visible', async () => {
    render(
      <FolderDialog
        open
        mode="create"
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const target = screen.getByTestId('icon-drop-target');
    const file = new File(['raster'], 'fixture.png', { type: 'image/png' });
    expect(fireEvent.dragOver(target, { dataTransfer: { dropEffect: 'none' } })).toBe(false);
    expect(fireEvent.drop(target, { dataTransfer: { files: [file] } })).toBe(false);
    await waitFor(() => expect(state.add).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'fixture', dataUrl: state.asset.dataUrl }),
    ));
    expect(state.decode).toHaveBeenCalledWith(file);

    state.decode.mockRejectedValueOnce(new Error('Choose a PNG, JPEG or WebP raster image'));
    const unsafe = new File(['<svg/>'], 'unsafe.svg', { type: 'image/svg+xml' });
    fireEvent.drop(target, { dataTransfer: { files: [unsafe] } });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(
      'Choose a PNG, JPEG or WebP raster image',
    ));
    expect(state.add).toHaveBeenCalledTimes(1);
  });
});
