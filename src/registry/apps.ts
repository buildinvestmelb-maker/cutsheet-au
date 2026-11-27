export type AppId =
  | 'cutsheet-au'
  | 'feaso-os'
  | 'formgen-au'
  | 'enviro-sim-au'
  | 'file-explorer'
  | 'project-inspector';

export type AppRuntime = 'iframe' | 'builtin';

export type AppCategory =
  | 'Terrain & Civil'
  | 'Feasibility'
  | 'Massing & Yield'
  | 'Environment & Risk'
  | 'System';

export type AppStatus = 'live';

export interface AppDefinition {
  id: AppId;
  name: string;
  shortName: string;
  description: string;
  category: AppCategory;
  runtime: AppRuntime;
  status: AppStatus;
  singleInstance: boolean;
  defaultSize: {
    width: number;
    height: number;
  };
  minSize: {
    width: number;
    height: number;
  };
  /** Iframe source URL for live micro-apps. */
  url?: string;
  /** Public GitHub repository source URL for transparency. */
  repoUrl?: string;
  /** Whether this app appears in the 4-app industry catalog in the App Library. */
  isIndustryApp: boolean;
  /** Default pinned state on desktop / launcher. */
  defaultPinned: boolean;
  /** Icon key resolved by the desktop shell UI. */
  icon:
    | 'mountain'
    | 'calculator'
    | 'blocks'
    | 'wind'
    | 'folder'
    | 'terminal';
  /** High-level capabilities shown in the App Library. */
  capabilities: string[];
}

function resolveEnvAppUrl(envValue: unknown, relativePath: string): string {
  if (typeof envValue === 'string' && envValue.trim().length > 0) {
    return envValue.trim();
  }
  const cleanRel = relativePath.replace(/^\/+/, '');
  if (typeof window !== 'undefined' && window.location?.href) {
    try {
      const resolved = new URL(cleanRel, window.location.href);
      return `${resolved.pathname}${resolved.search}${resolved.hash}`;
    } catch {
      // Fallback to root-relative path
    }
  }
  return `/${cleanRel}`;
}

const envMeta =
  typeof import.meta !== 'undefined' && import.meta.env
    ? import.meta.env
    : ({} as Record<string, unknown>);

const cutsheetEnvUrl = resolveEnvAppUrl(
  envMeta.VITE_CUTSHEET_URL,
  'apps/cutsheet.html',
);

const feasoEnvUrl = resolveEnvAppUrl(
  envMeta.VITE_FEASO_URL,
  'apps/feaso.html',
);

const formgenEnvUrl = resolveEnvAppUrl(
  envMeta.VITE_FORMGEN_URL,
  'apps/formgen.html',
);

const envirosimEnvUrl = resolveEnvAppUrl(
  envMeta.VITE_ENVIROSIM_URL,
  'apps/envirosim.html',
);

const REPO_BLOB_BASE =
  'https://github.com/buildinvestmelb-maker/sifibettingv1/blob/main';

