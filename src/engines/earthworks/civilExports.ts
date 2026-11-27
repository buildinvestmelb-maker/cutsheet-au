import type { Feature, FeatureCollection, LineString } from 'geojson';
import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import type { GradingPadSpec, SiteProject } from '../../bridge/types';
import {
  MGA2020_MAX_ZONE,
  MGA2020_MIN_ZONE,
  wgs84ToMga2020,
} from '../geo/auGeoKernel';
import {
  getGridCellMetrics,
  gridCellToLngLat,
  type ElevationGrid,
} from './demLoader';
import {
  DEFAULT_ROCK_BREAKOUT_RATE_AUD,
  DEFAULT_TOPSOIL_RATE_AUD,
  SOIL_RATES_AUD,
  TIPPER_TRUCK_CAPACITY_M3,
  type EarthworksGridResult,
  type GradingStrategy,
} from './gridVolumeEngine';
import type { HydrologyAnalysisResult } from './hydrologyEngine';

const STRATEGY_LABELS: Readonly<Record<GradingStrategy, string>> = {
  'best-fit-plane': 'Best-Fit Plane (OLS)',
  'auto-terrace': 'Auto-Terrace Benches',
  'max-grade': 'Max Grade % Clamped',
  'flat-pad': 'Flat Pad (Uniform FFL)',
};

const PDF_AUD_FORMAT = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
});

const PDF_NUM_FORMAT = new Intl.NumberFormat('en-AU', {
  maximumFractionDigits: 1,
});

function formatPdfAud(val: number): string {
  if (!Number.isFinite(val)) return '$0';
  return PDF_AUD_FORMAT.format(Math.round(val));
}

