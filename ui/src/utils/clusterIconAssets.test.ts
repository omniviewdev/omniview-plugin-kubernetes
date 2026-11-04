import { describe, expect, it, vi } from 'vitest';
import { decodeClusterIcon } from './clusterIconAssets';

const upload = (bytes: number[], type: string, size = bytes.length) =>
  ({
    size,
    type,
    slice: () => ({ arrayBuffer: async () => new Uint8Array(bytes).buffer }),
  }) as unknown as File;

describe('custom icon upload boundary', () => {
  it('rejects SVG and HTML before creating a browser image', async () => {
    const create = vi.spyOn(document, 'createElement');
    await expect(decodeClusterIcon(upload([60, 115, 118, 103], 'image/svg+xml'))).rejects.toThrow(
      'raster',
    );
    await expect(decodeClusterIcon(upload([60, 104, 116, 109, 108], 'text/html'))).rejects.toThrow(
      'raster',
    );
    expect(create).not.toHaveBeenCalled();
    create.mockRestore();
  });
  it('rejects spoofed MIME and oversized uploads before decode', async () => {
    await expect(decodeClusterIcon(upload([60, 115, 118, 103], 'image/png'))).rejects.toThrow(
      'raster',
    );
    await expect(decodeClusterIcon(upload([137, 80, 78, 71], 'image/jpeg'))).rejects.toThrow(
      'raster',
    );
    await expect(decodeClusterIcon(upload([], 'image/png', 6 * 1024 * 1024))).rejects.toThrow(
      '5 MB',
    );
    await expect(decodeClusterIcon(upload([], 'image/png', 0))).rejects.toThrow('5 MB');
  });
});
