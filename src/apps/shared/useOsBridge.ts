import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  isForbiddenObjectKey,
  mergeSiteProject,
  type ChildToHostMessage,
  type DeepPartial,
  type HostToChildMessage,
  type SiteProject,
  type ToastLevel,
} from '../../bridge/types';
import { DEFAULT_PROJECT } from '../../data/starterDeals';
import type { AppId } from '../../registry/apps';

export type BridgeConnectionStatus =
  | 'loading'
  | 'ready'
  | 'timeout'
  | 'standalone'
  | 'error';

export interface UseOsBridgeResult {
  project: SiteProject | null;
  status: BridgeConnectionStatus;
  errorMessage: string | null;
  renderActive: boolean;
  lastSyncSource: string | null;
  isEmbedded: boolean;
  sendPatch: (patch: DeepPartial<SiteProject>) => boolean;
  notify: (title: string, message?: string, level?: ToastLevel) => void;
  openApp: (targetAppId: AppId, payload?: Record<string, unknown>) => void;
  retryHandshake: () => void;
  applyLocalProject: (project: SiteProject) => void;
}

export interface DirectOsBridgeContextValue {
  project: SiteProject;
  renderActive: boolean;
  lastSyncSource: string | null;
  sendPatch: (patch: DeepPartial<SiteProject>) => boolean;
  notify: (title: string, message?: string, level?: ToastLevel) => void;
  openApp: (targetAppId: AppId, payload?: Record<string, unknown>) => void;
  applyLocalProject: (project: SiteProject) => void;
}

export const DirectOsBridgeContext =
  createContext<DirectOsBridgeContextValue | null>(null);

export interface UseOsBridgeOptions {
  /** Timeout in milliseconds to await OS_INIT when embedded (default: 4000ms). */
  handshakeTimeoutMs?: number;
}

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 4000;
const BRIDGE_APP_VERSION = '3.0.0';

function detectIsEmbedded(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.parent !== window;
  } catch {
    return true;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasForbiddenKeys(
  value: unknown,
  seen = new WeakSet<object>(),
): boolean {
  if (typeof value !== 'object' || value === null) return false;
  if (seen.has(value)) return false;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.some((item) => hasForbiddenKeys(item, seen));
  }

  for (const key of Object.getOwnPropertyNames(value)) {
    if (isForbiddenObjectKey(key)) {
      return true;
    }
    if (hasForbiddenKeys((value as Record<string, unknown>)[key], seen)) {
      return true;
    }
  }

  return false;
}

function isValidIncomingSiteProject(value: unknown): value is SiteProject {
  if (!isPlainObject(value) || hasForbiddenKeys(value)) {
    return false;
  }

  if (
    typeof value.projectId !== 'string' ||
    value.projectId.trim().length === 0 ||
    typeof value.name !== 'string' ||
    value.name.trim().length === 0
  ) {
    return false;
  }

  if (!isPlainObject(value.location)) {
    return false;
  }

  const loc = value.location;
  if (
    typeof loc.state !== 'string' ||
    loc.state.trim().length === 0 ||
    typeof loc.lat !== 'number' ||
    !Number.isFinite(loc.lat) ||
    typeof loc.lng !== 'number' ||
    !Number.isFinite(loc.lng) ||
    typeof loc.mgaZone !== 'number' ||
    !Number.isFinite(loc.mgaZone) ||
    typeof loc.mgaEpsg !== 'string' ||
    loc.mgaEpsg.trim().length === 0
  ) {
    return false;
  }

  if (value.geometry !== undefined && !isPlainObject(value.geometry)) {
    return false;
  }

  return true;
}

function cloneSiteProject(project: SiteProject): SiteProject {
  const cloned = JSON.parse(JSON.stringify(project)) as SiteProject;
  if (!cloned.geometry || typeof cloned.geometry !== 'object') {
    cloned.geometry = {};
  }
  return cloned;
}

function isHostToChildMessage(data: unknown): data is HostToChildMessage {
  if (!isPlainObject(data) || typeof data.type !== 'string') {
    return false;
  }
  return (
    data.type === 'OS_INIT' ||
    data.type === 'OS_PROJECT_SYNC' ||
    data.type === 'OS_RENDER_STATE'
  );
}

/**
 * Shared typed @devaware/os-bridge React hook for all 4 Vite MPA micro-apps
 * (feaso-os, cutsheet-au, formgen-au, enviro-sim-au).
 *
 * Strictly enforces same-origin & parent-source checks on incoming messages,
 * posts exclusively to window.location.origin, manages the 4000ms OS_INIT
 * handshake lifecycle, handles standalone preview fallback, and forwards
 * OS_RENDER_STATE active/paused transitions.
 */