function escapeCsvCell(value: string | number): string {
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generates an RFC 4180 Civil Bill of Quantities (BOQ) CSV for CutSheet AU bulk earthworks.
 */
export function buildEarthworksBoqCsv(
  project: SiteProject,
  result: EarthworksGridResult,
): string {
  const rates = SOIL_RATES_AUD[result.soilClass];
  const onSiteFillM3 = Math.min(result.compactedCutM3, result.fillVolumeM3);
  const haulOrImportQty =
    result.netBalanceM3 >= 0
      ? result.importExportVolumeM3 * result.cutSwellFactor
      : result.importExportVolumeM3;
  const haulOrImportUnitRate =
    result.netBalanceM3 >= 0 ? rates.haulRate : rates.importRate;
  const haulOrImportDesc =
    result.netBalanceM3 >= 0
      ? `Off-site Spoil Haul & Tip (${result.tipperLoads} x ${TIPPER_TRUCK_CAPACITY_M3}m³ truck-and-dog loads)`
      : `Imported Engineered Fill Supply & Delivery (${result.tipperLoads} x ${TIPPER_TRUCK_CAPACITY_M3}m³ loads)`;

  const rows: Array<Array<string | number>> = [
    ['Item', 'Description', 'Basis / Spec', 'Unit', 'Quantity', 'Rate (AUD)', 'Amount (AUD)'],
    [
      'META-1',
      `Project: ${project.name}`,
      `${project.location.state} | ${project.location.mgaEpsg} (Zone ${project.location.mgaZone}) | ${STRATEGY_LABELS[result.gradingStrategy]}`,
      'm²',
      result.insideAreaSqm.toFixed(2),
      result.costPerSqmAud.toFixed(2),
      result.totalPackageAud.toFixed(2),
    ],
    [
      'EW-01',
      `Bulk Cut Excavation — ${rates.label}`,
      `${rates.as2870Class} | Swell ${result.cutSwellFactor.toFixed(2)}x`,
      'm³ (BCM)',
      result.cutVolumeM3.toFixed(2),
      rates.cutRate.toFixed(2),
      result.cutCostAud.toFixed(2),
    ],
    [
      'EW-02',
      'On-Site Fill Placement & Compaction',
      `Compaction factor ${result.fillCompactionFactor.toFixed(2)}x | Target FFL ${result.targetFflAHD.toFixed(2)} m AHD`,
      'm³ (CCM)',
      onSiteFillM3.toFixed(2),
      rates.fillRate.toFixed(2),
      result.fillPlacementCostAud.toFixed(2),
    ],
    [
      'EW-03',
      haulOrImportDesc,
      `Net Balance: ${result.netBalanceM3.toFixed(2)} m³ (${result.balanceDirection})`,
      result.netBalanceM3 >= 0 ? 'm³ (LCM)' : 'm³ (CCM)',
      haulOrImportQty.toFixed(2),
      haulOrImportUnitRate.toFixed(2),
      result.haulOrImportCostAud.toFixed(2),
    ],
  ];

  if (result.rockBreakoutCostAud > 0) {
    rows.push([
      'EW-04',
      `Basalt / Rock Hydraulic Breakout (${result.rockBreakoutPct.toFixed(0)}% of Cut)`,
      'Provisional rock hammering & ripping allowance',
      'm³ (BCM)',
      result.rockBreakoutVolumeM3.toFixed(2),
      DEFAULT_ROCK_BREAKOUT_RATE_AUD.toFixed(2),
      result.rockBreakoutCostAud.toFixed(2),
    ]);
  }

  if (result.topsoilCostAud > 0) {
    rows.push([
      'EW-05',
      `Topsoil Strip, Stockpile & Respread (${Math.round(result.topsoilDepthM * 1000)}mm)`,
      'Site clearing & respread across parcel footprint',
      'm³',
      result.topsoilVolumeM3.toFixed(2),
      DEFAULT_TOPSOIL_RATE_AUD.toFixed(2),
      result.topsoilCostAud.toFixed(2),
    ]);
  }

  rows.push(
    [
      'EW-SUB',
      'Subtotal — Bulk Earthworks Package',
      `Batter 1:${result.batterSlopeRatio} | Max Cut ${result.maxCutDepthM.toFixed(2)}m / Max Fill ${result.maxFillDepthM.toFixed(2)}m`,
      'LS',
      '1',
      result.bulkEarthworksCostAud.toFixed(2),
      result.bulkEarthworksCostAud.toFixed(2),
    ],
    [
      'RW-01',
      `Retaining Walls (${result.retainingWallHeightM.toFixed(1)}m nominal height)`,
      'Auto-detected grade steps > 0.6m / user override',
      'lm',
      result.retainingWallLengthM.toFixed(2),
      result.retainingWallRatePerLmAud.toFixed(2),
      result.retainingWallCostAud.toFixed(2),
    ],
    [
      'TOTAL',
      'TOTAL BULK EARTHWORKS & RETAINING PACKAGE',
      `Cost per m²: $${result.costPerSqmAud.toFixed(2)} / m² | Est. ${result.estimatedLots} lots (${formatPdfAud(result.costPerLotAud)}/lot)`,
      'AUD',
      '1',
      result.totalPackageAud.toFixed(2),
      result.totalPackageAud.toFixed(2),
    ],
  );

  return `${rows.map((r) => r.map(escapeCsvCell).join(',')).join('\r\n')}\r\n`;
}

/**
 * Packages CutSheet AU parcel boundary, named grading pads, and elevation contours
 * into a single formatted GeoJSON FeatureCollection string.
 */
export function buildEarthworksGeoJson(
  contours: FeatureCollection,
  pads?: GradingPadSpec[],
  boundary?: FeatureCollection,
): string {
  const features: Feature[] = [];

  if (boundary && Array.isArray(boundary.features)) {
    for (const feat of boundary.features) {
      features.push({
        type: 'Feature',
        properties: {
          ...(feat.properties ?? {}),
          layer: 'parcel-boundary',
        },
        geometry: feat.geometry,
      });
    }
  }

  if (Array.isArray(pads)) {
    for (const pad of pads) {
      if (!pad.boundaryGeoJson || !Array.isArray(pad.boundaryGeoJson.features)) {
        continue;
      }
      for (const feat of pad.boundaryGeoJson.features) {
        features.push({
          type: 'Feature',
          properties: {
            ...(feat.properties ?? {}),
            layer: 'grading-pad',
            padId: pad.id,
            name: pad.name,
            targetFflAHD: pad.targetFflAHD,
            slopePct: pad.slopePct,
            batterSlopeRatio: pad.batterSlopeRatio,
          },
          geometry: feat.geometry,
        });
      }
    }
  }

  if (contours && Array.isArray(contours.features)) {
    for (const feat of contours.features) {
      features.push({
        type: 'Feature',
        properties: {
          ...(feat.properties ?? {}),
          layer: 'elevation-contour',
        },
        geometry: feat.geometry,
      });
    }
  }

  const combined: FeatureCollection = {
    type: 'FeatureCollection',
    features,
  };

  return JSON.stringify(combined, null, 2);
}

/**
 * Exports a valid LandXML 1.2 TIN Surface (compatible with 12d Model & Autodesk Civil 3D)
 * projected into GDA2020 / MGA2020 meters (Northing Easting Elevation AHD).
 */
export function buildLandXmlSurface(
  project: SiteProject,
  grid: ElevationGrid,
): string {
  if (grid.rows < 2 || grid.cols < 2) {
    throw new Error(
      'Cannot export LandXML surface: ElevationGrid must be at least 2×2.',
    );
  }

  const nowIso = new Date().toISOString();
  const datePart = nowIso.slice(0, 10);
  const timePart = nowIso.slice(11, 19);
  const { spanEastM, spanNorthM } = getGridCellMetrics(grid);
  const area2D = (spanEastM * spanNorthM).toFixed(2);
  const safeProjectName = escapeXml(project.name || 'devaware-os Site');
  const safeSurfaceName = escapeXml(
    `${project.name || 'Site'} - ${grid.sourceLabel}`,
  );
  const epsgNumeric = grid.mgaEpsg.replace(/^EPSG:/i, '');

  const pntLines: string[] = [];
  for (let r = 0; r < grid.rows; r += 1) {
    for (let c = 0; c < grid.cols; c += 1) {
      const id = r * grid.cols + c + 1; // 1-indexed LandXML P id
      const [lng, lat] = gridCellToLngLat(grid, r, c);
      const { easting, northing } = wgs84ToMga2020(lng, lat, grid.mgaZone);
      const elev = grid.elevationsAHD[r * grid.cols + c];
      // LandXML 1.2 <P> vertex order: Northing Easting Elevation (AHD meters)
      pntLines.push(
        `          <P id="${id}">${northing.toFixed(3)} ${easting.toFixed(3)} ${elev.toFixed(3)}</P>`,
      );
    }
  }

  const faceLines: string[] = [];
  for (let r = 0; r < grid.rows - 1; r += 1) {
    for (let c = 0; c < grid.cols - 1; c += 1) {
      const p1 = r * grid.cols + c + 1;
      const p2 = r * grid.cols + (c + 1) + 1;
      const p3 = (r + 1) * grid.cols + c + 1;
      const p4 = (r + 1) * grid.cols + (c + 1) + 1;
      faceLines.push(`          <F>${p1} ${p3} ${p2}</F>`);
      faceLines.push(`          <F>${p2} ${p3} ${p4}</F>`);
    }
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2" date="${datePart}" time="${timePart}">`,
    '  <Units>',
    '    <Metric areaUnit="squareMeter" linearUnit="meter" volumeUnit="cubicMeter" temperatureUnit="celsius" pressureUnit="milliBars"/>',
    '  </Units>',
    `  <CoordinateSystem epsgCode="${escapeXml(epsgNumeric)}" horizontalDatum="GDA2020" verticalDatum="AHD" name="${escapeXml(grid.mgaEpsg)}"/>`,
    `  <Project name="${safeProjectName}" desc="Generated by devaware-os CutSheet AU"/>`,
    '  <Surfaces>',
    `    <Surface name="${safeSurfaceName}">`,
    `      <Definition surfType="TIN" area2DSurf="${area2D}" elevMin="${grid.minAHD.toFixed(3)}" elevMax="${grid.maxAHD.toFixed(3)}">`,
    '        <Pnts>',
    ...pntLines,
    '        </Pnts>',
    '        <Faces>',
    ...faceLines,
    '        </Faces>',
    '      </Definition>',
    '    </Surface>',
    '  </Surfaces>',
    '</LandXML>',
    '',
  ].join('\n');
}

/**
 * Exports elevation contour GeoJSON LineStrings to valid ASCII DXF (AC1015) projected
 * into GDA2020 / MGA2020 meters with CONTOUR_INDEX / CONTOUR_MINOR layers and Z elevation (code 38).
 */
export function buildEarthworksContoursDxf(
  contours: FeatureCollection,
  mgaZone: number,
): string {
  if (
    !Number.isInteger(mgaZone) ||
    mgaZone < MGA2020_MIN_ZONE ||
    mgaZone > MGA2020_MAX_ZONE
  ) {
    throw new RangeError(
      `Invalid MGA2020 zone "${String(mgaZone)}". Expected an integer between ${MGA2020_MIN_ZONE} and ${MGA2020_MAX_ZONE}.`,
    );
  }

  interface ProjectedContour {
    layer: string;
    elevationAHD: number;
    points: Array<[number, number]>;
  }

  const projected: ProjectedContour[] = [];
  let minE = Number.POSITIVE_INFINITY;
  let minN = Number.POSITIVE_INFINITY;
  let maxE = Number.NEGATIVE_INFINITY;
  let maxN = Number.NEGATIVE_INFINITY;

  for (const feat of contours.features) {
    if (feat.geometry?.type !== 'LineString') continue;
    const line = feat.geometry as LineString;
    if (!Array.isArray(line.coordinates) || line.coordinates.length < 2) {
      continue;
    }

    const isIndex = Boolean(feat.properties?.isIndex);
    const rawElev = feat.properties?.elevationAHD;
    const elevationAHD =
      typeof rawElev === 'number' && Number.isFinite(rawElev) ? rawElev : 0;
    const pts: Array<[number, number]> = [];

    for (const pos of line.coordinates) {
      if (
        !Array.isArray(pos) ||
        pos.length < 2 ||
        !Number.isFinite(pos[0]) ||
        !Number.isFinite(pos[1])
      ) {
        continue;
      }
      const { easting, northing } = wgs84ToMga2020(pos[0], pos[1], mgaZone);
      minE = Math.min(minE, easting);
      minN = Math.min(minN, northing);
      maxE = Math.max(maxE, easting);
      maxN = Math.max(maxN, northing);
      pts.push([easting, northing]);
    }

    if (pts.length >= 2) {
      projected.push({
        layer: isIndex ? 'CONTOUR_INDEX' : 'CONTOUR_MINOR',
        elevationAHD,
        points: pts,
      });
    }
  }

  if (!Number.isFinite(minE)) {
    minE = 0;
    minN = 0;
    maxE = 0;
    maxN = 0;
  }

  const lines: string[] = [
    '999',
    `devaware-os CutSheet AU Contours — GDA2020 / MGA2020 Zone ${mgaZone} (EPSG:${7800 + mgaZone})`,
    '0',
    'SECTION',
    '2',
    'HEADER',
    '9',
    '$ACADVER',
    '1',
    'AC1015',
    '9',
    '$INSUNITS',
    '70',
    '6',
    '9',
    '$EXTMIN',
    '10',
    minE.toFixed(3),
    '20',
    minN.toFixed(3),
    '30',
    '0.000',
    '9',
    '$EXTMAX',
    '10',
    maxE.toFixed(3),
    '20',
    maxN.toFixed(3),
    '30',
    '0.000',
    '0',
    'ENDSEC',
    '0',
    'SECTION',
    '2',
    'ENTITIES',
  ];

  for (const contour of projected) {
    lines.push(
      '0',
      'LWPOLYLINE',
      '100',
      'AcDbEntity',
      '8',
      contour.layer,
      '100',
      'AcDbPolyline',
      '90',
      String(contour.points.length),
      '70',
      '0',
      '38',
      contour.elevationAHD.toFixed(3),
    );
    for (const [easting, northing] of contour.points) {
      lines.push('10', easting.toFixed(3), '20', northing.toFixed(3));
    }
  }

  lines.push('0', 'ENDSEC', '0', 'EOF', '');
  return lines.join('\n');
}

/**
 * Exports all terrain cells as a GDA2020 / MGA2020 XYZ CSV point cloud
 * containing Easting, Northing, WGS84 Lng/Lat, Existing AHD, Proposed Design AHD,
 * Cut/Fill delta (m), and parcel membership flag.
 */
export function buildSurfaceXyzCsv(
  grid: ElevationGrid,
  result: EarthworksGridResult,
): string {
  const rows: Array<Array<string | number>> = [
    [
      'Easting_MGA2020_m',
      'Northing_MGA2020_m',
      'WGS84_Lng',
      'WGS84_Lat',
      'Existing_AHD_m',
      'Proposed_AHD_m',
      'CutFill_Delta_m',
      'Inside_Parcel',
      'CRS',
    ],
  ];

  for (let r = 0; r < grid.rows; r += 1) {
    for (let c = 0; c < grid.cols; c += 1) {
      const idx = r * grid.cols + c;
      const [lng, lat] = gridCellToLngLat(grid, r, c);
      const { easting, northing } = wgs84ToMga2020(lng, lat, grid.mgaZone);
      const existing = grid.elevationsAHD[idx];
      const proposed = result.proposedGrid[idx] ?? existing;
      const delta = result.deltaGrid[idx] ?? 0;
      const inside = result.insideMask[idx] === 1 ? 1 : 0;

      rows.push([
        easting.toFixed(3),
        northing.toFixed(3),
        lng.toFixed(7),
        lat.toFixed(7),
        existing.toFixed(3),
        proposed.toFixed(3),
        delta.toFixed(3),
        inside,
        grid.mgaEpsg,
      ]);
    }
  }

  return `${rows.map((r) => r.map(escapeCsvCell).join(',')).join('\r\n')}\r\n`;
}

/**
 * Generates a commercial-grade Australian Civil Earthworks & Hydrology Engineering Report PDF
 * using jsPDF + jspdf-autotable covering Terrain Developability, Grading Volumes, Civil Slope
 * Breakdown, D8 Overland Flow Hydrology, NDA, and Itemised Civil Siteworks Estimate (AUD).
 */
export function buildCutSheetPdfBlob(
  project: SiteProject,
  result: EarthworksGridResult,
  hydrology?: HydrologyAnalysisResult,
): Blob {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  const generatedDate = new Date().toLocaleDateString('en-AU', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  // Dark commercial header band
  doc.setFillColor(12, 18, 28);
  doc.rect(0, 0, pageW, 34, 'F');
  doc.setFillColor(61, 174, 233);
  doc.rect(0, 34, pageW, 1.2, 'F');

  doc.setTextColor(61, 174, 233);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('DEVAWARE-OS  •  CUTSHEET AU PRO', margin, 11);

  doc.setTextColor(245, 248, 252);
  doc.setFontSize(15);
  doc.text(project.name || 'Australian Civil Site Assessment', margin, 19);

  doc.setTextColor(175, 190, 208);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const subLine = [
    project.location.address || 'Australia',
    project.location.lga,
    `${project.location.state} • ${project.location.mgaEpsg} (Zone ${project.location.mgaZone})`,
  ]
    .filter(Boolean)
    .join('  |  ');
  doc.text(subLine, margin, 26);

  doc.setTextColor(148, 163, 184);
  doc.text(`Generated ${generatedDate}`, pageW - margin, 11, { align: 'right' });
  doc.setTextColor(52, 211, 153);
  doc.setFont('helvetica', 'bold');
  doc.text(
    `Developability ${result.developability.score}/100 (${result.developability.riskLevel})`,
    pageW - margin,
    26,
    { align: 'right' },
  );

  // Section 1: Executive Earthworks & Grading Summary
  let cursorY = 43;
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('1. Executive Earthworks & Grading Summary', margin, cursorY);
  cursorY += 4;

  const grossHa = result.insideAreaSqm / 10_000;
  const ndaHa = hydrology?.netDevelopableAreaHa ?? grossHa * 0.78;
  const ndaPct = hydrology?.netDevelopablePct ?? 78;

  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin },
    theme: 'grid',
    headStyles: { fillColor: [20, 30, 44], textColor: [236, 244, 252], fontSize: 8.5 },
    bodyStyles: { fontSize: 8.5, textColor: [30, 41, 59] },
    head: [['Metric', 'Value', 'Engineering Basis']],
    body: [
      [
        'Grading Strategy',
        STRATEGY_LABELS[result.gradingStrategy],
        `Datum FFL ${result.targetFflAHD.toFixed(2)} m AHD • Batter 1:${result.batterSlopeRatio}`,
      ],
      [
        'Gross Parcel / Net Developable Area',
        `${grossHa.toFixed(2)} ha  /  ${ndaHa.toFixed(2)} ha (${ndaPct.toFixed(0)}%)`,
        `Est. yield basis ${result.estimatedLots} lots`,
      ],
      [
        'Total Bulk Cut / Total Bulk Fill',
        `${PDF_NUM_FORMAT.format(result.cutVolumeM3)} m³  /  ${PDF_NUM_FORMAT.format(result.fillVolumeM3)} m³`,
        `Cut:Fill Ratio ${result.cutFillRatio.toFixed(2)}:1 • Max Cut ${result.maxCutDepthM.toFixed(2)}m / Fill ${result.maxFillDepthM.toFixed(2)}m`,
      ],
      [
        'Net Earthworks Balance',
        `${result.netBalanceM3 >= 0 ? '+' : ''}${PDF_NUM_FORMAT.format(result.netBalanceM3)} m³ (${result.balanceDirection.toUpperCase()})`,
        `${PDF_NUM_FORMAT.format(result.tipperLoads)} truck-and-dog loads (${TIPPER_TRUCK_CAPACITY_M3} m³)`,
      ],
      [
        'Average Existing → Design Grade',
        `${result.avgExistingGradePct.toFixed(1)}%  →  ${result.avgDesignGradePct.toFixed(1)}%`,
        `${SOIL_RATES_AUD[result.soilClass].as2870Class} (Swell ${result.cutSwellFactor.toFixed(2)}x, Comp ${result.fillCompactionFactor.toFixed(2)}x)`,
      ],
      [
        'Total Est. Civil Siteworks',
        `${formatPdfAud(result.totalPackageAud)} AUD`,
        `${formatPdfAud(result.costPerLotAud)}/lot  •  ${formatPdfAud(result.costPerHaAud)}/ha  •  $${result.costPerSqmAud.toFixed(2)}/m²`,
      ],
    ],
  });

  cursorY =
    ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable
      ?.finalY ?? cursorY + 46) + 8;

  // Section 2: Itemised Civil Siteworks Estimate (AUD)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text('2. Itemised Civil Siteworks Estimate (AUD)', margin, cursorY);
  cursorY += 4;

  const rates = SOIL_RATES_AUD[result.soilClass];
  const onSiteFillM3 = Math.min(result.compactedCutM3, result.fillVolumeM3);
  const haulQty =
    result.netBalanceM3 >= 0
      ? result.importExportVolumeM3 * result.cutSwellFactor
      : result.importExportVolumeM3;

  const costBody: string[][] = [
    [
      'Bulk Cut Excavation & On-Site Placement',
      `${PDF_NUM_FORMAT.format(result.cutVolumeM3)} m³ cut / ${PDF_NUM_FORMAT.format(onSiteFillM3)} m³ fill`,
      formatPdfAud(result.cutCostAud + result.fillPlacementCostAud),
    ],
    [
      result.netBalanceM3 >= 0
        ? 'Off-Site Spoil Export & Tip'
        : 'Imported Engineered Fill Supply',
      `${PDF_NUM_FORMAT.format(haulQty)} m³ (${result.tipperLoads} loads)`,
      formatPdfAud(result.haulOrImportCostAud),
    ],
  ];

  if (result.rockBreakoutCostAud > 0) {
    costBody.push([
      `Basalt / Rock Breakout (${result.rockBreakoutPct.toFixed(0)}%)`,
      `${PDF_NUM_FORMAT.format(result.rockBreakoutVolumeM3)} m³`,
      formatPdfAud(result.rockBreakoutCostAud),
    ]);
  }

  costBody.push([
    `Retaining Walls (${result.retainingWallHeightM.toFixed(1)}m nominal)`,
    `${PDF_NUM_FORMAT.format(result.retainingWallLengthM)} lm @ ${formatPdfAud(result.retainingWallRatePerLmAud)}/lm`,
    formatPdfAud(result.retainingWallCostAud),
  ]);

  if (result.topsoilCostAud > 0) {
    costBody.push([
      `Topsoil Strip & Respread (${Math.round(result.topsoilDepthM * 1000)}mm)`,
      `${PDF_NUM_FORMAT.format(result.topsoilVolumeM3)} m³`,
      formatPdfAud(result.topsoilCostAud),
    ]);
  }

  costBody.push([
    'TOTAL CIVIL EARTHWORKS & RETAINING PACKAGE',
    `${rates.label} • ${result.estimatedLots} lots`,
    `${formatPdfAud(result.totalPackageAud)} AUD`,
  ]);

  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin },
    theme: 'striped',
    headStyles: { fillColor: [20, 30, 44], textColor: [236, 244, 252], fontSize: 8.5 },
    bodyStyles: { fontSize: 8.5, textColor: [30, 41, 59] },
    columnStyles: { 2: { halign: 'right', fontStyle: 'bold' } },
    head: [['Civil Cost Item', 'Quantity / Specification', 'Estimate (AUD)']],
    body: costBody,
  });

  cursorY =
    ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable
      ?.finalY ?? cursorY + 46) + 8;

  // Section 3: Civil Slope Breakdown & D8 Overland Flow Hydrology
  if (hydrology) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text('3. Terrain Slope Breakdown & D8 Hydrology Screening', margin, cursorY);
    cursorY += 4;

    const hydroRows: string[][] = hydrology.slopeBands.map((band) => [
      `Slope Band: ${band.label}`,
      `${band.pct.toFixed(1)}% of parcel`,
      `${band.areaHa.toFixed(2)} ha`,
    ]);
    hydroRows.push(
      [
        'D8 Overland Flow Reaches',
        `Threshold ${hydrology.catchmentThresholdHa.toFixed(2)} ha (${hydrology.activeReaches} reaches)`,
        `Peak ${hydrology.peakCatchmentHa.toFixed(2)} ha`,
      ],
      [
        'Low-Point Ponding Depressions (>0.15m)',
        `${hydrology.depressions.length} enclosed basin(s) • Max ${hydrology.maxDepressionDepthM.toFixed(2)} m`,
        `${PDF_NUM_FORMAT.format(hydrology.naturalStorageM3)} m³`,
      ],
    );

    autoTable(doc, {
      startY: cursorY,
      margin: { left: margin, right: margin },
      theme: 'grid',
      headStyles: { fillColor: [20, 30, 44], textColor: [236, 244, 252], fontSize: 8.5 },
      bodyStyles: { fontSize: 8.5, textColor: [30, 41, 59] },
      columnStyles: { 2: { halign: 'right' } },
      head: [['Terrain / Hydrology Metric', 'Detail', 'Area / Volume']],
      body: hydroRows,
    });
  }

  // Footer disclaimer
  const pageH = doc.internal.pageSize.getHeight();
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(
    'Preliminary civil feasibility screening generated by devaware-os CutSheet AU Pro (GDA2020 / AHD). Verify against certified survey & geotechnical report prior to construction.',
    margin,
    pageH - 9,
  );

  return doc.output('blob');
}

