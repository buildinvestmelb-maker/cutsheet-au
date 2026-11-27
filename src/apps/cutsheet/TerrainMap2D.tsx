import type { Feature, FeatureCollection, LineString, Polygon } from 'geojson';
import { Check, Info, X } from 'lucide-react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, ImageSource, MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import type { AustralianState } from '../../bridge/types';
import type { ElevationGrid } from '../../engines/earthworks/demLoader';
import {
  createRectPolygonFeatureCollection,
  extractPrimaryPolygon,
  getMapStyleConfig,
  getPublicCadastreLayerForState,
  mga2020ToWgs84,
  wgs84ToMga2020,
  type MapBasemapMode,
} from '../../engines/geo/auGeoKernel';
import { ensureMapLibreWorker } from '../../engines/geo/maplibreInit';

export type CutSheetCadTool =
  | 'select'
  | 'cadastre-snap'
  | 'draw-polygon'
  | 'draw-rect'
  | 'draw-section';

export interface TerrainMap2DProps {
  grid: ElevationGrid;
  boundaryGeoJson?: FeatureCollection;
  contours: FeatureCollection;
  showContours: boolean;
  terrainLensUrl: string | null;
  terrainLensOpacity: number;
  flowLinesGeoJson?: FeatureCollection<LineString>;
  showFlowLines: boolean;
  depressionsGeoJson?: FeatureCollection<Polygon>;
  showDepressions: boolean;
  showCadastre?: boolean;
  stateCode: AustralianState;
  basemapMode: MapBasemapMode;
  onBasemapModeChange: (mode: MapBasemapMode) => void;
  is3dMap: boolean;
  activeTool: CutSheetCadTool;
  onToolChange: (tool: CutSheetCadTool) => void;
  onBoundaryDrawn: (boundary: FeatureCollection) => void;
  sectionStart: [number, number];
  sectionEnd: [number, number];
  onSectionLineChange: (start: [number, number], end: [number, number]) => void;
  onCursorMove?: (coords: { lng: number; lat: number } | null) => void;
  flyToTarget?: { lng: number; lat: number; zoom?: number; seq: number } | null;
  siteLng: number;
  siteLat: number;
  mgaZone: number;
  mgaEpsg: string;
}

const CADASTRE_SRC = 'cutsheet-cadastre-src';
const CADASTRE_LAYER = 'cutsheet-cadastre-layer';
const LOCAL_GRID_SRC = 'cutsheet-local-grid-src';
const LOCAL_GRID_LAYER = 'cutsheet-local-grid-layer';
const TERRAIN_LENS_SRC = 'cutsheet-terrain-lens-src';
const TERRAIN_LENS_LAYER = 'cutsheet-terrain-lens-layer';
const DEPRESSIONS_SRC = 'cutsheet-depressions-src';
const DEPRESSIONS_FILL_LAYER = 'cutsheet-depressions-fill';
const DEPRESSIONS_LINE_LAYER = 'cutsheet-depressions-line';
const FLOW_LINES_SRC = 'cutsheet-flow-lines-src';
const FLOW_LINES_GLOW_LAYER = 'cutsheet-flow-lines-glow';
const FLOW_LINES_CORE_LAYER = 'cutsheet-flow-lines-core';
const CONTOURS_SRC = 'cutsheet-contours-src';
const CONTOURS_MINOR_LAYER = 'cutsheet-contours-minor';
const CONTOURS_INDEX_LAYER = 'cutsheet-contours-index';
const PARCEL_SRC = 'cutsheet-parcel-src';
const PARCEL_FILL_LAYER = 'cutsheet-parcel-fill';
const PARCEL_LINE_LAYER = 'cutsheet-parcel-line';
const DRAFT_SRC = 'cutsheet-draft-src';
const DRAFT_LINE_LAYER = 'cutsheet-draft-line';
const DRAFT_PTS_LAYER = 'cutsheet-draft-pts';
const TRANSECT_SRC = 'cutsheet-transect-src';
const TRANSECT_LINE_LAYER = 'cutsheet-transect-line';
const TRANSECT_PTS_SRC = 'cutsheet-transect-pts-src';
const TRANSECT_PTS_LAYER = 'cutsheet-transect-pts';

const EMPTY_FC: FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

function detectWebGl2Support(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false;
  }
  if (typeof window.WebGL2RenderingContext === 'undefined') {
    return false;
  }
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2'));
  } catch {
    return false;
  }
}

function buildLocalMetricGridFc(
  lng: number,
  lat: number,
  mgaZone: number,
): FeatureCollection {
  try {
    const center = wgs84ToMga2020(lng, lat, mgaZone);
    const stepM = 50;
    const halfSpanM = 600;
    const baseE = Math.round(center.easting / stepM) * stepM;
    const baseN = Math.round(center.northing / stepM) * stepM;
    const features: Feature[] = [];

    for (let dE = -halfSpanM; dE <= halfSpanM; dE += stepM) {
      const e = baseE + dE;
      const p1 = mga2020ToWgs84(e, baseN - halfSpanM, mgaZone);
      const p2 = mga2020ToWgs84(e, baseN + halfSpanM, mgaZone);
      features.push({
        type: 'Feature',
        properties: { major: dE % 200 === 0 },
        geometry: {
          type: 'LineString',
          coordinates: [
            [p1.lng, p1.lat],
            [p2.lng, p2.lat],
          ],
        },
      });
    }
    for (let dN = -halfSpanM; dN <= halfSpanM; dN += stepM) {
      const n = baseN + dN;
      const p1 = mga2020ToWgs84(baseE - halfSpanM, n, mgaZone);
      const p2 = mga2020ToWgs84(baseE + halfSpanM, n, mgaZone);
      features.push({
        type: 'Feature',
        properties: { major: dN % 200 === 0 },
        geometry: {
          type: 'LineString',
          coordinates: [
            [p1.lng, p1.lat],
            [p2.lng, p2.lat],
          ],
        },
      });
    }
    return { type: 'FeatureCollection', features };
  } catch {
    return EMPTY_FC;
  }
}

