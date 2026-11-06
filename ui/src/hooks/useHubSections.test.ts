import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useHubSections } from './useHubSections';
import { resolveFolderImage } from '../utils/folderIcons';

const asset = { id: 'logo', name: 'Logo', dataUrl: 'data:image/png;base64,YQ==', createdAt: 1 };
const folder = {
  id: 'folder',
  name: 'Folder',
  connectionIds: [],
  iconAssetId: 'logo',
  customImage: 'legacy',
};

describe('folder image reference rendering', () => {
  it('uses library images before legacy fallback and retains fallback when reference is missing', () => {
    expect(resolveFolderImage(folder, [asset])).toBe(asset.dataUrl);
    expect(resolveFolderImage(folder, [])).toBe('legacy');
    expect(resolveFolderImage({ iconAssetId: 'missing' }, [asset])).toBeUndefined();
  });
  it('updates organization section images when library data arrives', () => {
    const { result, rerender } = renderHook(
      ({ assets }) =>
        useHubSections({
          enrichedConnections: [],
          customGroups: [folder],
          hubSectionConfigs: [{ type: 'group:folder', collapsed: true }],
          iconAssets: assets,
        }),
      { initialProps: { assets: [] as (typeof asset)[] } },
    );
    expect(result.current.sections[0].groupCustomImage).toBe('legacy');
    rerender({ assets: [asset] });
    expect(result.current.sections[0].groupCustomImage).toBe(asset.dataUrl);
    expect(result.current.sections[0].config.collapsed).toBe(true);
  });
});