export function useOsBridge(
  appId: AppId,
  options: UseOsBridgeOptions = {},
): UseOsBridgeResult {
  const directBridge = useContext(DirectOsBridgeContext);
  const handshakeTimeoutMs =
    options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;

  const [isEmbedded] = useState<boolean>(() => detectIsEmbedded());
  const [project, setProject] = useState<SiteProject | null>(() =>
    detectIsEmbedded() ? null : cloneSiteProject(DEFAULT_PROJECT),
  );
  const [status, setStatus] = useState<BridgeConnectionStatus>(() =>
    detectIsEmbedded() ? 'loading' : 'standalone',
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [renderActive, setRenderActive] = useState<boolean>(true);
  const [lastSyncSource, setLastSyncSource] = useState<string | null>(() =>
    detectIsEmbedded() ? null : 'standalone',
  );

  const [handshakeAttempt, setHandshakeAttempt] = useState<number>(0);

  const timeoutRef = useRef<number | null>(null);

  const clearHandshakeTimer = useCallback(() => {
    if (timeoutRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const postToParent = useCallback(
    (
      message: ChildToHostMessage,
    ): { ok: true } | { ok: false; error: string } => {
      if (typeof window === 'undefined' || !detectIsEmbedded()) {
        return {
          ok: false,
          error: 'Application is running in standalone mode outside devaware-os.',
        };
      }

      const targetOrigin = window.location.origin;
      if (!targetOrigin || targetOrigin === 'null') {
        return {
          ok: false,
          error:
            'Cannot communicate with devaware-os from an opaque (null) origin.',
        };
      }

      try {
        window.parent.postMessage(message, targetOrigin);
        return { ok: true };
      } catch (err) {
        const detail =
          err instanceof Error
            ? err.message
            : 'Unexpected postMessage delivery failure.';
        return {
          ok: false,
          error: `Bridge message "${message.type}" failed: ${detail}`,
        };
      }
    },
    [],
  );

  useEffect(() => {
    if (directBridge || typeof window === 'undefined' || !isEmbedded) {
      return;
    }

    let cancelled = false;

    const handleMessage = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== window.parent
      ) {
        return;
      }

      if (!isHostToChildMessage(event.data)) {
        return;
      }

      const msg = event.data;

      switch (msg.type) {
        case 'OS_INIT': {
          clearHandshakeTimer();
          if (!isValidIncomingSiteProject(msg.project)) {
            setStatus('error');
            setErrorMessage(
              'Received a malformed or unsafe SiteProject payload from devaware-os during OS_INIT.',
            );
            return;
          }
          setProject(cloneSiteProject(msg.project));
          setRenderActive(msg.active !== false);
          setLastSyncSource('OS_INIT');
          setErrorMessage(null);
          setStatus('ready');
          break;
        }

        case 'OS_PROJECT_SYNC': {
          clearHandshakeTimer();
          if (!isValidIncomingSiteProject(msg.project)) {
            setStatus('error');
            setErrorMessage(
              'Received a malformed or unsafe SiteProject payload during OS_PROJECT_SYNC.',
            );
            return;
          }
          const source =
            typeof msg.sourceAppId === 'string' &&
            msg.sourceAppId.trim().length > 0
              ? msg.sourceAppId.trim()
              : 'OS_PROJECT_SYNC';
          setProject(cloneSiteProject(msg.project));
          setLastSyncSource(source);
          setErrorMessage(null);
          setStatus('ready');
          break;
        }

        case 'OS_RENDER_STATE': {
          setRenderActive(Boolean(msg.active));
          break;
        }
      }
    };

    const handleMouseDown = () => {
      const result = postToParent({
        type: 'APP_FOCUS',
        appId,
      });
      if (!result.ok) {
        setErrorMessage(result.error);
      }
    };

    window.addEventListener('message', handleMessage);
    window.addEventListener('mousedown', handleMouseDown);

    clearHandshakeTimer();
    if (handshakeTimeoutMs > 0) {
      const timeoutSeconds = Math.max(1, Math.round(handshakeTimeoutMs / 1000));
      timeoutRef.current = window.setTimeout(() => {
        timeoutRef.current = null;
        if (cancelled) return;
        setStatus('timeout');
        setErrorMessage(
          `OS_INIT did not arrive from devaware-os within ${timeoutSeconds} seconds. Ensure this app is hosted inside devaware-os or click Retry Handshake.`,
        );
      }, handshakeTimeoutMs);
    }

    const readyResult = postToParent({
      type: 'APP_READY',
      appId,
      version: BRIDGE_APP_VERSION,
    });

    if (!readyResult.ok) {
      clearHandshakeTimer();
      queueMicrotask(() => {
        if (cancelled) return;
        setStatus('error');
        setErrorMessage(readyResult.error);
      });
    }

    return () => {
      cancelled = true;
      clearHandshakeTimer();
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('mousedown', handleMouseDown);
    };
  }, [
    appId,
    clearHandshakeTimer,
    directBridge,
    handshakeAttempt,
    handshakeTimeoutMs,
    isEmbedded,
    postToParent,
  ]);

  const sendPatch = useCallback(
    (patch: DeepPartial<SiteProject>): boolean => {
      if (!isPlainObject(patch) || hasForbiddenKeys(patch)) {
        setErrorMessage(
          'Rejected invalid or unsafe SiteProject patch before transmission.',
        );
        return false;
      }

      setProject((prev) => (prev ? mergeSiteProject(prev, patch) : prev));

      if (!isEmbedded) {
        setLastSyncSource('standalone');
        return false;
      }

      const result = postToParent({
        type: 'PROJECT_PATCH',
        patch,
        sourceAppId: appId,
      });

      if (!result.ok) {
        setErrorMessage(result.error);
        return false;
      }

      setLastSyncSource(appId);
      setErrorMessage(null);
      return true;
    },
    [appId, isEmbedded, postToParent],
  );

  const notify = useCallback(
    (title: string, message?: string, level: ToastLevel = 'info'): void => {
      const trimmedTitle = title.trim();
      if (!trimmedTitle || !isEmbedded) return;

      const result = postToParent({
        type: 'NOTIFY',
        level,
        title: trimmedTitle,
        ...(message !== undefined ? { message } : {}),
      });

      if (!result.ok) {
        setErrorMessage(result.error);
      }
    },
    [isEmbedded, postToParent],
  );

  const openApp = useCallback(
    (targetAppId: AppId, payload?: Record<string, unknown>): void => {
      if (!isEmbedded) return;
      if (
        payload !== undefined &&
        (!isPlainObject(payload) || hasForbiddenKeys(payload))
      ) {
        setErrorMessage(
          'Rejected unsafe payload when requesting OPEN_APP across bridge.',
        );
        return;
      }

      const result = postToParent({
        type: 'OPEN_APP',
        appId: targetAppId,
        ...(payload !== undefined ? { payload } : {}),
      });

      if (!result.ok) {
        setErrorMessage(result.error);
      }
    },
    [isEmbedded, postToParent],
  );

  const retryHandshake = useCallback(() => {
    clearHandshakeTimer();

    if (!isEmbedded) {
      setProject((prev) => prev ?? cloneSiteProject(DEFAULT_PROJECT));
      setStatus('standalone');
      setErrorMessage(null);
      setRenderActive(true);
      setLastSyncSource((prev) => prev ?? 'standalone');
      return;
    }

    setStatus('loading');
    setErrorMessage(null);
    setHandshakeAttempt((attempt) => attempt + 1);
  }, [clearHandshakeTimer, isEmbedded]);

  const applyLocalProject = useCallback(
    (nextProject: SiteProject) => {
      if (!isValidIncomingSiteProject(nextProject)) {
        setErrorMessage(
          'Cannot apply malformed or unsafe SiteProject locally.',
        );
        return;
      }

      clearHandshakeTimer();
      setProject(cloneSiteProject(nextProject));
      setLastSyncSource('local');
      setErrorMessage(null);
      setStatus((prev) =>
        prev === 'ready' || prev === 'standalone'
          ? prev
          : isEmbedded
            ? 'ready'
            : 'standalone',
      );
    },
    [clearHandshakeTimer, isEmbedded],
  );

  if (directBridge) {
    return {
      project: directBridge.project,
      status: 'ready',
      errorMessage: null,
      renderActive: directBridge.renderActive,
      lastSyncSource: directBridge.lastSyncSource,
      isEmbedded: true,
      sendPatch: directBridge.sendPatch,
      notify: directBridge.notify,
      openApp: directBridge.openApp,
      retryHandshake: () => {},
      applyLocalProject: directBridge.applyLocalProject,
    };
  }

  return {
    project,
    status,
    errorMessage,
    renderActive,
    lastSyncSource,
    isEmbedded,
    sendPatch,
    notify,
    openApp,
    retryHandshake,
    applyLocalProject,
  };
}
