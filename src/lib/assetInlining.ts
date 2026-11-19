/** Converts a remote or asset-protocol resource into a data URL for export. */

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Could not read blob as a data URL'));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read blob'));
    reader.readAsDataURL(blob);
  });
}

export async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    if (blob.size > 8 * 1024 * 1024) return null;
    return await blobToDataUrl(blob);
  } catch {
    return null;
  }
}
