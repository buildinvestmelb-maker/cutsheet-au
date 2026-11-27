import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

let configured = false;

/**
 * Configures MapLibre GL JS v6 with the Vite-emitted ESM worker URL so both
 * `vite dev` and code-split `vite build` bundles resolve the worker cleanly.
 */
export function ensureMapLibreWorker(): void {
  if (configured) return;
  if (typeof window === 'undefined') return;
  if (typeof maplibreWorkerUrl === 'string' && maplibreWorkerUrl.length > 0) {
    let resolvedUrl = maplibreWorkerUrl;
    try {
      const parsed = new URL(maplibreWorkerUrl, window.location.href);
      if (
        window.location.origin &&
        window.location.origin !== 'null' &&
        parsed.origin !== window.location.origin
      ) {
        resolvedUrl = `${window.location.origin}${parsed.pathname}${parsed.search}`;
      }
    } catch {
      // Keep Vite-provided worker URL
    }
    maplibregl.setWorkerUrl(resolvedUrl);
  }
  configured = true;
}
