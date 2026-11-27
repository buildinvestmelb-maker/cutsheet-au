const MAX_STEM_LENGTH = 120;
const FALLBACK_FILENAME_STEM = 'devaware-export';

function cleanExtension(extension: string): string {
  return extension
    .trim()
    .toLowerCase()
    .replace(/^\.+/, '')
    .replace(/[^a-z0-9.]+/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|\.+$/g, '');
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripControlChars(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    if (code >= 32 && code !== 127) {
      out += input[i];
    }
  }
  return out;
}

function sanitizeDownloadFilename(filename: string): string {
  const cleaned = stripControlChars(filename)
    .trim()
    .replace(/[/\\]+/g, '-')
    .replace(/^[.-]+/, '');
  return cleaned.length > 0 ? cleaned : FALLBACK_FILENAME_STEM;
}

/**
 * Converts a site or report name and file extension into a clean,
 * filesystem-safe lowercase slug (e.g. "Western Sydney Precinct 14", "pdf"
 * -> "western-sydney-precinct-14.pdf").
 */
export function slugifyFilename(name: string, extension: string): string {
  const safeExt = cleanExtension(extension);
  let rawStem = typeof name === 'string' ? name.trim() : '';

  if (safeExt) {
    const extPattern = new RegExp(`\\.${escapeRegExp(safeExt)}$`, 'i');
    rawStem = rawStem.replace(extPattern, '');
  }

  const normalized = rawStem
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_STEM_LENGTH)
    .replace(/-+$/g, '');

  const stem = normalized.length > 0 ? normalized : FALLBACK_FILENAME_STEM;
  return safeExt ? `${stem}.${safeExt}` : stem;
}

/**
 * Triggers a browser file download for an arbitrary Blob and revokes the
 * temporary Object URL once the browser has initiated the download.
 */
export function downloadBlobFile(blob: Blob, filename: string): void {
  if (typeof document === 'undefined' || !document.body) {
    throw new Error('File downloads require an active browser document.');
  }
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new Error(
      'Browser Blob download API (URL.createObjectURL) is unavailable.',
    );
  }

  const safeFilename = sanitizeDownloadFilename(filename);
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = safeFilename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';

  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    if (anchor.parentNode) {
      anchor.parentNode.removeChild(anchor);
    }
    if (typeof URL.revokeObjectURL === 'function') {
      window.setTimeout(() => {
        URL.revokeObjectURL(objectUrl);
      }, 1000);
    }
  }
}

/**
 * Triggers a browser download for a UTF-8 text payload (CSV, JSON, GeoJSON,
 * DXF, SVG, Markdown, etc.).
 */
export function downloadTextFile(
  content: string,
  filename: string,
  mimeType = 'text/plain;charset=utf-8',
): void {
  const blob = new Blob([content], { type: mimeType });
  downloadBlobFile(blob, filename);
}
