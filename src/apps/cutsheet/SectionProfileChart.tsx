import { RotateCcw } from 'lucide-react';
import { useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { SectionProfilePoint } from '../../engines/earthworks/gridVolumeEngine';

export interface SectionProfileChartProps {
  profile: readonly SectionProfilePoint[];
  targetFflAHD: number;
  compact?: boolean;
  onResetTransect?: () => void;
}

interface PlotPoint {
  x: number;
  existingY: number;
  proposedY: number;
  chainageM: number;
  existingAHD: number;
  proposedAHD: number;
  cutFillM: number;
}

/**
 * Builds closed SVG polygon paths for contiguous Cut (existing > proposed) or
 * Fill (proposed > existing) intervals, interpolating exact zero-crossing points
 * so shading never bleeds across the design grade line.
 */
function buildZonePolygons(
  pts: readonly PlotPoint[],
  mode: 'cut' | 'fill',
): string[] {
  if (pts.length < 2) return [];

  const polygons: string[] = [];
  let activeTop: Array<[number, number]> = [];
  let activeBottom: Array<[number, number]> = [];

  const flush = () => {
    if (activeTop.length >= 2 && activeBottom.length >= 2) {
      const ring = [...activeTop, ...activeBottom.slice().reverse()];
      const path =
        ring
          .map(
            ([x, y], idx) =>
              `${idx === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`,
          )
          .join(' ') + ' Z';
      polygons.push(path);
    }
    activeTop = [];
    activeBottom = [];
  };

  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    const da = mode === 'cut' ? a.cutFillM : -a.cutFillM;
    const db = mode === 'cut' ? b.cutFillM : -b.cutFillM;

    const aIn = da > 0.0005;
    const bIn = db > 0.0005;

    const topY = (p: PlotPoint) =>
      mode === 'cut' ? p.existingY : p.proposedY;
    const botY = (p: PlotPoint) =>
      mode === 'cut' ? p.proposedY : p.existingY;

    if (aIn && bIn) {
      if (activeTop.length === 0) {
        activeTop.push([a.x, topY(a)]);
        activeBottom.push([a.x, botY(a)]);
      }
      activeTop.push([b.x, topY(b)]);
      activeBottom.push([b.x, botY(b)]);
    } else if (aIn && !bIn) {
      if (activeTop.length === 0) {
        activeTop.push([a.x, topY(a)]);
        activeBottom.push([a.x, botY(a)]);
      }
      const denom = da - db;
      const t = Math.abs(denom) < 1e-9 ? 0.5 : Math.min(1, Math.max(0, da / denom));
      const cx = a.x + (b.x - a.x) * t;
      const cy = a.proposedY + (b.proposedY - a.proposedY) * t;
      activeTop.push([cx, cy]);
      activeBottom.push([cx, cy]);
      flush();
    } else if (!aIn && bIn) {
      const denom = da - db;
      const t = Math.abs(denom) < 1e-9 ? 0.5 : Math.min(1, Math.max(0, da / denom));
      const cx = a.x + (b.x - a.x) * t;
      const cy = a.proposedY + (b.proposedY - a.proposedY) * t;
      activeTop = [
        [cx, cy],
        [b.x, topY(b)],
      ];
      activeBottom = [
        [cx, cy],
        [b.x, botY(b)],
      ];
    } else {
      flush();
    }
  }
  flush();

  return polygons;
}

/**
 * Responsive SVG Cross-Section Profile (A–A') plotting existing natural ground (AHD)
 * against proposed FFL grading plane with amber Cut and emerald Fill shading.
 */
