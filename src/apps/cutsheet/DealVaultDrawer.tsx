import { useState, type FormEvent } from 'react';
import {
  Cloud,
  Copy,
  FolderOpen,
  HardDrive,
  Lock,
  LogIn,
  LogOut,
  ShieldCheck,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import type {
  MapLabUserSession,
  SavedMapLabDeal,
} from '../../data/cloudDealStore';
import {
  deletePrivateDeal,
  isSupabaseCloudConfigured,
  signInAccount,
  signOutAccount,
  signUpAccount,
} from '../../data/cloudDealStore';
import { validateEmailInput } from '../../engines/deal/mapLabIntelligenceEngine';

export interface DealVaultDrawerProps {
  open: boolean;
  onClose: () => void;
  session: MapLabUserSession | null;
  onSessionChange: (session: MapLabUserSession | null) => void;
  deals: SavedMapLabDeal[];
  dealsLoading: boolean;
  dealsError: string | null;
  onRefreshDeals: () => void;
  onOpenDeal: (deal: SavedMapLabDeal) => void;
  activeDealId: string | null;
  privateAccessBlockedMsg: string | null;
  onClearAccessBlocked: () => void;
}

function formatCompactAud(value: number): string {
  if (!Number.isFinite(value)) return '$0';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}k`;
  return `${sign}$${Math.round(abs)}`;
}

export function DealVaultDrawer({
  open,
  onClose,
  session,
  onSessionChange,
  deals,
  dealsLoading,
  dealsError,
  onRefreshDeals,
  onOpenDeal,
  activeDealId,
  privateAccessBlockedMsg,
  onClearAccessBlocked,
}: DealVaultDrawerProps) {
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<string>('ALL');

  if (!open) return null;

  const cloudConfigured = isSupabaseCloudConfigured();

  const handleAuthSubmit = async (evt: FormEvent) => {
    evt.preventDefault();
    if (authBusy) return;
    setAuthError(null);

    const emailCheck = validateEmailInput(email);
    if (!emailCheck.valid) {
      setAuthError(emailCheck.error);
      return;
    }
    if (authMode === 'signup' && password.length < 6) {
      setAuthError('Password must be at least 6 characters.');
      return;
    }
    if (!password) {
      setAuthError('Please enter your password.');
      return;
    }

    setAuthBusy(true);
    try {
      const res =
        authMode === 'signup'
          ? await signUpAccount(email, password)
          : await signInAccount(email, password);
      if (!res.ok) {
        setAuthError(res.error);
        return;
      }
      setEmail('');
      setPassword('');
      onClearAccessBlocked();
      onSessionChange(res.session);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignOut = () => {
    signOutAccount();
    onSessionChange(null);
  };

  const handleDelete = async (dealId: string) => {
    if (!session || deletingId) return;
    setDeletingId(dealId);
    try {
      const res = await deletePrivateDeal(session, dealId);
      if (res.ok) {
        onRefreshDeals();
      }
    } finally {
      setDeletingId(null);
    }
  };

  const handleCopyDealLink = async (dealId: string) => {
    const shareUrl = `${window.location.origin}${window.location.pathname}#deal=${encodeURIComponent(dealId)}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      // Clipboard fallback ignored
    }
    setCopiedId(dealId);
    window.setTimeout(() => setCopiedId(null), 1800);
  };

  const filteredDeals =
    stateFilter === 'ALL' ? deals : deals.filter((d) => d.state === stateFilter);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Map Lab. DA Account & Saved Sites Vault"
      className="fixed inset-0 z-50 flex items-end justify-end bg-slate-950/75 backdrop-blur-sm min-[680px]:items-stretch"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full flex-col overflow-hidden rounded-t-2xl border border-slate-400/20 bg-[#0d141f] text-slate-100 shadow-2xl min-[680px]:h-full min-[680px]:max-h-none min-[680px]:w-[420px] min-[680px]:rounded-none min-[680px]:border-l"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-400/15 bg-[#090e16] px-4 py-3">
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-[#3daee9]" />
            <div>
              <h2 className="text-[13px] font-bold tracking-tight text-white">
                Map Lab. DA — My Saved Sites
              </h2>
              <p className="flex items-center gap-1 text-[10px] text-slate-400">
                {cloudConfigured ? (
                  <>
                    <Cloud size={10} className="text-emerald-400" />
                    <span>Supabase Cloud RLS Sync Active</span>
                  </>
                ) : (
                  <>
                    <HardDrive size={10} className="text-sky-400" />
                    <span>Private Device Vault (Connect Supabase for Multi-Device Sync)</span>
                  </>
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Saved Sites Vault"
            className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-slate-400/20 bg-[#141e2c] text-slate-300 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        {/* Private Data Wall Notice */}
        {privateAccessBlockedMsg && (
          <div
            role="alert"
            className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/15 px-3 py-2 text-[11px] text-rose-100"
          >
            <Lock size={14} className="mt-0.5 shrink-0 text-rose-300" />
            <div className="flex-1">{privateAccessBlockedMsg}</div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {!session ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-400/15 bg-[#111a28] p-3.5">
                <div className="mb-3 flex gap-1.5 rounded-lg bg-[#090e16] p-1">
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode('signin');
                      setAuthError(null);
                    }}
                    className={`flex-1 cursor-pointer rounded-md py-2 text-[11.5px] font-semibold transition-colors ${
                      authMode === 'signin'
                        ? 'bg-[#3daee9]/20 text-sky-100'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode('signup');
                      setAuthError(null);
                    }}
                    className={`flex-1 cursor-pointer rounded-md py-2 text-[11.5px] font-semibold transition-colors ${
                      authMode === 'signup'
                        ? 'bg-[#3daee9]/20 text-sky-100'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Create Account
                  </button>
                </div>

                <form onSubmit={handleAuthSubmit} className="space-y-3" noValidate>
                  <div>
                    <label
                      htmlFor="maplab-auth-email"
                      className="mb-1 block text-[11px] font-medium text-slate-300"
                    >
                      Work Email
                    </label>
                    <input
                      id="maplab-auth-email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="developer@company.com.au"
                      className="w-full rounded-lg border border-slate-400/25 bg-[#090e16] px-3 py-2.5 text-[12px] text-white outline-none focus:border-[#3daee9]"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="maplab-auth-password"
                      className="mb-1 block text-[11px] font-medium text-slate-300"
                    >
                      Password
                    </label>
                    <input
                      id="maplab-auth-password"
                      type="password"
                      autoComplete={
                        authMode === 'signup' ? 'new-password' : 'current-password'
                      }
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Minimum 6 characters"
                      className="w-full rounded-lg border border-slate-400/25 bg-[#090e16] px-3 py-2.5 text-[12px] text-white outline-none focus:border-[#3daee9]"
                    />
                  </div>

                  {authError && (
                    <p
                      role="alert"
                      className="rounded-md border border-rose-500/35 bg-rose-500/15 px-2.5 py-1.5 text-[11px] text-rose-100"
                    >
                      {authError}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={authBusy}
                    className="inline-flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-[#3daee9] px-4 py-2 text-[12px] font-bold text-slate-950 transition-colors hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {authMode === 'signup' ? <UserPlus size={15} /> : <LogIn size={15} />}
                    {authBusy
                      ? 'Authenticating…'
                      : authMode === 'signup'
                        ? 'Create Private Workspace'
                        : 'Sign In to My Sites'}
                  </button>
                </form>
              </div>

              <div className="rounded-lg border border-slate-400/12 bg-[#0b111b] p-3 text-[11px] text-slate-400">
                <p className="font-semibold text-slate-200">Strict Per-User Privacy Wall</p>
                <p className="mt-1 leading-relaxed">
                  Every saved parcel, civil rate schedule, and Residual Land Value memo is strictly
                  isolated to your account. No other user can view or edit your private sites.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Active User Strip */}
              <div className="flex items-center justify-between rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-semibold text-emerald-100">
                    {session.email}
                  </div>
                  <div className="text-[10px] text-emerald-300/80">
                    {session.provider === 'supabase'
                      ? 'Authenticated Cloud Session (RLS)'
                      : 'Private Local Vault Session'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-lg border border-slate-400/25 bg-[#0f1724] px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 hover:border-rose-400/50 hover:text-white"
                >
                  <LogOut size={13} />
                  Sign Out
                </button>
              </div>

              {/* State Filter Pills */}
              <div className="flex flex-wrap gap-1">
                {['ALL', 'NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'].map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setStateFilter(st)}
                    className={`cursor-pointer rounded-md border px-2 py-1 text-[10px] font-semibold transition-colors ${
                      stateFilter === st
                        ? 'border-[#3daee9]/70 bg-[#3daee9]/20 text-sky-100'
                        : 'border-slate-400/15 bg-[#121c2a] text-slate-400 hover:text-white'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>

              {dealsError && (
                <div className="flex items-center justify-between rounded-lg border border-amber-400/35 bg-amber-500/15 px-3 py-2 text-[11px] text-amber-100">
                  <span>{dealsError}</span>
                  <button
                    type="button"
                    onClick={onRefreshDeals}
                    className="ml-2 cursor-pointer rounded bg-amber-400 px-2 py-0.5 text-[10px] font-bold text-slate-950"
                  >
                    Retry
                  </button>
                </div>
              )}

              {dealsLoading ? (
                <div className="space-y-2">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="h-20 animate-pulse rounded-xl border border-slate-400/10 bg-[#121c2a]"
                    />
                  ))}
                </div>
              ) : filteredDeals.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-400/20 bg-[#101826] p-5 text-center">
                  <FolderOpen size={22} className="mx-auto mb-2 text-slate-500" />
                  <p className="text-[12px] font-semibold text-slate-200">
                    No saved sites yet{stateFilter !== 'ALL' ? ` in ${stateFilter}` : ''}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Snap or draw any Australian parcel, then click <strong>Save Site</strong> in the
                    Deal &amp; RLV tab to store it securely here.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {filteredDeals.map((deal) => {
                    const isActive = deal.id === activeDealId;
                    return (
                      <div
                        key={deal.id}
                        className={`rounded-xl border p-3 transition-colors ${
                          isActive
                            ? 'border-[#3daee9]/65 bg-[#132235]'
                            : 'border-slate-400/15 bg-[#111a28] hover:border-slate-400/35'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="rounded bg-[#3daee9]/20 px-1.5 py-0.5 font-mono-tech text-[9.5px] font-bold text-sky-200">
                                {deal.state}
                              </span>
                              <span className="truncate text-[12px] font-bold text-white">
                                {deal.name}
                              </span>
                            </div>
                            <p className="mt-0.5 truncate text-[10.5px] text-slate-400">
                              {deal.parcelId ? `${deal.parcelId} • ` : ''}
                              {(deal.grossAreaSqm / 10000).toFixed(2)} ha
                              {deal.address ? ` • ${deal.address}` : ''}
                            </p>
                          </div>
                          <span className="shrink-0 font-mono-tech text-[11px] font-bold text-emerald-300">
                            {formatCompactAud(deal.rlvAud)} RLV
                          </span>
                        </div>

                        <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-slate-400/10 pt-2">
                          <span className="font-mono-tech text-[10px] text-slate-400">
                            Civil {formatCompactAud(deal.earthworksCostAud)} • Score{' '}
                            {deal.developabilityScore}/100
                          </span>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleCopyDealLink(deal.id)}
                              title="Copy private deal link"
                              className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border border-slate-400/20 bg-[#162232] px-2 text-[10px] text-slate-200 hover:border-[#3daee9]/50"
                            >
                              <Copy size={11} />
                              {copiedId === deal.id ? 'Copied' : 'Link'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                onOpenDeal(deal);
                                onClose();
                              }}
                              className="inline-flex h-8 cursor-pointer items-center rounded-md bg-[#3daee9] px-2.5 text-[10.5px] font-bold text-slate-950 hover:bg-sky-300"
                            >
                              Open
                            </button>
                            <button
                              type="button"
                              disabled={deletingId === deal.id}
                              onClick={() => handleDelete(deal.id)}
                              title="Delete saved site"
                              className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/25 disabled:opacity-40"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
