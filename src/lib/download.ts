/**
 * Saves a blob to the device. Uses an object URL rather than a data URL so
 * large exports do not have to be base64-encoded into memory first.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** True when the browser can share this file through the OS share sheet. */
export function canShareFiles(files: File[]): boolean {
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  return typeof navigator.share === 'function' && (nav.canShare?.({ files }) ?? false);
}