export function SectionProfileChart({
  profile,
  targetFflAHD,
  compact = false,
  onResetTransect,
}: SectionProfileChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const svgW = 680;
  const svgH = compact ? 168 : 268;
  const padL = 54;
  const padR = 18;
  const padT = 22;
  const padB = 34;
  const plotW = svgW - padL - padR;
  const plotH = svgH - padT - padB;

  const computed = useMemo(() => {
    if (profile.length < 2) return null;

    let minElev = Number.POSITIVE_INFINITY;
    let maxElev = Number.NEGATIVE_INFINITY;
    let maxCut = 0;
    let maxFill = 0;

    for (const pt of profile) {
      minElev = Math.min(minElev, pt.existingAHD, pt.proposedAHD);
      maxElev = Math.max(maxElev, pt.existingAHD, pt.proposedAHD);
      if (pt.cutFillM > maxCut) maxCut = pt.cutFillM;
      if (pt.cutFillM < 0 && -pt.cutFillM > maxFill) maxFill = -pt.cutFillM;
    }

    const totalLengthM = Math.max(
      1,
      profile[profile.length - 1]?.chainageM ?? 1,
    );
    const rawSpan = Math.max(1.5, maxElev - minElev);
    const yPad = Math.max(0.6, rawSpan * 0.16);
    const yMin = minElev - yPad;
    const yMax = maxElev + yPad;
    const ySpan = Math.max(0.5, yMax - yMin);

    const toX = (chainageM: number) =>
      padL + (chainageM / totalLengthM) * plotW;
    const toY = (ahd: number) =>
      padT + plotH - ((ahd - yMin) / ySpan) * plotH;

    const plotPoints: PlotPoint[] = profile.map((pt) => ({
      x: toX(pt.chainageM),
      existingY: toY(pt.existingAHD),
      proposedY: toY(pt.proposedAHD),
      chainageM: pt.chainageM,
      existingAHD: pt.existingAHD,
      proposedAHD: pt.proposedAHD,
      cutFillM: pt.cutFillM,
    }));

    const existingPath = plotPoints
      .map(
        (p, idx) =>
          `${idx === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.existingY.toFixed(1)}`,
      )
      .join(' ');

    const proposedPath = plotPoints
      .map(
        (p, idx) =>
          `${idx === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.proposedY.toFixed(1)}`,
      )
      .join(' ');

    const cutPolygons = buildZonePolygons(plotPoints, 'cut');
    const fillPolygons = buildZonePolygons(plotPoints, 'fill');

    const yTickCount = compact ? 4 : 5;
    const yTicks: Array<{ ahd: number; y: number }> = [];
    for (let i = 0; i < yTickCount; i += 1) {
      const frac = i / (yTickCount - 1);
      const ahd = yMin + frac * ySpan;
      yTicks.push({ ahd, y: toY(ahd) });
    }

    const xTickCount = 5;
    const xTicks: Array<{ chainageM: number; x: number }> = [];
    for (let i = 0; i < xTickCount; i += 1) {
      const frac = i / (xTickCount - 1);
      const ch = totalLengthM * frac;
      xTicks.push({ chainageM: ch, x: toX(ch) });
    }

    const fflLineY = toY(targetFflAHD);

    return {
      plotPoints,
      existingPath,
      proposedPath,
      cutPolygons,
      fillPolygons,
      yTicks,
      xTicks,
      totalLengthM,
      maxCut,
      maxFill,
      fflLineY,
    };
  }, [compact, padL, padT, plotH, plotW, profile, targetFflAHD]);

  if (!computed) {
    return (
      <div
        data-testid="cutsheet-section-chart"
        className="flex h-32 items-center justify-center rounded-lg border border-slate-400/12 bg-[#0d1117] text-xs text-slate-400"
      >
        No section transect samples available.
      </div>
    );
  }

  const clampedHoverIdx =
    hoverIdx !== null
      ? Math.min(computed.plotPoints.length - 1, Math.max(0, hoverIdx))
      : null;
  const activeProbe =
    clampedHoverIdx !== null ? computed.plotPoints[clampedHoverIdx] : null;

  const handlePointerMove = (evt: ReactPointerEvent<SVGSVGElement>) => {
    const rect = evt.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const svgX = ((evt.clientX - rect.left) / rect.width) * svgW;
    const frac = Math.min(1, Math.max(0, (svgX - padL) / plotW));
    const idx = Math.round(frac * (computed.plotPoints.length - 1));
    setHoverIdx(idx);
  };

  return (
    <div
      data-testid="cutsheet-section-chart"
      className="flex flex-col rounded-xl border border-slate-400/12 bg-[#0d1117] overflow-hidden"
    >
      {/* Top Strip: Title, Depth KPIs, & Legend */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-400/10 bg-[#121821] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="font-semibold tracking-wide text-slate-200 uppercase">
            Section A–A&prime; Profile
          </span>
          <span className="font-mono-tech rounded border border-slate-400/15 bg-[#0d1117] px-1.5 py-0.5 text-[10px] text-slate-300">
            Length {computed.totalLengthM.toFixed(0)} m
          </span>
          <span className="font-mono-tech rounded border border-amber-400/30 bg-amber-500/12 px-1.5 py-0.5 text-[10px] text-amber-300">
            Max Cut {computed.maxCut.toFixed(2)} m
          </span>
          <span className="font-mono-tech rounded border border-emerald-400/30 bg-emerald-500/12 px-1.5 py-0.5 text-[10px] text-emerald-300">
            Max Fill {computed.maxFill.toFixed(2)} m
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 text-[10px] font-mono-tech text-slate-300">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-xs bg-amber-400" />
            Cut
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-xs bg-emerald-400" />
            Fill
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-0.5 w-3 bg-slate-200" />
            Natural AHD
          </span>
          <span className="inline-flex items-center gap-1 text-sky-300">
            <span className="h-0.5 w-3 bg-[#3daee9]" />
            Design FFL
          </span>
          {onResetTransect && (
            <button
              type="button"
              onClick={onResetTransect}
              className="inline-flex cursor-pointer items-center gap-1 rounded border border-slate-400/20 bg-slate-800/70 px-1.5 py-0.5 text-[10px] text-slate-200 transition-colors hover:border-[#3daee9]/50 hover:text-white"
              title="Reset A–A' transect across parcel centroid"
            >
              <RotateCcw size={10} />
              Reset A–A&prime;
            </button>
          )}
        </div>
      </div>

      {/* Responsive SVG Plot */}
      <div className="relative w-full">
        <svg
          viewBox={`0 0 ${svgW} ${svgH}`}
          className="block h-auto w-full select-none touch-pan-y"
          role="img"
          aria-label={`Terrain cross-section profile A to A prime spanning ${computed.totalLengthM.toFixed(0)} metres`}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setHoverIdx(null)}
        >
          <defs>
            <pattern
              id="cutsheet-cut-hatch"
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width="6" height="6" fill="rgba(245, 158, 11, 0.24)" />
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="6"
                stroke="rgba(251, 191, 36, 0.38)"
                strokeWidth="1.4"
              />
            </pattern>
            <pattern
              id="cutsheet-fill-hatch"
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(-45)"
            >
              <rect width="6" height="6" fill="rgba(16, 185, 129, 0.22)" />
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="6"
                stroke="rgba(52, 211, 153, 0.36)"
                strokeWidth="1.3"
              />
            </pattern>
          </defs>

          {/* Horizontal AHD Grid Lines & Labels */}
          {computed.yTicks.map((tick, idx) => (
            <g key={`y-${idx}`}>
              <line
                x1={padL}
                y1={tick.y}
                x2={svgW - padR}
                y2={tick.y}
                stroke="rgba(148, 163, 184, 0.14)"
                strokeWidth="1"
              />
              <text
                x={padL - 7}
                y={tick.y + 3.5}
                textAnchor="end"
                fill="#94a3b8"
                fontSize="9.5"
                fontFamily="JetBrains Mono, ui-monospace, monospace"
              >
                {tick.ahd.toFixed(1)}m
              </text>
            </g>
          ))}

          {/* Target FFL Reference Horizontal Guide */}
          {computed.fflLineY >= padT && computed.fflLineY <= padT + plotH && (
            <line
              x1={padL}
              y1={computed.fflLineY}
              x2={svgW - padR}
              y2={computed.fflLineY}
              stroke="rgba(61, 174, 233, 0.32)"
              strokeDasharray="4 4"
              strokeWidth="1"
            />
          )}

          {/* Vertical Chainage Ticks */}
          {computed.xTicks.map((tick, idx) => (
            <g key={`x-${idx}`}>
              <line
                x1={tick.x}
                y1={padT}
                x2={tick.x}
                y2={padT + plotH}
                stroke="rgba(148, 163, 184, 0.08)"
                strokeWidth="1"
              />
              <text
                x={tick.x}
                y={svgH - 11}
                textAnchor="middle"
                fill="#94a3b8"
                fontSize="9.5"
                fontFamily="JetBrains Mono, ui-monospace, monospace"
              >
                {tick.chainageM.toFixed(0)}m
              </text>
            </g>
          ))}

          {/* Axes */}
          <line
            x1={padL}
            y1={padT}
            x2={padL}
            y2={padT + plotH}
            stroke="rgba(148, 163, 184, 0.28)"
            strokeWidth="1"
          />
          <line
            x1={padL}
            y1={padT + plotH}
            x2={svgW - padR}
            y2={padT + plotH}
            stroke="rgba(148, 163, 184, 0.28)"
            strokeWidth="1"
          />

          {/* A and A' End Callouts */}
          <text
            x={padL + 4}
            y={padT - 7}
            fill="#6ee7b7"
            fontSize="10"
            fontWeight="700"
            fontFamily="JetBrains Mono, ui-monospace, monospace"
          >
            A (Start)
          </text>
          <text
            x={svgW - padR - 4}
            y={padT - 7}
            textAnchor="end"
            fill="#fcd34d"
            fontSize="10"
            fontWeight="700"
            fontFamily="JetBrains Mono, ui-monospace, monospace"
          >
            A&prime; (End)
          </text>
          <text
            x={padL - 8}
            y={padT - 7}
            textAnchor="end"
            fill="#64748b"
            fontSize="9"
            fontFamily="JetBrains Mono, ui-monospace, monospace"
          >
            m AHD
          </text>

          {/* Cut & Fill Shaded Polygons */}
          {computed.cutPolygons.map((d, idx) => (
            <path key={`cut-${idx}`} d={d} fill="url(#cutsheet-cut-hatch)" />
          ))}
          {computed.fillPolygons.map((d, idx) => (
            <path key={`fill-${idx}`} d={d} fill="url(#cutsheet-fill-hatch)" />
          ))}

          {/* Existing Natural Ground Line */}
          <path
            d={computed.existingPath}
            fill="none"
            stroke="#e2e8f0"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Proposed FFL Design Grade Line */}
          <path
            d={computed.proposedPath}
            fill="none"
            stroke="#3daee9"
            strokeWidth="2.2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Interactive Chainage Hover Probe */}
          {activeProbe && (
            <g>
              <line
                x1={activeProbe.x}
                y1={padT}
                x2={activeProbe.x}
                y2={padT + plotH}
                stroke="rgba(125, 211, 252, 0.6)"
                strokeDasharray="3 2"
                strokeWidth="1"
              />
              <circle
                cx={activeProbe.x}
                cy={activeProbe.existingY}
                r="4"
                fill="#e2e8f0"
                stroke="#0f172a"
                strokeWidth="1.5"
              />
              <circle
                cx={activeProbe.x}
                cy={activeProbe.proposedY}
                r="4"
                fill="#3daee9"
                stroke="#0f172a"
                strokeWidth="1.5"
              />
            </g>
          )}
        </svg>
      </div>

      {/* Interactive Chainage Telemetry Footer */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-400/10 bg-[#11161e] px-3 py-1.5 font-mono-tech text-[10.5px] text-slate-400">
        {activeProbe ? (
          <>
            <span>
              CH <strong className="text-slate-100">{activeProbe.chainageM.toFixed(1)} m</strong>
            </span>
            <span>
              Natural{' '}
              <strong className="text-slate-100">
                {activeProbe.existingAHD.toFixed(2)} m AHD
              </strong>
            </span>
            <span>
              Design{' '}
              <strong className="text-sky-300">
                {activeProbe.proposedAHD.toFixed(2)} m AHD
              </strong>
            </span>
            <span
              className={
                activeProbe.cutFillM > 0.02
                  ? 'font-semibold text-amber-300'
                  : activeProbe.cutFillM < -0.02
                    ? 'font-semibold text-emerald-300'
                    : 'font-semibold text-sky-300'
              }
            >
              {activeProbe.cutFillM > 0.02
                ? `CUT +${activeProbe.cutFillM.toFixed(2)} m`
                : activeProbe.cutFillM < -0.02
                  ? `FILL ${Math.abs(activeProbe.cutFillM).toFixed(2)} m`
                  : 'ON GRADE (0.00 m)'}
            </span>
          </>
        ) : (
          <>
            <span>Hover or scrub cross-section to inspect chainage &amp; cut/fill depth</span>
            <span className="text-sky-300">
              Datum FFL {targetFflAHD.toFixed(2)} m AHD
            </span>
          </>
        )}
      </div>
    </div>
  );
}
