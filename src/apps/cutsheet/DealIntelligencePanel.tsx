import { useState } from 'react';
import {
  AlertTriangle,
  BookmarkCheck,
  CheckCircle2,
  FileText,
  Landmark,
  Lock,
  Save,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import type {
  DealFinancialInputs,
  DevelopmentTypology,
  MapLabDealIntelligence,
  RlvOptimizationResult,
} from '../../engines/deal/mapLabIntelligenceEngine';
import {
  validateNonNegativeNumber,
  validateSiteNameInput,
} from '../../engines/deal/mapLabIntelligenceEngine';
import type { MapLabUserSession } from '../../data/cloudDealStore';

export interface DealIntelligencePanelProps {
  intelligence: MapLabDealIntelligence;
  fin: DealFinancialInputs;
  onFinChange: (next: DealFinancialInputs) => void;
  siteNameDraft: string;
  onSiteNameDraftChange: (name: string) => void;
  session: MapLabUserSession | null;
  onOpenAuthVault: () => void;
  onSaveDeal: () => Promise<void>;
  saveBusy: boolean;
  saveFeedback: { kind: 'success' | 'error'; text: string } | null;
  onOptimizeForMaxRlv: () => void;
  optimizingRlv: boolean;
  lastOptimization: RlvOptimizationResult | null;
  onExportPdfMemo: () => void;
  parcelProvenanceLabel: string;
  parcelId?: string;
}

const AUD = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
});

