import type { FeatureCollection, Polygon } from 'geojson';
import type { AustralianState } from '../bridge/types';
import type {
  CivilRateOverrides,
  GradingStrategy,
  SoilClass,
} from '../engines/earthworks/gridVolumeEngine';
import type {
  DealFinancialInputs,
  EnvironmentalConstraintInputs,
} from '../engines/deal/mapLabIntelligenceEngine';
import {
  validateEmailInput,
  validateSiteNameInput,
} from '../engines/deal/mapLabIntelligenceEngine';

export interface MapLabUserSession {
  userId: string;
  email: string;
  displayName: string;
  provider: 'supabase' | 'local-vault';
  accessToken?: string;
}

export interface SavedMapLabDeal {
  id: string;
  ownerId: string;
  name: string;
  state: AustralianState;
  address: string;
  parcelId: string;
  lat: number;
  lng: number;
  grossAreaSqm: number;
  earthworksCostAud: number;
  rlvAud: number;
  developabilityScore: number;
  gradingStrategy: GradingStrategy;
  targetFflAHD: number;
  targetCutFillRatio: number;
  soilClass: SoilClass;
  rockBreakoutPct: number;
  topsoilDepthM: number;
  ratesOverride: CivilRateOverrides;
  env: EnvironmentalConstraintInputs;
  fin: DealFinancialInputs;
  boundary: FeatureCollection<Polygon>;
  createdAt: string;
  updatedAt: string;
}

const DB_NAME = 'map_lab_da_vault_v1';
const DB_VERSION = 1;
const STORE_ACCOUNTS = 'accounts';
const STORE_DEALS = 'deals';
const SESSION_STORAGE_KEY = 'map_lab_da_active_session_v1';

interface LocalAccountRecord {
  email: string;
  userId: string;
  displayName: string;
  saltHex: string;
  passwordHashHex: string;
  createdAt: string;
}

function getSupabaseEnv(): { url: string; anonKey: string } | null {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
  const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();
  if (!url || !anonKey) return null;
  if (!url.startsWith('https://')) return null;
  return { url: url.replace(/\/+$/, ''), anonKey };
}

export function isSupabaseCloudConfigured(): boolean {
  return getSupabaseEnv() !== null;
}

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const hash = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Deterministic fallback for non-secure test contexts (jsdom)
  let h = 2166136261;
  for (let i = 0; i < enc.length; i += 1) {
    h ^= enc[i];
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function randomHex(bytes = 12): string {
  const arr = new Uint8Array(bytes);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < bytes; i += 1) arr[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// In-memory fallback for environments where IndexedDB is disabled (strict private mode / jsdom)
const memoryAccounts = new Map<string, LocalAccountRecord>();
const memoryDeals = new Map<string, SavedMapLabDeal>();

function openVaultDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_ACCOUNTS)) {
          db.createObjectStore(STORE_ACCOUNTS, { keyPath: 'email' });
        }
        if (!db.objectStoreNames.contains(STORE_DEALS)) {
          const dealsStore = db.createObjectStore(STORE_DEALS, { keyPath: 'id' });
          dealsStore.createIndex('ownerId', 'ownerId', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbGet<T>(storeName: string, key: string): Promise<T | null> {
  const db = await openVaultDb();
  if (!db) {
    if (storeName === STORE_ACCOUNTS) return (memoryAccounts.get(key) as T | undefined) ?? null;
    if (storeName === STORE_DEALS) return (memoryDeals.get(key) as T | undefined) ?? null;
    return null;
  }
  return new Promise((resolve) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
    req.onerror = () => resolve(null);
  });
}

async function idbPut<T>(storeName: string, value: T): Promise<void> {
  const db = await openVaultDb();
  if (!db) {
    if (storeName === STORE_ACCOUNTS) {
      const rec = value as LocalAccountRecord;
      memoryAccounts.set(rec.email, rec);
    } else if (storeName === STORE_DEALS) {
      const rec = value as SavedMapLabDeal;
      memoryDeals.set(rec.id, rec);
    }
    return;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error('Could not save record to local storage.'));
  });
}

async function idbDelete(storeName: string, key: string): Promise<void> {
  const db = await openVaultDb();
  if (!db) {
    if (storeName === STORE_DEALS) memoryDeals.delete(key);
    return;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error('Could not delete record.'));
  });
}