function setOrCreateGeoJsonSource(
  map: maplibregl.Map,
  sourceId: string,
  data: FeatureCollection,
): void {
  const existing = map.getSource(sourceId) as GeoJSONSource | undefined;
  if (existing && typeof existing.setData === 'function') {
    existing.setData(data);
    return;
  }
  map.addSource(sourceId, { type: 'geojson', data });
}

function removeLayerAndSourceSafe(
  map: maplibregl.Map,
  layerIds: string[],
  sourceId: string,
): void {
  for (const layerId of layerIds) {
    try {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
    } catch {
      // Ignore during style swap
    }
  }
  try {
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  } catch {
    // Ignore during style swap
  }
}

function buildTransectLineFc(
  start: [number, number],
  end: [number, number],
): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { role: 'section-transect' },
        geometry: {
          type: 'LineString',
          coordinates: [start, end],
        },
      },
    ],
  };
}

function buildTransectPointsFc(
  start: [number, number],
  end: [number, number],
  draftStart: [number, number] | null,
): FeatureCollection {
  if (draftStart) {
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { label: 'A', kind: 'start' },
          geometry: { type: 'Point', coordinates: draftStart },
        },
      ],
    };
  }
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { label: 'A', kind: 'start' },
        geometry: { type: 'Point', coordinates: start },
      },
      {
        type: 'Feature',
        properties: { label: "A'", kind: 'end' },
        geometry: { type: 'Point', coordinates: end },
      },
    ],
  };
}

function buildDraftGeometryFc(
  pts: Array<[number, number]>,
): FeatureCollection {
  if (pts.length === 0) return EMPTY_FC;
  const features: Feature[] = pts.map((coord, idx) => ({
    type: 'Feature',
    properties: { idx },
    geometry: { type: 'Point', coordinates: coord },
  }));
  if (pts.length >= 2) {
    features.push({
      type: 'Feature',
      properties: { kind: 'draft-line' },
      geometry: { type: 'LineString', coordinates: pts },
    });
  }
  return { type: 'FeatureCollection', features };
}

function makeRectangleFc(
  a: [number, number],
  b: [number, number],
): FeatureCollection {
  const minLng = Math.min(a[0], b[0]);
  const maxLng = Math.max(a[0], b[0]);
  const minLat = Math.min(a[1], b[1]);
  const maxLat = Math.max(a[1], b[1]);
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { role: 'parcel-boundary' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [minLng, minLat],
              [maxLng, minLat],
              [maxLng, maxLat],
              [minLng, maxLat],
              [minLng, minLat],
            ],
          ],
        },
      },
    ],
  };
}

function makePolygonFc(pts: Array<[number, number]>): FeatureCollection {
  const ring = [...pts, pts[0]];
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { role: 'parcel-boundary' },
        geometry: {
          type: 'Polygon',
          coordinates: [ring],
        },
      },
    ],
  };
}

/**
 * Full-Bleed Commercial GIS/CAD Viewport for CutSheet AU Pro.
 * Renders MapLibre GL Satellite/Dark/Offline basemaps with draped Hillshade / Slope / Cut-Fill
 * terrain lens, Marching Squares contours, D8 cyan overland flow channels, amber low-point
 * ponding depressions, NSW/QLD cadastre overlay, interactive CAD parcel/section drawing tools,
 * smooth 3D map tilt, and an automatic SVG fallback when WebGL2 is unavailable.
 */