function formatCompactAud(value: number): string {
  if (!Number.isFinite(value)) return '$0';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}k`;
  return `${sign}$${Math.round(abs)}`;
}

export function DealIntelligencePanel({
  intelligence,
  fin,
  onFinChange,
  siteNameDraft,
  onSiteNameDraftChange,
  session,
  onOpenAuthVault,
  onSaveDeal,
  saveBusy,
  saveFeedback,
  onOptimizeForMaxRlv,
  optimizingRlv,
  lastOptimization,
  onExportPdfMemo,
  parcelProvenanceLabel,
  parcelId,
}: DealIntelligencePanelProps) {
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const nameValidation = validateSiteNameInput(siteNameDraft);

  const handleNumericField = (
    key: keyof DealFinancialInputs,
    label: string,
    raw: string,
    maxVal: number,
  ) => {
    const check = validateNonNegativeNumber(raw, label, maxVal);
    if (!check.valid) {
      setFieldErrors((prev) => ({ ...prev, [key]: check.error }));
      return;
    }
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    onFinChange({ ...fin, [key]: Number(raw) });
  };

  const viabilityClass =
    intelligence.dealViabilityLabel === 'Strong Acquisition'
      ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200'
      : intelligence.dealViabilityLabel === 'Viable (Negotiate)'
        ? 'border-amber-400/40 bg-amber-500/15 text-amber-200'
        : 'border-rose-400/40 bg-rose-500/15 text-rose-200';

  return (
    <div className="space-y-3" data-testid="maplab-deal-rlv-panel">
      {/* Site Area Cap Guardrail Warning */}
      {!intelligence.siteCap.ok && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-amber-400/45 bg-amber-500/15 p-2.5 text-[11px] text-amber-100"
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-300" />
          <span>{intelligence.siteCap.message}</span>
        </div>
      )}

      {/* Hero Paddock-to-Offer Residual Land Value Card */}
      <div className="rounded-xl border border-emerald-400/25 bg-gradient-to-br from-[#0e1e2b] via-[#0d1824] to-[#0b131e] p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-bold tracking-wider text-sky-300 uppercase">
            Paddock-to-Offer Max Land Price (RLV)
          </span>
          <span
            className={`rounded-full border px-2 py-0.5 text-[9.5px] font-bold ${viabilityClass}`}
          >
            {intelligence.dealViabilityLabel}
          </span>
        </div>

        <div className="mt-1.5 flex items-baseline justify-between gap-2">
          <div className="font-mono-tech text-[24px] leading-tight font-bold text-emerald-300">
            {formatCompactAud(intelligence.residualLandValueAud)}
          </div>
          <div className="text-right font-mono-tech text-[10.5px] text-slate-300">
            <div>{AUD.format(intelligence.rlvPerSqmAud)}/m²</div>
            <div className="text-slate-400">{formatCompactAud(intelligence.rlvPerLotAud)}/lot</div>
          </div>
        </div>

        <div className="mt-2.5 grid grid-cols-4 gap-1.5 border-t border-slate-400/12 pt-2.5 text-center">
          <div className="rounded-md bg-[#0a1019] px-1.5 py-1.5">
            <div className="text-[9px] text-slate-400 uppercase">Yield</div>
            <div className="font-mono-tech text-[12px] font-bold text-white">
              {intelligence.trueNda.projectedYieldLots} lots
            </div>
          </div>
          <div className="rounded-md bg-[#0a1019] px-1.5 py-1.5">
            <div className="text-[9px] text-slate-400 uppercase">True NDA</div>
            <div className="font-mono-tech text-[12px] font-bold text-sky-300">
              {intelligence.trueNda.trueNdaPct}%
            </div>
          </div>
          <div className="rounded-md bg-[#0a1019] px-1.5 py-1.5">
            <div className="text-[9px] text-slate-400 uppercase">Margin</div>
            <div className="font-mono-tech text-[12px] font-bold text-emerald-300">
              {intelligence.projectedMarginOnCostPct}%
            </div>
          </div>
          <div className="rounded-md bg-[#0a1019] px-1.5 py-1.5">
            <div className="text-[9px] text-slate-400 uppercase">Est. IRR</div>
            <div className="font-mono-tech text-[12px] font-bold text-amber-200">
              {intelligence.projectedAnnualIrrPct}%
            </div>
          </div>
        </div>

        {/* Breakthrough Action: Optimize Civil Grading for Maximum RLV */}
        <button
          type="button"
          disabled={optimizingRlv}
          onClick={onOptimizeForMaxRlv}
          className="mt-2.5 inline-flex min-h-[40px] w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-emerald-400/45 bg-emerald-500/20 px-3 py-2 text-[11.5px] font-bold text-emerald-100 transition-colors hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Sparkles size={14} />
          {optimizingRlv ? 'Optimizing Civil Grading for Max RLV…' : 'Optimize Grading for Max RLV'}
        </button>

        {lastOptimization && (
          <div className="mt-2 flex items-center gap-1.5 rounded-md border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-1.5 text-[10.5px] text-emerald-200">
            <TrendingUp size={13} className="shrink-0" />
            <span>
              Applied <strong>{lastOptimization.bestStrategy}</strong> @{' '}
              {lastOptimization.bestFflAHD.toFixed(2)}m AHD —{' '}
              <strong>+{formatCompactAud(lastOptimization.rlvUpliftAud)} RLV</strong> vs Flat Pad (
              {formatCompactAud(lastOptimization.earthworksSavingsAud)} civil saved)
            </span>
          </div>
        )}
      </div>

      {/* Connected Cost Waterfall: Earthworks + OSD + Bushfire + 8-State Transfer Duty */}
      <div className="rounded-lg border border-slate-400/15 bg-[#0f1724] p-2.5 text-[11px]">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="flex items-center gap-1 font-bold text-slate-200">
            <Landmark size={12} className="text-[#3daee9]" />
            Connected Feasibility Waterfall ({intelligence.state})
          </span>
          <span className="font-mono-tech text-[10px] text-slate-400">
            GRV {formatCompactAud(intelligence.grossRealisationAud)}
          </span>
        </div>

        <div className="space-y-1 font-mono-tech text-[10.5px]">
          <div className="flex justify-between text-slate-300">
            <span>Bulk Earthworks &amp; Retaining</span>
            <span>
              {formatCompactAud(intelligence.earthworksCostAud)} (
              {formatCompactAud(intelligence.earthworksCostPerLotAud)}/lot)
            </span>
          </div>
          <div className="flex justify-between text-slate-300">
            <span>
              Auto OSD Basin ({intelligence.osd.engineeredBasinVolumeM3} m³ •{' '}
              {intelligence.osd.rainfallIntensityMmHr}mm/hr)
            </span>
            <span>{formatCompactAud(intelligence.osd.estimatedOsdCostAud)}</span>
          </div>
          <div className="flex justify-between text-slate-300">
            <span>AS 3959 BAL Uplift ({intelligence.balRiskLevel})</span>
            <span>{formatCompactAud(intelligence.balUpliftTotalAud)}</span>
          </div>
          <div className="flex justify-between text-sky-200">
            <span>
              {intelligence.state} Transfer Duty ({intelligence.stampDutyEffectivePct}%)
            </span>
            <span>{formatCompactAud(intelligence.statutoryStampDutyAud)}</span>
          </div>
          <div className="flex justify-between border-t border-slate-400/12 pt-1 text-[10px] text-slate-400">
            <span>{intelligence.stampDutyAuthority}</span>
            <span>Finance {formatCompactAud(intelligence.financeHoldingCostAud)}</span>
          </div>
        </div>
      </div>

      {/* Private Save Site Form (Strict Validation + Single-Flight Idempotency) */}
      <div className="rounded-lg border border-slate-400/15 bg-[#0f1724] p-2.5">
        <div className="mb-1.5 flex items-center justify-between">
          <label
            htmlFor="maplab-save-site-name"
            className="text-[10.5px] font-bold tracking-wide text-slate-200 uppercase"
          >
            Save Site to Private Workspace
          </label>
          {parcelId && (
            <span className="rounded bg-sky-500/15 px-1.5 py-0.5 font-mono-tech text-[9.5px] text-sky-200">
              {parcelId}
            </span>
          )}
        </div>

        <div className="flex gap-1.5">
          <input
            id="maplab-save-site-name"
            type="text"
            value={siteNameDraft}
            onChange={(e) => onSiteNameDraftChange(e.target.value)}
            placeholder="e.g., Lot 14 Brisbane North Precinct"
            className="min-h-[40px] flex-1 rounded-lg border border-slate-400/25 bg-[#090e16] px-2.5 py-1.5 text-[11.5px] text-white outline-none focus:border-[#3daee9]"
          />
          {session ? (
            <button
              type="button"
              disabled={saveBusy || !nameValidation.valid}
              onClick={() => void onSaveDeal()}
              className="inline-flex min-h-[40px] shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-[#3daee9] px-3 py-1.5 text-[11.5px] font-bold text-slate-950 transition-colors hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Save size={13} />
              {saveBusy ? 'Saving…' : 'Save Site'}
            </button>
          ) : (
            <button
              type="button"
              onClick={onOpenAuthVault}
              className="inline-flex min-h-[40px] shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-[#3daee9]/50 bg-[#3daee9]/15 px-3 py-1.5 text-[11px] font-bold text-sky-200 hover:bg-[#3daee9]/25"
            >
              <Lock size={12} />
              Sign In
            </button>
          )}
        </div>

        {!nameValidation.valid && siteNameDraft.length > 0 && (
          <p role="alert" className="mt-1 text-[10.5px] text-rose-300">
            {nameValidation.error}
          </p>
        )}

        {saveFeedback && (
          <div
            role="status"
            className={`mt-2 flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[10.5px] ${
              saveFeedback.kind === 'success'
                ? 'border-emerald-400/35 bg-emerald-500/15 text-emerald-200'
                : 'border-rose-500/35 bg-rose-500/15 text-rose-100'
            }`}
          >
            {saveFeedback.kind === 'success' ? (
              <CheckCircle2 size={13} className="shrink-0" />
            ) : (
              <AlertTriangle size={13} className="shrink-0" />
            )}
            <span>{saveFeedback.text}</span>
          </div>
        )}
      </div>

      {/* Yield & Commercial Assumptions (Validated Inputs) */}
      <div className="rounded-lg border border-slate-400/15 bg-[#0f1724] p-2.5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10.5px] font-bold tracking-wide text-slate-300 uppercase">
            Yield &amp; Feasibility Assumptions
          </span>
          <div className="flex rounded-md bg-[#090e16] p-0.5 text-[10px]">
            {(['subdivision', 'townhouses'] as DevelopmentTypology[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() =>
                  onFinChange({
                    ...fin,
                    typology: t,
                    targetLotSizeSqm: t === 'townhouses' ? 240 : 450,
                  })
                }
                className={`cursor-pointer rounded px-2 py-1 font-semibold capitalize ${
                  fin.typology === t
                    ? 'bg-[#3daee9]/25 text-sky-100'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-0.5 block text-[10px] text-slate-400">
              Avg Sale Price ($/lot)
            </label>
            <input
              type="number"
              min={50000}
              step={10000}
              defaultValue={fin.avgEndSalePricePerLotAud}
              key={`sale-${intelligence.state}-${fin.typology}`}
              onChange={(e) =>
                handleNumericField(
                  'avgEndSalePricePerLotAud',
                  'Avg Sale Price',
                  e.target.value,
                  10_000_000,
                )
              }
              className="w-full rounded-md border border-slate-400/20 bg-[#090e16] px-2 py-1.5 font-mono-tech text-[11px] text-white outline-none focus:border-[#3daee9]"
            />
            {fieldErrors.avgEndSalePricePerLotAud && (
              <p className="mt-0.5 text-[9.5px] text-rose-300">
                {fieldErrors.avgEndSalePricePerLotAud}
              </p>
            )}
          </div>

          <div>
            <label className="mb-0.5 block text-[10px] text-slate-400">
              Target Lot Size (m²)
            </label>
            <input
              type="number"
              min={140}
              step={10}
              defaultValue={fin.targetLotSizeSqm}
              key={`lot-${intelligence.state}-${fin.typology}`}
              onChange={(e) =>
                handleNumericField('targetLotSizeSqm', 'Target Lot Size', e.target.value, 10_000)
              }
              className="w-full rounded-md border border-slate-400/20 bg-[#090e16] px-2 py-1.5 font-mono-tech text-[11px] text-white outline-none focus:border-[#3daee9]"
            />
            {fieldErrors.targetLotSizeSqm && (
              <p className="mt-0.5 text-[9.5px] text-rose-300">{fieldErrors.targetLotSizeSqm}</p>
            )}
          </div>

          <div>
            <label className="mb-0.5 block text-[10px] text-slate-400">
              Civil Servicing ($/lot)
            </label>
            <input
              type="number"
              min={0}
              step={2000}
              defaultValue={fin.servicingCostPerLotAud}
              key={`serv-${intelligence.state}-${fin.typology}`}
              onChange={(e) =>
                handleNumericField(
                  'servicingCostPerLotAud',
                  'Civil Servicing',
                  e.target.value,
                  500_000,
                )
              }
              className="w-full rounded-md border border-slate-400/20 bg-[#090e16] px-2 py-1.5 font-mono-tech text-[11px] text-white outline-none focus:border-[#3daee9]"
            />
            {fieldErrors.servicingCostPerLotAud && (
              <p className="mt-0.5 text-[9.5px] text-rose-300">
                {fieldErrors.servicingCostPerLotAud}
              </p>
            )}
          </div>

          <div>
            <label className="mb-0.5 block text-[10px] text-slate-400">Target Margin (%)</label>
            <input
              type="number"
              min={5}
              max={50}
              step={1}
              defaultValue={fin.targetMarginOnCostPct}
              onChange={(e) =>
                handleNumericField('targetMarginOnCostPct', 'Target Margin', e.target.value, 50)
              }
              className="w-full rounded-md border border-slate-400/20 bg-[#090e16] px-2 py-1.5 font-mono-tech text-[11px] text-white outline-none focus:border-[#3daee9]"
            />
            {fieldErrors.targetMarginOnCostPct && (
              <p className="mt-0.5 text-[9.5px] text-rose-300">
                {fieldErrors.targetMarginOnCostPct}
              </p>
            )}
          </div>
        </div>

        <label className="mt-2 flex cursor-pointer items-center justify-between text-[10.5px] text-slate-300">
          <span>ATO Division 75 GST Margin Scheme</span>
          <input
            type="checkbox"
            checked={fin.gstMarginScheme}
            onChange={(e) => onFinChange({ ...fin, gstMarginScheme: e.target.checked })}
            className="h-4 w-4 accent-[#3daee9]"
          />
        </label>
      </div>

      {/* Bankable PDF Memo + Provenance Disclosure */}
      <button
        type="button"
        onClick={onExportPdfMemo}
        className="inline-flex min-h-[42px] w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-[#3daee9]/45 bg-[#122437] px-3 py-2 text-[11.5px] font-bold text-sky-100 transition-colors hover:bg-[#19334d]"
      >
        <FileText size={14} />
        Export Bankable PDF Civil &amp; Acquisition Memo
      </button>

      <div className="flex items-start gap-1.5 rounded-md border border-slate-400/12 bg-[#0a0f18] px-2.5 py-2 text-[9.5px] leading-relaxed text-slate-400">
        <BookmarkCheck size={12} className="mt-0.5 shrink-0 text-sky-400" />
        <span>
          <strong>Provenance:</strong> {parcelProvenanceLabel}. Pre-feasibility civil &amp;
          acquisition screening only — verify against registered survey &amp; geotechnical report.
        </span>
      </div>
    </div>
  );
}
