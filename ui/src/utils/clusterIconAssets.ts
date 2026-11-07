const MAX_UPLOAD = 5 * 1024 * 1024;
const MAX_PIXELS = 16_777_216;

/** Decode only recognized raster bytes; all persisted output is a fresh PNG. */
export async function decodeClusterIcon(file: File): Promise<string> {
  if (!file.size || file.size > MAX_UPLOAD) throw new Error('Choose an image smaller than 5 MB');
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const png = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp =
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  if (
    !(png && file.type === 'image/png') &&
    !(jpeg && file.type === 'image/jpeg') &&
    !(webp && file.type === 'image/webp')
  ) {
    throw new Error('Choose a PNG, JPEG or WebP raster image');
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const timer = setTimeout(() => {
      image.src = '';
      reject(new Error('Image decode timed out'));
    }, 10_000);
    image.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    image.onerror = () => {
      clearTimeout(timer);
      reject(new Error('Image could not be decoded'));
    };
    image.src = url;
    await promise;
    const { naturalWidth: width, naturalHeight: height } = image;
    if (!width || !height || width * height > MAX_PIXELS || width > 8192 || height > 8192) {
      throw new Error('Image dimensions exceed the safe limit');
    }
    const ratio = Math.min(1, 128 / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image rendering unavailable');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL('image/png');
    if (result.length > 140_000) throw new Error('Icon is too large after conversion');
    return result;
  } finally {
    URL.revokeObjectURL(url);
  }
}