export function TerrainMap2D({
  grid,
  boundaryGeoJson,
  contours,
  showContours,
  terrainLensUrl,
  terrainLensOpacity,
  flowLinesGeoJson,
  showFlowLines,
  depressionsGeoJson,
  showDepressions,
  showCadastre = false,
  stateCode,
  basemapMode,
  onBasemapModeChange,
  is3dMap,
  activeTool,
  onToolChange,
  onBoundaryDrawn,
  sectionStart,
  sectionEnd,
  onSectionLineChange,
  onCursorMove,
  flyToTarget,
  siteLng,
  siteLat,
  mgaZone,
}: TerrainMap2DProps) {
  const [useSvgFallback, setUseSvgFallback] = useState<boolean>(
    () => !detectWebGl2Support(),
  );
  const [basemapNotice, setBasemapNotice] = useState<string | null>(null);
  const [draftState, setDraftState] = useState<{
    tool: CutSheetCadTool;
    points: Array<[number, number]>;
    sectionStart: [number, number] | null;
  }>({ tool: 'select', points: [], sectionStart: null });

  const draftPoints = useMemo(
    () => (draftState.tool === activeTool ? draftState.points : []),
    [activeTool, draftState.points, draftState.tool],
  );
  const draftSectionStart =
    draftState.tool === activeTool ? draftState.sectionStart : null;

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const activeBasemapRef = useRef<MapBasemapMode>(basemapMode);
  const appliedStyleModeRef = useRef<MapBasemapMode>(basemapMode);
  const toolRef = useRef<CutSheetCadTool>(activeTool);
  const draftPointsRef = useRef<Array<[number, number]>>(draftPoints);
  const draftSectionRef = useRef<[number, number] | null>(draftSectionStart);
  const lastFlySeqRef = useRef<number>(0);
  const lastLensSigRef = useRef<string | null>(null);

  const onBasemapChangeRef = useRef(onBasemapModeChange);
  const onToolChangeRef = useRef(onToolChange);
  const onBoundaryDrawnRef = useRef(onBoundaryDrawn);
  const onSectionChangeRef = useRef(onSectionLineChange);
  const onCursorMoveRef = useRef(onCursorMove);

  useEffect(() => {
    onBasemapChangeRef.current = onBasemapModeChange;
    onToolChangeRef.current = onToolChange;
    onBoundaryDrawnRef.current = onBoundaryDrawn;
    onSectionChangeRef.current = onSectionLineChange;
    onCursorMoveRef.current = onCursorMove;
  }, [
    onBasemapModeChange,
    onBoundaryDrawn,
    onCursorMove,
    onSectionLineChange,
    onToolChange,
  ]);

  useEffect(() => {
    toolRef.current = activeTool;
  }, [activeTool]);

  useEffect(() => {
    draftPointsRef.current = draftPoints;
  }, [draftPoints]);

  useEffect(() => {
    draftSectionRef.current = draftSectionStart;
  }, [draftSectionStart]);

  const primaryPolygon = useMemo<Feature<Polygon> | null>(
    () => extractPrimaryPolygon(boundaryGeoJson),
    [boundaryGeoJson],
  );

  const parcelFc = useMemo<FeatureCollection>(
    () =>
      primaryPolygon
        ? { type: 'FeatureCollection', features: [primaryPolygon] }
        : EMPTY_FC,
    [primaryPolygon],
  );

  const snapshotRef = useRef({
    parcelFc,
    contours,
    showContours,
    terrainLensUrl,
    terrainLensOpacity,
    flowLinesGeoJson: flowLinesGeoJson ?? (EMPTY_FC as FeatureCollection<LineString>),
    showFlowLines,
    depressionsGeoJson: depressionsGeoJson ?? (EMPTY_FC as FeatureCollection<Polygon>),
    showDepressions,
    showCadastre,
    stateCode,
    sectionStart,
    sectionEnd,
    draftSectionStart,
    draftPoints,
    siteLng,
    siteLat,
    mgaZone,
    boundsWgs84: grid.boundsWgs84,
  });

  useEffect(() => {
    snapshotRef.current = {
      parcelFc,
      contours,
      showContours,
      terrainLensUrl,
      terrainLensOpacity,
      flowLinesGeoJson: flowLinesGeoJson ?? (EMPTY_FC as FeatureCollection<LineString>),
      showFlowLines,
      depressionsGeoJson: depressionsGeoJson ?? (EMPTY_FC as FeatureCollection<Polygon>),
      showDepressions,
      showCadastre,
      stateCode,
      sectionStart,
      sectionEnd,
      draftSectionStart,
      draftPoints,
      siteLng,
      siteLat,
      mgaZone,
      boundsWgs84: grid.boundsWgs84,
    };
  }, [
    contours,
    depressionsGeoJson,
    draftPoints,
    draftSectionStart,
    flowLinesGeoJson,
    grid.boundsWgs84,
    mgaZone,
    parcelFc,
    sectionEnd,
    sectionStart,
    showCadastre,
    showContours,
    showDepressions,
    showFlowLines,
    siteLat,
    siteLng,
    stateCode,
    terrainLensOpacity,
    terrainLensUrl,
  ]);

  const syncLayers = useCallback((map: maplibregl.Map, force = false) => {
    try {
      if (!force && !map.isStyleLoaded()) return;
    } catch {
      return;
    }
    const snap = snapshotRef.current;

    try {
      // 1. Optional State Cadastre WMS/ArcGIS tile overlay (NSW / QLD)
      const cadastreSpec = snap.showCadastre
        ? getPublicCadastreLayerForState(snap.stateCode)
        : null;
      if (cadastreSpec && activeBasemapRef.current !== 'offline-grid') {
        if (!map.getSource(CADASTRE_SRC)) {
          map.addSource(CADASTRE_SRC, {
            type: 'raster',
            tiles: [cadastreSpec.tileUrl],
            tileSize: cadastreSpec.tileSize,
            minzoom: cadastreSpec.minzoom,
            maxzoom: cadastreSpec.maxzoom,
            attribution: cadastreSpec.attribution,
          });
        }
        if (!map.getLayer(CADASTRE_LAYER)) {
          map.addLayer({
            id: CADASTRE_LAYER,
            type: 'raster',
            source: CADASTRE_SRC,
            paint: { 'raster-opacity': cadastreSpec.defaultOpacity },
          });
        }
      } else {
        removeLayerAndSourceSafe(map, [CADASTRE_LAYER], CADASTRE_SRC);
      }

      // 2. Local 50m MGA grid when in offline-grid mode
      if (activeBasemapRef.current === 'offline-grid') {
        setOrCreateGeoJsonSource(
          map,
          LOCAL_GRID_SRC,
          buildLocalMetricGridFc(snap.siteLng, snap.siteLat, snap.mgaZone),
        );
        if (!map.getLayer(LOCAL_GRID_LAYER)) {
          map.addLayer({
            id: LOCAL_GRID_LAYER,
            type: 'line',
            source: LOCAL_GRID_SRC,
            paint: {
              'line-color': [
                'case',
                ['==', ['get', 'major'], true],
                '#0ea5e9',
                '#1e293b',
              ],
              'line-width': [
                'case',
                ['==', ['get', 'major'], true],
                1.0,
                0.7,
              ],
              'line-opacity': [
                'case',
                ['==', ['get', 'major'], true],
                0.35,
                0.6,
              ],
            },
          });
        }
      } else {
        removeLayerAndSourceSafe(map, [LOCAL_GRID_LAYER], LOCAL_GRID_SRC);
      }

      // 3. Draped Terrain Lens Image Source (Hillshade / Slope Bands / Cut-Fill Map)
      const [minLng, minLat, maxLng, maxLat] = snap.boundsWgs84;
      const imageCoords: [
        [number, number],
        [number, number],
        [number, number],
        [number, number],
      ] = [
        [minLng, maxLat],
        [maxLng, maxLat],
        [maxLng, minLat],
        [minLng, minLat],
      ];

      if (snap.terrainLensUrl) {
        const lensSig = `${snap.terrainLensUrl}|${minLng},${minLat},${maxLng},${maxLat}`;
        const existingImg = map.getSource(TERRAIN_LENS_SRC) as
          | ImageSource
          | undefined;
        if (existingImg && typeof existingImg.updateImage === 'function') {
          if (force || lastLensSigRef.current !== lensSig) {
            existingImg.updateImage({
              url: snap.terrainLensUrl,
              coordinates: imageCoords,
            });
            lastLensSigRef.current = lensSig;
          }
        } else {
          removeLayerAndSourceSafe(map, [TERRAIN_LENS_LAYER], TERRAIN_LENS_SRC);
          map.addSource(TERRAIN_LENS_SRC, {
            type: 'image',
            url: snap.terrainLensUrl,
            coordinates: imageCoords,
          });
          lastLensSigRef.current = lensSig;
        }
        if (!map.getLayer(TERRAIN_LENS_LAYER)) {
          map.addLayer({
            id: TERRAIN_LENS_LAYER,
            type: 'raster',
            source: TERRAIN_LENS_SRC,
            paint: {
              'raster-opacity': snap.terrainLensOpacity,
              'raster-fade-duration': 0,
            },
          });
        } else {
          map.setPaintProperty(
            TERRAIN_LENS_LAYER,
            'raster-opacity',
            snap.terrainLensOpacity,
          );
        }
      } else {
        lastLensSigRef.current = null;
        removeLayerAndSourceSafe(map, [TERRAIN_LENS_LAYER], TERRAIN_LENS_SRC);
      }

      // 4. Low-Point Ponding Depressions (amber fill + dashed border)
      setOrCreateGeoJsonSource(
        map,
        DEPRESSIONS_SRC,
        snap.showDepressions ? snap.depressionsGeoJson : EMPTY_FC,
      );
      if (!map.getLayer(DEPRESSIONS_FILL_LAYER)) {
        map.addLayer({
          id: DEPRESSIONS_FILL_LAYER,
          type: 'fill',
          source: DEPRESSIONS_SRC,
          paint: {
            'fill-color': '#f59e0b',
            'fill-opacity': 0.32,
          },
        });
      }
      if (!map.getLayer(DEPRESSIONS_LINE_LAYER)) {
        map.addLayer({
          id: DEPRESSIONS_LINE_LAYER,
          type: 'line',
          source: DEPRESSIONS_SRC,
          paint: {
            'line-color': '#fbbf24',
            'line-width': 1.6,
            'line-dasharray': [2, 2],
          },
        });
      }

      // 5. D8 Overland Flow Channels (cyan glowing drainage lines)
      setOrCreateGeoJsonSource(
        map,
        FLOW_LINES_SRC,
        snap.showFlowLines ? snap.flowLinesGeoJson : EMPTY_FC,
      );
      if (!map.getLayer(FLOW_LINES_GLOW_LAYER)) {
        map.addLayer({
          id: FLOW_LINES_GLOW_LAYER,
          type: 'line',
          source: FLOW_LINES_SRC,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#06b6d4',
            'line-width': ['*', ['coalesce', ['get', 'widthFactor'], 2], 2.2],
            'line-opacity': 0.35,
            'line-blur': 2,
          },
        });
      }
      if (!map.getLayer(FLOW_LINES_CORE_LAYER)) {
        map.addLayer({
          id: FLOW_LINES_CORE_LAYER,
          type: 'line',
          source: FLOW_LINES_SRC,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#38bdf8',
            'line-width': ['coalesce', ['get', 'widthFactor'], 2],
            'line-opacity': 0.95,
          },
        });
      }

      // 6. Marching Squares Elevation Contours
      setOrCreateGeoJsonSource(
        map,
        CONTOURS_SRC,
        snap.showContours ? snap.contours : EMPTY_FC,
      );
      if (!map.getLayer(CONTOURS_MINOR_LAYER)) {
        map.addLayer({
          id: CONTOURS_MINOR_LAYER,
          type: 'line',
          source: CONTOURS_SRC,
          filter: ['!=', ['get', 'isIndex'], true],
          paint: {
            'line-color': '#e2e8f0',
            'line-width': 0.9,
            'line-opacity': 0.65,
          },
        });
      }
      if (!map.getLayer(CONTOURS_INDEX_LAYER)) {
        map.addLayer({
          id: CONTOURS_INDEX_LAYER,
          type: 'line',
          source: CONTOURS_SRC,
          filter: ['==', ['get', 'isIndex'], true],
          paint: {
            'line-color': '#ffffff',
            'line-width': 1.7,
            'line-opacity': 0.92,
          },
        });
      }

      // 7. Site Parcel Boundary (bright cyan CAD stroke)
      setOrCreateGeoJsonSource(map, PARCEL_SRC, snap.parcelFc);
      if (!map.getLayer(PARCEL_FILL_LAYER)) {
        map.addLayer({
          id: PARCEL_FILL_LAYER,
          type: 'fill',
          source: PARCEL_SRC,
          paint: {
            'fill-color': '#3daee9',
            'fill-opacity': 0.06,
          },
        });
      }
      if (!map.getLayer(PARCEL_LINE_LAYER)) {
        map.addLayer({
          id: PARCEL_LINE_LAYER,
          type: 'line',
          source: PARCEL_SRC,
          paint: {
            'line-color': '#38bdf8',
            'line-width': 2.4,
            'line-opacity': 0.98,
          },
        });
      }

      // 8. Interactive Draft CAD Polygon / Rectangle Vertices
      setOrCreateGeoJsonSource(
        map,
        DRAFT_SRC,
        buildDraftGeometryFc(snap.draftPoints),
      );
      if (!map.getLayer(DRAFT_LINE_LAYER)) {
        map.addLayer({
          id: DRAFT_LINE_LAYER,
          type: 'line',
          source: DRAFT_SRC,
          filter: ['==', ['geometry-type'], 'LineString'],
          paint: {
            'line-color': '#34d399',
            'line-width': 2.2,
            'line-dasharray': [2, 2],
          },
        });
      }
      if (!map.getLayer(DRAFT_PTS_LAYER)) {
        map.addLayer({
          id: DRAFT_PTS_LAYER,
          type: 'circle',
          source: DRAFT_SRC,
          filter: ['==', ['geometry-type'], 'Point'],
          paint: {
            'circle-radius': 5,
            'circle-color': '#34d399',
            'circle-stroke-color': '#0b1017',
            'circle-stroke-width': 2,
          },
        });
      }

      // 9. Section A–A' Transect Line & Endpoints
      setOrCreateGeoJsonSource(
        map,
        TRANSECT_SRC,
        buildTransectLineFc(snap.sectionStart, snap.sectionEnd),
      );
      if (!map.getLayer(TRANSECT_LINE_LAYER)) {
        map.addLayer({
          id: TRANSECT_LINE_LAYER,
          type: 'line',
          source: TRANSECT_SRC,
          paint: {
            'line-color': '#fbbf24',
            'line-width': 2.2,
            'line-dasharray': [3, 2],
          },
        });
      }

      setOrCreateGeoJsonSource(
        map,
        TRANSECT_PTS_SRC,
        buildTransectPointsFc(
          snap.sectionStart,
          snap.sectionEnd,
          snap.draftSectionStart,
        ),
      );
      if (!map.getLayer(TRANSECT_PTS_LAYER)) {
        map.addLayer({
          id: TRANSECT_PTS_LAYER,
          type: 'circle',
          source: TRANSECT_PTS_SRC,
          paint: {
            'circle-radius': 5,
            'circle-color': [
              'case',
              ['==', ['get', 'kind'], 'start'],
              '#34d399',
              '#f59e0b',
            ],
            'circle-stroke-color': '#0b1017',
            'circle-stroke-width': 2,
          },
        });
      }
    } catch {
      // Style swap in progress
    }
  }, []);

  const fitBoundsToSite = useCallback(
    (map: maplibregl.Map, animate = true) => {
      try {
        const [minLng, minLat, maxLng, maxLat] =
          snapshotRef.current.boundsWgs84;
        map.fitBounds(
          [
            [minLng, minLat],
            [maxLng, maxLat],
          ],
          { padding: 56, maxZoom: 16.5, duration: animate ? 420 : 0 },
        );
      } catch {
        // Ignore during unmount
      }
    },
    [],
  );

  // Mount MapLibre GL instance
  useEffect(() => {
    if (useSvgFallback) return;
    const container = mapContainerRef.current;
    if (!container) return;

    let cancelled = false;
    let map: maplibregl.Map;
    try {
      ensureMapLibreWorker();
      map = new maplibregl.Map({
        container,
        style: getMapStyleConfig(activeBasemapRef.current),
        center: [siteLng, siteLat],
        zoom: 15,
        pitch: is3dMap ? 52 : 0,
        bearing: is3dMap ? -20 : 0,
        attributionControl: { compact: true },
        canvasContextAttributes: {
          antialias: true,
          preserveDrawingBuffer: true,
        },
      });
      map.addControl(
        new maplibregl.NavigationControl({ showCompass: true }),
        'bottom-left',
      );
      map.addControl(
        new maplibregl.ScaleControl({ maxWidth: 100, unit: 'metric' }),
        'bottom-left',
      );
    } catch {
      queueMicrotask(() => {
        if (!cancelled) setUseSvgFallback(true);
      });
      return () => {
        cancelled = true;
      };
    }

    mapRef.current = map;
    appliedStyleModeRef.current = activeBasemapRef.current;

    map.on('error', (evt) => {
      const rec = evt as unknown as { error?: { message?: string } };
      const errMsg = rec.error?.message ?? '';
      if (/sprite|glyph|image .* could not be loaded/i.test(errMsg)) {
        return;
      }
      if (activeBasemapRef.current !== 'offline-grid') {
        activeBasemapRef.current = 'offline-grid';
        appliedStyleModeRef.current = 'offline-grid';
        onBasemapChangeRef.current('offline-grid');
        setBasemapNotice(
          'Remote tiles unavailable — switched to Offline MGA2020 Grid.',
        );
        try {
          map.setStyle(getMapStyleConfig('offline-grid'));
        } catch {
          setUseSvgFallback(true);
        }
      }
    });

    map.on('webglcontextlost', () => {
      setUseSvgFallback(true);
    });

    map.on('style.load', () => {
      syncLayers(map, true);
      fitBoundsToSite(map, false);
    });

    map.on('load', () => {
      syncLayers(map, true);
      fitBoundsToSite(map, false);
    });

    const handleMapMove = (evt: MapMouseEvent) => {
      onCursorMoveRef.current?.({
        lng: evt.lngLat.lng,
        lat: evt.lngLat.lat,
      });
    };

    const handleMapClick = (evt: MapMouseEvent) => {
      const tool = toolRef.current;
      if (tool === 'select') return;
      const pt: [number, number] = [
        Number(evt.lngLat.lng.toFixed(6)),
        Number(evt.lngLat.lat.toFixed(6)),
      ];

      if (tool === 'cadastre-snap') {
        const fc = createRectPolygonFeatureCollection(pt[1], pt[0], 140, 120);
        onBoundaryDrawnRef.current(fc);
        onToolChangeRef.current('select');
        return;
      }

      if (tool === 'draw-section') {
        if (!draftSectionRef.current) {
          setDraftState({ tool, points: [], sectionStart: pt });
        } else {
          onSectionChangeRef.current(draftSectionRef.current, pt);
          setDraftState({ tool: 'select', points: [], sectionStart: null });
          onToolChangeRef.current('select');
        }
        return;
      }

      if (tool === 'draw-rect') {
        const current = draftPointsRef.current;
        if (current.length === 0) {
          setDraftState({ tool, points: [pt], sectionStart: null });
        } else {
          const fc = makeRectangleFc(current[0], pt);
          setDraftState({ tool: 'select', points: [], sectionStart: null });
          onBoundaryDrawnRef.current(fc);
          onToolChangeRef.current('select');
        }
        return;
      }

      if (tool === 'draw-polygon') {
        setDraftState((prev) => ({
          tool,
          points: prev.tool === tool ? [...prev.points, pt] : [pt],
          sectionStart: null,
        }));
      }
    };

    const handleDoubleClick = (evt: MapMouseEvent) => {
      if (toolRef.current !== 'draw-polygon') return;
      evt.preventDefault();
      const pts = draftPointsRef.current;
      if (pts.length >= 3) {
        const fc = makePolygonFc(pts);
        setDraftState({ tool: 'select', points: [], sectionStart: null });
        onBoundaryDrawnRef.current(fc);
        onToolChangeRef.current('select');
      }
    };

    map.on('mousemove', handleMapMove);
    map.on('click', handleMapClick);
    map.on('dblclick', handleDoubleClick);

    // Post-mount resize check for flex layout settling
    const rafResize = window.requestAnimationFrame(() => {
      try {
        map.resize();
      } catch {
        // Ignore
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      try {
        map.resize();
      } catch {
        // Ignore resize error
      }
    });
    resizeObserver.observe(container);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(rafResize);
      resizeObserver.disconnect();
      map.off('mousemove', handleMapMove);
      map.off('click', handleMapClick);
      map.off('dblclick', handleDoubleClick);
      try {
        map.remove();
      } catch {
        // Ignore cleanup exception
      }
      mapRef.current = null;
    };
    // Intentionally remount only when project location seed changes or fallback flips
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteLat, siteLng, useSvgFallback]);

  // Apply external basemap mode changes
  useEffect(() => {
    activeBasemapRef.current = basemapMode;
    const map = mapRef.current;
    if (!map) return;
    if (appliedStyleModeRef.current === basemapMode) return;
    appliedStyleModeRef.current = basemapMode;
    queueMicrotask(() => setBasemapNotice(null));
    try {
      map.setStyle(getMapStyleConfig(basemapMode));
    } catch {
      queueMicrotask(() => setUseSvgFallback(true));
    }
  }, [basemapMode]);

  // Apply 3D Map pitch / bearing easeTo
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    try {
      map.easeTo({
        pitch: is3dMap ? 52 : 0,
        bearing: is3dMap ? -20 : 0,
        duration: 420,
      });
    } catch {
      // Ignore during unmount
    }
  }, [is3dMap]);

  // Apply Fly-To commands (Address Search / Capital City Jumps)
  useEffect(() => {
    if (!flyToTarget || flyToTarget.seq === lastFlySeqRef.current) return;
    lastFlySeqRef.current = flyToTarget.seq;
    const map = mapRef.current;
    if (!map) return;
    try {
      map.flyTo({
        center: [flyToTarget.lng, flyToTarget.lat],
        zoom: flyToTarget.zoom ?? 15,
        duration: 650,
      });
    } catch {
      // Ignore during unmount
    }
  }, [flyToTarget]);

  // Update GeoJSON & draped terrain image sources on any reactive input change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    syncLayers(map);
  }, [
    contours,
    depressionsGeoJson,
    draftPoints,
    draftSectionStart,
    flowLinesGeoJson,
    parcelFc,
    sectionEnd,
    sectionStart,
    showCadastre,
    showContours,
    showDepressions,
    showFlowLines,
    stateCode,
    syncLayers,
    terrainLensOpacity,
    terrainLensUrl,
  ]);

  // Cursor styling for active CAD drawing tools
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = activeTool === 'select' ? '' : 'crosshair';
  }, [activeTool]);

  const handleFinishPolygon = () => {
    if (draftPoints.length < 3) return;
    const fc = makePolygonFc(draftPoints);
    setDraftState({ tool: 'select', points: [], sectionStart: null });
    onBoundaryDrawn(fc);
    onToolChange('select');
  };

  const handleCancelDrawing = () => {
    setDraftState({ tool: 'select', points: [], sectionStart: null });
    onToolChange('select');
  };

  // SVG Fallback projection helpers
  const svgW = 800;
  const svgH = 480;
  const svgBounds = grid.boundsWgs84;
  const toSvgXY = useCallback(
    (lng: number, lat: number): [number, number] => {
      const [minLng, minLat, maxLng, maxLat] = svgBounds;
      const pad = 28;
      const u = (lng - minLng) / Math.max(1e-9, maxLng - minLng);
      const v = (maxLat - lat) / Math.max(1e-9, maxLat - minLat);
      return [pad + u * (svgW - pad * 2), pad + v * (svgH - pad * 2)];
    },
    [svgBounds],
  );

  const handleSvgClick = (evt: ReactMouseEvent<SVGSVGElement>) => {
    if (activeTool === 'select') return;
    const rect = evt.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const sx = ((evt.clientX - rect.left) / rect.width) * svgW;
    const sy = ((evt.clientY - rect.top) / rect.height) * svgH;
    const pad = 28;
    const [minLng, minLat, maxLng, maxLat] = svgBounds;
    const u = Math.min(1, Math.max(0, (sx - pad) / (svgW - pad * 2)));
    const v = Math.min(1, Math.max(0, (sy - pad) / (svgH - pad * 2)));
    const pt: [number, number] = [
      Number((minLng + u * (maxLng - minLng)).toFixed(6)),
      Number((maxLat - v * (maxLat - minLat)).toFixed(6)),
    ];

    if (activeTool === 'draw-section') {
      if (!draftSectionStart) {
        setDraftState({ tool: activeTool, points: [], sectionStart: pt });
      } else {
        onSectionLineChange(draftSectionStart, pt);
        setDraftState({ tool: 'select', points: [], sectionStart: null });
        onToolChange('select');
      }
    } else if (activeTool === 'cadastre-snap') {
      onBoundaryDrawn(createRectPolygonFeatureCollection(pt[1], pt[0], 140, 120));
      onToolChange('select');
    } else if (activeTool === 'draw-rect') {
      if (draftPoints.length === 0) {
        setDraftState({ tool: activeTool, points: [pt], sectionStart: null });
      } else {
        onBoundaryDrawn(makeRectangleFc(draftPoints[0], pt));
        setDraftState({ tool: 'select', points: [], sectionStart: null });
        onToolChange('select');
      }
    } else if (activeTool === 'draw-polygon') {
      setDraftState((prev) => ({
        tool: activeTool,
        points: prev.tool === activeTool ? [...prev.points, pt] : [pt],
        sectionStart: null,
      }));
    }
  };

  const toolInstruction =
    activeTool === 'cadastre-snap'
      ? 'Click anywhere on the map to place a 1.68 ha site parcel & analyse terrain'
      : activeTool === 'draw-rect'
        ? draftPoints.length === 0
          ? 'Rectangle Tool: Click Corner 1 on map'
          : 'Rectangle Tool: Click opposite Corner 2 to commit parcel'
        : activeTool === 'draw-polygon'
          ? `Polygon Tool: Click boundary vertices (${draftPoints.length} placed) — click Finish when >= 3`
          : activeTool === 'draw-section'
            ? !draftSectionStart
              ? 'Cross-Section Tool: Click Point A (Start)'
              : "Cross-Section Tool: Click Point A' (End)"
            : null;

  return (
    <div
      data-testid="cutsheet-2d-map"
      className="relative flex min-h-[290px] w-full flex-1 flex-col overflow-hidden bg-[#070b14]"
    >
      {/* Offline fallback notice */}
      {basemapNotice && (
        <div className="pointer-events-auto absolute top-2.5 left-2.5 z-20 flex items-center gap-1.5 rounded-md border border-amber-400/35 bg-[#101722]/92 px-2.5 py-1 text-[10.5px] text-amber-200 shadow-lg backdrop-blur">
          <Info size={12} className="shrink-0" />
          <span>{basemapNotice}</span>
          <button
            type="button"
            aria-label="Dismiss basemap notice"
            onClick={() => setBasemapNotice(null)}
            className="ml-1 cursor-pointer text-amber-300 hover:text-white"
          >
            <X size={11} />
          </button>
        </div>
      )}

      {/* Interactive CAD Tool HUD Banner */}
      {toolInstruction && (
        <div
          data-testid="cutsheet-cad-tool-hud"
          className="pointer-events-auto absolute top-2.5 left-1/2 z-20 flex -translate-x-1/2 flex-wrap items-center gap-2 rounded-lg border border-[#3daee9]/50 bg-[#0d141f]/95 px-3 py-1.5 text-[11px] text-sky-100 shadow-xl backdrop-blur"
        >
          <span className="h-2 w-2 animate-pulse rounded-full bg-[#3daee9]" />
          <span className="font-medium">{toolInstruction}</span>
          {activeTool === 'draw-polygon' && draftPoints.length >= 3 && (
            <button
              type="button"
              onClick={handleFinishPolygon}
              className="inline-flex cursor-pointer items-center gap-1 rounded bg-emerald-500 px-2 py-0.5 text-[10.5px] font-bold text-slate-950 hover:bg-emerald-400"
            >
              <Check size={11} />
              Finish ({draftPoints.length})
            </button>
          )}
          <button
            type="button"
            onClick={handleCancelDrawing}
            className="inline-flex cursor-pointer items-center gap-1 rounded border border-slate-500/40 bg-slate-800/80 px-2 py-0.5 text-[10.5px] text-slate-200 hover:text-white"
          >
            <X size={11} />
            Cancel
          </button>
        </div>
      )}

      {/* MapLibre GL Canvas or Crisp SVG Fallback */}
      {useSvgFallback ? (
        <svg
          viewBox={`0 0 ${svgW} ${svgH}`}
          onClick={handleSvgClick}
          className={`block h-full w-full flex-1 bg-[#070b14] ${
            activeTool !== 'select' ? 'cursor-crosshair' : ''
          }`}
          role="img"
          aria-label="2D GIS Terrain, Contours, Hydrology & Parcel Boundary Map"
        >
          {/* Draped Terrain Lens Image in SVG Fallback */}
          {terrainLensUrl && (
            <image
              href={terrainLensUrl}
              x={28}
              y={28}
              width={svgW - 56}
              height={svgH - 56}
              opacity={terrainLensOpacity}
              preserveAspectRatio="none"
            />
          )}

          {/* Depressions */}
          {showDepressions &&
            depressionsGeoJson?.features.map((feat, idx) => (
              <polygon
                key={`dep-${idx}`}
                points={(feat.geometry.coordinates[0] ?? [])
                  .map((p) => toSvgXY(p[0], p[1]).join(','))
                  .join(' ')}
                fill="rgba(245, 158, 11, 0.34)"
                stroke="#fbbf24"
                strokeWidth="1.5"
                strokeDasharray="3 2"
              />
            ))}

          {/* D8 Overland Flow Channels */}
          {showFlowLines &&
            flowLinesGeoJson?.features.map((feat, idx) => {
              const d = feat.geometry.coordinates
                .map((pos, pIdx) => {
                  const [x, y] = toSvgXY(pos[0], pos[1]);
                  return `${pIdx === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
                })
                .join(' ');
              return (
                <path
                  key={`flow-${idx}`}
                  d={d}
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                />
              );
            })}

          {/* Contours */}
          {showContours &&
            contours.features.map((feat, idx) => {
              if (feat.geometry?.type !== 'LineString') return null;
              const line = feat.geometry as LineString;
              const isIndex = Boolean(feat.properties?.isIndex);
              const d = line.coordinates
                .map((pos, pIdx) => {
                  const [x, y] = toSvgXY(pos[0], pos[1]);
                  return `${pIdx === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
                })
                .join(' ');
              return (
                <path
                  key={`c-${idx}`}
                  d={d}
                  fill="none"
                  stroke={isIndex ? '#ffffff' : '#94a3b8'}
                  strokeWidth={isIndex ? 1.5 : 0.85}
                  opacity={isIndex ? 0.9 : 0.65}
                />
              );
            })}

          {/* Parcel Boundary */}
          {primaryPolygon && (
            <polygon
              points={(primaryPolygon.geometry.coordinates[0] ?? [])
                .map((p) => toSvgXY(p[0], p[1]).join(','))
                .join(' ')}
              fill="rgba(61, 174, 233, 0.08)"
              stroke="#38bdf8"
              strokeWidth="2.4"
            />
          )}

          {/* Section A–A' Line */}
          {(() => {
            const [ax, ay] = toSvgXY(sectionStart[0], sectionStart[1]);
            const [bx, by] = toSvgXY(sectionEnd[0], sectionEnd[1]);
            return (
              <g>
                <line
                  x1={ax}
                  y1={ay}
                  x2={bx}
                  y2={by}
                  stroke="#fbbf24"
                  strokeWidth="2.2"
                  strokeDasharray="5 3"
                />
                <circle
                  cx={ax}
                  cy={ay}
                  r="4.5"
                  fill="#34d399"
                  stroke="#0b1017"
                  strokeWidth="1.5"
                />
                <circle
                  cx={bx}
                  cy={by}
                  r="4.5"
                  fill="#f59e0b"
                  stroke="#0b1017"
                  strokeWidth="1.5"
                />
              </g>
            );
          })()}
        </svg>
      ) : (
        <div
          ref={mapContainerRef}
          className="h-full min-h-[290px] w-full flex-1"
          aria-label="Interactive MapLibre GL Terrain & Hydrology Workstation"
        />
      )}
    </div>
  );
}