async function idbListDealsForOwner(ownerId: string): Promise<SavedMapLabDeal[]> {
  const db = await openVaultDb();
  if (!db) {
    return Array.from(memoryDeals.values())
      .filter((d) => d.ownerId === ownerId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_DEALS, 'readonly');
    const idx = tx.objectStore(STORE_DEALS).index('ownerId');
    const req = idx.getAll(ownerId);
    req.onsuccess = () => {
      const list = ((req.result as SavedMapLabDeal[] | undefined) ?? []).filter(
        (d) => d.ownerId === ownerId,
      );
      list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      resolve(list);
    };
    req.onerror = () => resolve([]);
  });
}

export function loadActiveSession(): MapLabUserSession | null {
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MapLabUserSession>;
    if (!parsed.userId || !parsed.email || !parsed.provider) return null;
    return {
      userId: parsed.userId,
      email: parsed.email,
      displayName: parsed.displayName || parsed.email.split('@')[0] || 'User',
      provider: parsed.provider,
      accessToken: parsed.accessToken,
    };
  } catch {
    return null;
  }
}

function persistSession(session: MapLabUserSession | null): void {
  try {
    if (!session) {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    } else {
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    }
  } catch {
    // Storage quota or restricted mode
  }
}

export async function signUpAccount(
  emailRaw: string,
  password: string,
): Promise<{ ok: true; session: MapLabUserSession } | { ok: false; error: string }> {
  const emailCheck = validateEmailInput(emailRaw);
  if (!emailCheck.valid) return { ok: false, error: emailCheck.error };
  if (password.length < 6) {
    return { ok: false, error: 'Password must be at least 6 characters long.' };
  }
  const email = emailRaw.trim().toLowerCase();

  const sb = getSupabaseEnv();
  if (sb) {
    try {
      const res = await fetch(`${sb.url}/auth/v1/signup`, {
        method: 'POST',
        headers: {
          apikey: sb.anonKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
        signal: AbortSignal.timeout(9000),
      });
      const body = (await res.json()) as {
        access_token?: string;
        user?: { id?: string; email?: string };
        msg?: string;
        error_description?: string;
      };
      if (!res.ok) {
        return {
          ok: false,
          error: body.msg || body.error_description || 'Could not create your cloud account. Please try again.',
        };
      }
      if (!body.access_token || !body.user?.id) {
        return {
          ok: false,
          error: 'Account created! Please check your email inbox to confirm your address before signing in.',
        };
      }
      const session: MapLabUserSession = {
        userId: body.user.id,
        email: body.user.email || email,
        displayName: email.split('@')[0] || 'Developer',
        provider: 'supabase',
        accessToken: body.access_token,
      };
      persistSession(session);
      return { ok: true, session };
    } catch {
      return {
        ok: false,
        error: 'Cloud authentication service is temporarily unavailable. Please retry in a moment.',
      };
    }
  }

  const existing = await idbGet<LocalAccountRecord>(STORE_ACCOUNTS, email);
  if (existing) {
    return { ok: false, error: 'An account with this email already exists. Please sign in instead.' };
  }
  const saltHex = randomHex(12);
  const passwordHashHex = await sha256Hex(`${saltHex}:${password}`);
  const userId = `usr_${randomHex(10)}`;
  const rec: LocalAccountRecord = {
    email,
    userId,
    displayName: email.split('@')[0] || 'Developer',
    saltHex,
    passwordHashHex,
    createdAt: new Date().toISOString(),
  };
  await idbPut(STORE_ACCOUNTS, rec);
  const session: MapLabUserSession = {
    userId,
    email,
    displayName: rec.displayName,
    provider: 'local-vault',
  };
  persistSession(session);
  return { ok: true, session };
}

export async function signInAccount(
  emailRaw: string,
  password: string,
): Promise<{ ok: true; session: MapLabUserSession } | { ok: false; error: string }> {
  const emailCheck = validateEmailInput(emailRaw);
  if (!emailCheck.valid) return { ok: false, error: emailCheck.error };
  if (!password) return { ok: false, error: 'Please enter your password.' };
  const email = emailRaw.trim().toLowerCase();

  const sb = getSupabaseEnv();
  if (sb) {
    try {
      const res = await fetch(`${sb.url}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          apikey: sb.anonKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
        signal: AbortSignal.timeout(9000),
      });
      const body = (await res.json()) as {
        access_token?: string;
        user?: { id?: string; email?: string };
        error_description?: string;
        msg?: string;
      };
      if (!res.ok || !body.access_token || !body.user?.id) {
        return {
          ok: false,
          error: body.error_description || body.msg || 'Incorrect email or password.',
        };
      }
      const session: MapLabUserSession = {
        userId: body.user.id,
        email: body.user.email || email,
        displayName: email.split('@')[0] || 'Developer',
        provider: 'supabase',
        accessToken: body.access_token,
      };
      persistSession(session);
      return { ok: true, session };
    } catch {
      return {
        ok: false,
        error: 'Cloud authentication service is temporarily unavailable. Please retry.',
      };
    }
  }

  const existing = await idbGet<LocalAccountRecord>(STORE_ACCOUNTS, email);
  if (!existing) {
    return { ok: false, error: 'No account found for that email. Create a free account first.' };
  }
  const hash = await sha256Hex(`${existing.saltHex}:${password}`);
  if (hash !== existing.passwordHashHex) {
    return { ok: false, error: 'Incorrect email or password.' };
  }
  const session: MapLabUserSession = {
    userId: existing.userId,
    email: existing.email,
    displayName: existing.displayName,
    provider: 'local-vault',
  };
  persistSession(session);
  return { ok: true, session };
}

export function signOutAccount(): void {
  persistSession(null);
}

// Single-flight idempotency lock preventing rapid multi-click duplicate saves
const inFlightSaves = new Map<string, Promise<{ ok: true; deal: SavedMapLabDeal } | { ok: false; error: string }>>();

export async function savePrivateDeal(
  session: MapLabUserSession | null,
  draft: Omit<SavedMapLabDeal, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'> & {
    existingId?: string;
  },
): Promise<{ ok: true; deal: SavedMapLabDeal } | { ok: false; error: string }> {
  if (!session) {
    return { ok: false, error: 'Please sign in to save sites to your private workspace.' };
  }
  const nameCheck = validateSiteNameInput(draft.name);
  if (!nameCheck.valid) return { ok: false, error: nameCheck.error };

  const dedupeKey = `${session.userId}:${draft.existingId ?? draft.name.trim().toLowerCase()}:${draft.state}:${Math.round(draft.grossAreaSqm)}`;
  const activePromise = inFlightSaves.get(dedupeKey);
  if (activePromise) return activePromise;

  const task = (async (): Promise<
    { ok: true; deal: SavedMapLabDeal } | { ok: false; error: string }
  > => {
    const now = new Date().toISOString();
    const id = draft.existingId || `deal_${randomHex(8)}`;
    const record: SavedMapLabDeal = {
      id,
      ownerId: session.userId,
      name: draft.name.trim(),
      state: draft.state,
      address: draft.address.trim(),
      parcelId: draft.parcelId.trim(),
      lat: draft.lat,
      lng: draft.lng,
      grossAreaSqm: draft.grossAreaSqm,
      earthworksCostAud: Math.round(draft.earthworksCostAud),
      rlvAud: Math.round(draft.rlvAud),
      developabilityScore: Math.round(draft.developabilityScore),
      gradingStrategy: draft.gradingStrategy,
      targetFflAHD: draft.targetFflAHD,
      targetCutFillRatio: draft.targetCutFillRatio,
      soilClass: draft.soilClass,
      rockBreakoutPct: draft.rockBreakoutPct,
      topsoilDepthM: draft.topsoilDepthM,
      ratesOverride: draft.ratesOverride,
      env: draft.env,
      fin: draft.fin,
      boundary: draft.boundary,
      createdAt: now,
      updatedAt: now,
    };

    const sb = getSupabaseEnv();
    if (sb && session.provider === 'supabase' && session.accessToken) {
      try {
        const res = await fetch(`${sb.url}/rest/v1/map_lab_deals`, {
          method: 'POST',
          headers: {
            apikey: sb.anonKey,
            authorization: `Bearer ${session.accessToken}`,
            'content-type': 'application/json',
            prefer: 'resolution=merge-duplicates,return=representation',
          },
          body: JSON.stringify({
            id: record.id,
            user_id: session.userId,
            name: record.name,
            state: record.state,
            address: record.address,
            parcel_id: record.parcelId,
            gross_area_sqm: record.grossAreaSqm,
            earthworks_cost_aud: record.earthworksCostAud,
            rlv_aud: record.rlvAud,
            developability_score: record.developabilityScore,
            payload: record,
            updated_at: now,
          }),
          signal: AbortSignal.timeout(9000),
        });
        if (!res.ok) {
          return {
            ok: false,
            error: 'Could not save site to cloud database. Please retry.',
          };
        }
        return { ok: true, deal: record };
      } catch {
        return {
          ok: false,
          error: 'Cloud database is temporarily unreachable. Your work is intact—please retry.',
        };
      }
    }

    // Enforce strict ownership before overwriting in local vault
    const existing = await idbGet<SavedMapLabDeal>(STORE_DEALS, id);
    if (existing && existing.ownerId !== session.userId) {
      return { ok: false, error: 'You do not have permission to edit this private site.' };
    }
    if (existing) {
      record.createdAt = existing.createdAt;
    }
    await idbPut(STORE_DEALS, record);
    return { ok: true, deal: record };
  })();

  inFlightSaves.set(dedupeKey, task);
  try {
    return await task;
  } finally {
    window.setTimeout(() => {
      inFlightSaves.delete(dedupeKey);
    }, 800);
  }
}

export async function listPrivateDeals(
  session: MapLabUserSession | null,
): Promise<{ ok: true; deals: SavedMapLabDeal[] } | { ok: false; error: string }> {
  if (!session) return { ok: true, deals: [] };

  const sb = getSupabaseEnv();
  if (sb && session.provider === 'supabase' && session.accessToken) {
    try {
      const res = await fetch(
        `${sb.url}/rest/v1/map_lab_deals?select=payload&order=updated_at.desc`,
        {
          headers: {
            apikey: sb.anonKey,
            authorization: `Bearer ${session.accessToken}`,
          },
          signal: AbortSignal.timeout(9000),
        },
      );
      if (!res.ok) {
        return { ok: false, error: 'Could not load saved sites from cloud. Please retry.' };
      }
      const rows = (await res.json()) as Array<{ payload: SavedMapLabDeal }>;
      const deals = rows
        .map((r) => r.payload)
        .filter((d) => d && d.ownerId === session.userId);
      return { ok: true, deals };
    } catch {
      return { ok: false, error: 'Cloud storage is temporarily slow or unreachable.' };
    }
  }

  const deals = await idbListDealsForOwner(session.userId);
  return { ok: true, deals };
}

/**
 * Strict Private Data Wall lookup by direct URL deal ID (#deal=<id>).
 * Returns `access-denied` if unauthenticated or if the deal belongs to another user,
 * exposing ZERO fields from another user's deal.
 */
export async function loadPrivateDealById(
  session: MapLabUserSession | null,
  dealId: string,
): Promise<
  | { status: 'ok'; deal: SavedMapLabDeal }
  | { status: 'unauthenticated' }
  | { status: 'access-denied' }
  | { status: 'not-found' }
> {
  if (!session) return { status: 'unauthenticated' };
  const cleanId = dealId.trim();
  if (!cleanId) return { status: 'not-found' };

  const sb = getSupabaseEnv();
  if (sb && session.provider === 'supabase' && session.accessToken) {
    try {
      const res = await fetch(
        `${sb.url}/rest/v1/map_lab_deals?id=eq.${encodeURIComponent(cleanId)}&select=payload`,
        {
          headers: {
            apikey: sb.anonKey,
            authorization: `Bearer ${session.accessToken}`,
          },
          signal: AbortSignal.timeout(9000),
        },
      );
      if (!res.ok) return { status: 'access-denied' };
      const rows = (await res.json()) as Array<{ payload: SavedMapLabDeal }>;
      const deal = rows[0]?.payload;
      if (!deal || deal.ownerId !== session.userId) return { status: 'access-denied' };
      return { status: 'ok', deal };
    } catch {
      return { status: 'access-denied' };
    }
  }

  const found = await idbGet<SavedMapLabDeal>(STORE_DEALS, cleanId);
  if (!found) return { status: 'not-found' };
  if (found.ownerId !== session.userId) return { status: 'access-denied' };
  return { status: 'ok', deal: found };
}

export async function deletePrivateDeal(
  session: MapLabUserSession | null,
  dealId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!session) return { ok: false, error: 'Please sign in first.' };

  const sb = getSupabaseEnv();
  if (sb && session.provider === 'supabase' && session.accessToken) {
    try {
      const res = await fetch(
        `${sb.url}/rest/v1/map_lab_deals?id=eq.${encodeURIComponent(dealId)}&user_id=eq.${encodeURIComponent(session.userId)}`,
        {
          method: 'DELETE',
          headers: {
            apikey: sb.anonKey,
            authorization: `Bearer ${session.accessToken}`,
          },
          signal: AbortSignal.timeout(9000),
        },
      );
      if (!res.ok) return { ok: false, error: 'Could not delete site from cloud.' };
      return { ok: true };
    } catch {
      return { ok: false, error: 'Cloud service temporarily unreachable.' };
    }
  }

  const found = await idbGet<SavedMapLabDeal>(STORE_DEALS, dealId);
  if (!found) return { ok: true };
  if (found.ownerId !== session.userId) {
    return { ok: false, error: 'Access denied: you can only delete your own sites.' };
  }
  await idbDelete(STORE_DEALS, dealId);
  return { ok: true };
}