export const APP_REGISTRY: Record<AppId, AppDefinition> = {
  'cutsheet-au': {
    id: 'cutsheet-au',
    name: 'CutSheet AU',
    shortName: 'CutSheet',
    description:
      'Commercial Australian GIS terrain, D8 overland flow hydrology & bulk earthworks workstation with 4 grading solvers, draped hillshade/slope/cut-fill lens, Three.js 3D Studio, and PDF/LandXML/DXF/BOQ/XYZ exports.',
    category: 'Terrain & Civil',
    runtime: 'iframe',
    status: 'live',
    singleInstance: true,
    defaultSize: { width: 1080, height: 680 },
    minSize: { width: 460, height: 360 },
    url: cutsheetEnvUrl,
    repoUrl: 'https://github.com/buildinvestmelb-maker/cutsheet-au',
    isIndustryApp: true,
    defaultPinned: true,
    icon: 'mountain',
    capabilities: [
      'Full-bleed MapLibre GIS (Hillshade, Slope Bands, Cut/Fill lens) + Three.js 3D Studio',
      'Horn 3×3 slope bands, Barnes Priority-Flood ponding, D8 overland flow & NDA engine',
      '4 civil grading solvers (Best-Fit Plane, Auto-Terrace, Max Grade %, Flat Pad) + Pin A',
      'AWS Terrarium DEM, ELVIS 1m LiDAR GeoTIFF, PDF, LandXML 1.2, DXF, BOQ & XYZ exports',
    ],
  },
  'feaso-os': {
    id: 'feaso-os',
    name: 'Feaso OS',
    shortName: 'Feaso OS',
    description:
      'EstateMaster-class Australian feasibility engine with 2026–27 progressive transfer duty across all 8 states, monthly S-curve cashflow, debt waterfall, IRR/NPV/RLV, and PDF/Excel exports.',
    category: 'Feasibility',
    runtime: 'iframe',
    status: 'live',
    singleInstance: false,
    defaultSize: { width: 820, height: 580 },
    minSize: { width: 420, height: 340 },
    url: feasoEnvUrl,
    repoUrl: `${REPO_BLOB_BASE}/src/apps/feaso/FeasoApp.tsx`,
    isIndustryApp: true,
    defaultPinned: true,
    icon: 'calculator',
    capabilities: [
      '2026–27 progressive stamp duty + foreign surcharge (all 8 AU states)',
      'Monthly S-curve cashflow, Senior Debt/Equity waterfall & capitalised interest',
      'ATO Div 75 Margin Scheme vs Full GST, Newton-Raphson IRR, NPV & RLV solver',
      '5×5 sensitivity matrix + PDF Investment Memo & 4-sheet formula .xlsx',
    ],
  },
  'formgen-au': {
    id: 'formgen-au',
    name: 'FormGen AU',
    shortName: 'FormGen',
    description:
      'Giraffe/Archistar-class 3D parametric massing, greenfield subdivision, podium+tower apartment envelopes, 28 state planning presets, and June 21 Southern Hemisphere solar engine.',
    category: 'Massing & Yield',
    runtime: 'iframe',
    status: 'live',
    singleInstance: true,
    defaultSize: { width: 920, height: 620 },
    minSize: { width: 480, height: 360 },
    url: formgenEnvUrl,
    repoUrl: `${REPO_BLOB_BASE}/src/apps/formgen/FormGenApp.tsx`,
    isIndustryApp: true,
    defaultPinned: false,
    icon: 'blocks',
    capabilities: [
      '28 Australian LEP / Planning Scheme presets across all 8 states',
      'Turf v7 setback & live EnviroSim exclusion mask boolean subtraction',
      'Greenfield road/cul-de-sac subdivision + podium/tower unit mix & parking',
      'Three.js 3D PCF solar shadows (Jun 21 ADG/ResCode) + DXF/GeoJSON/CSV',
    ],
  },
  'enviro-sim-au': {
    id: 'enviro-sim-au',
    name: 'EnviroSim AU',
    shortName: 'EnviroSim',
    description:
      'MapLibre GL spatial environmental workbench with AS 3959-2018 Method 1 BAL contour bands, boolean 1% AEP flood & biodiversity exclusion masks, AS/NZS 1170.2 wind, and PDF/KML exports.',
    category: 'Environment & Risk',
    runtime: 'iframe',
    status: 'live',
    singleInstance: true,
    defaultSize: { width: 920, height: 620 },
    minSize: { width: 480, height: 360 },
    url: envirosimEnvUrl,
    repoUrl: `${REPO_BLOB_BASE}/src/apps/envirosim/EnviroSimApp.tsx`,
    isIndustryApp: true,
    defaultPinned: false,
    icon: 'wind',
    capabilities: [
      'AS 3959-2018 Method 1 BAL calculator (FFDI 40–100) + spatial BAL bands',
      'MapLibre GL hazard drawing, GeoJSON/KML import & NSW/QLD cadastre',
      'Turf v7 boolean exclusion masks synced live to FormGen AU & Feaso OS',
      'AS/NZS 1170.2 Wind A–D, NatHERS climate & PDF/GeoJSON/KML 2.2 exports',
    ],
  },
  'file-explorer': {
    id: 'file-explorer',
    name: 'Projects (AU)',
    shortName: 'Projects (AU)',
    description:
      'National Australian state & territory repository for .deal site workspaces with GDA2020 MGA zone resolution.',
    category: 'System',
    runtime: 'builtin',
    status: 'live',
    singleInstance: true,
    defaultSize: { width: 860, height: 540 },
    minSize: { width: 520, height: 360 },
    repoUrl: `${REPO_BLOB_BASE}/src/components/apps/FileExplorerApp.tsx`,
    isIndustryApp: false,
    defaultPinned: true,
    icon: 'folder',
    capabilities: [
      'Browse NSW, VIC, QLD, WA, SA, TAS, ACT & NT deal folders',
      'Double-click .deal files to tile CutSheet AU + Feaso OS',
      'Create, edit, duplicate, import, export & persist .deal workspaces',
    ],
  },
  'project-inspector': {
    id: 'project-inspector',
    name: 'Project Inspector',
    shortName: 'Inspector',
    description:
      'Live JSON inspector for the active SiteProject store and real-time @devaware/os-bridge postMessage bus monitor.',
    category: 'System',
    runtime: 'builtin',
    status: 'live',
    singleInstance: true,
    defaultSize: { width: 780, height: 540 },
    minSize: { width: 460, height: 340 },
    repoUrl: `${REPO_BLOB_BASE}/src/components/apps/ProjectInspectorApp.tsx`,
    isIndustryApp: false,
    defaultPinned: true,
    icon: 'terminal',
    capabilities: [
      'Live SiteProject JSON inspection, validation & quick edit',
      'Real-time message bus trace (inbound, outbound, rejected origins)',
      'Origin allowlist diagnostics for embedded app developers',
    ],
  },
};

export const APP_LIST: AppDefinition[] = Object.values(APP_REGISTRY);

export const INDUSTRY_APPS: AppDefinition[] = APP_LIST.filter(
  (app) => app.isIndustryApp,
);

export const SYSTEM_APPS: AppDefinition[] = APP_LIST.filter(
  (app) => !app.isIndustryApp,
);

export const DEFAULT_PINNED_APPS: AppId[] = APP_LIST.filter(
  (app) => app.defaultPinned,
).map((app) => app.id);

export function isRegisteredAppId(id: string): id is AppId {
  return Object.prototype.hasOwnProperty.call(APP_REGISTRY, id);
}

/**
 * Extracts explicit external origins registered for live iframe apps
 * (excluding relative same-origin paths like /apps/...).
 */
export function getRegisteredAppOrigins(): string[] {
  const origins = new Set<string>();
  for (const app of APP_LIST) {
    if (!app.url) continue;
    try {
      if (app.url.startsWith('http://') || app.url.startsWith('https://')) {
        origins.add(new URL(app.url).origin);
      }
    } catch {
      // Ignore malformed env URL
    }
  }
  return Array.from(origins);
}
