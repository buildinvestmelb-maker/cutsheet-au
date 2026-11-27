import type { Feature, FeatureCollection, LineString, Position } from 'geojson';
import { gridCellToLngLat, type ElevationGrid } from './demLoader';

interface GridSegment {
  a: [number, number];
  b: [number, number];
}

function interpEdge(
  vA: number,
  vB: number,
  level: number,
  rA: number,
  cA: number,
  rB: number,
  cB: number,
): [number, number] {
  const denom = vB - vA;
  const t =
    Math.abs(denom) < 1e-12 ? 0.5 : Math.min(1, Math.max(0, (level - vA) / denom));
  return [rA + (rB - rA) * t, cA + (cB - cA) * t];
}

function pointKey(pt: [number, number]): string {
  return `${Math.round(pt[0] * 1e5)}:${Math.round(pt[1] * 1e5)}`;
}

/**
 * Chains unordered Marching Squares grid segments into continuous polylines
 * for crisp GeoJSON LineString rendering and CAD DXF export.
 */
function chainSegments(segments: GridSegment[]): Array<Array<[number, number]>> {
  if (segments.length === 0) return [];

  const adjacency = new Map<string, number[]>();
  const addEdge = (key: string, segIdx: number): void => {
    const list = adjacency.get(key);
    if (list) {
      list.push(segIdx);
    } else {
      adjacency.set(key, [segIdx]);
    }
  };

  for (let i = 0; i < segments.length; i += 1) {
    addEdge(pointKey(segments[i].a), i);
    addEdge(pointKey(segments[i].b), i);
  }

  const visited = new Uint8Array(segments.length);
  const polylines: Array<Array<[number, number]>> = [];

  const extendChain = (
    chain: Array<[number, number]>,
    atEnd: boolean,
  ): void => {
    while (true) {
      const tip = atEnd ? chain[chain.length - 1] : chain[0];
      const candidates = adjacency.get(pointKey(tip));
      if (!candidates) break;

      let matched = false;
      for (const segIdx of candidates) {
        if (visited[segIdx]) continue;
        visited[segIdx] = 1;
        const seg = segments[segIdx];
        const tipKey = pointKey(tip);
        const nextPt = pointKey(seg.a) === tipKey ? seg.b : seg.a;
        if (atEnd) {
          chain.push(nextPt);
        } else {
          chain.unshift(nextPt);
        }
        matched = true;
        break;
      }
      if (!matched) break;
    }
  };

  for (let i = 0; i < segments.length; i += 1) {
    if (visited[i]) continue;
    visited[i] = 1;
    const chain: Array<[number, number]> = [segments[i].a, segments[i].b];
    extendChain(chain, true);
    extendChain(chain, false);
    if (chain.length >= 2) {
      polylines.push(chain);
    }
  }

  return polylines;
}

/**
 * Generates topographic elevation contour LineString features from an ElevationGrid
 * using the Marching Squares algorithm with saddle disambiguation and 5th-index tagging.
 */
export function generateElevationContours(
  grid: ElevationGrid,
  intervalM: number,
): FeatureCollection {
  const safeInterval =
    Number.isFinite(intervalM) && intervalM > 0
      ? Math.max(0.05, intervalM)
      : 0.5;

  if (
    grid.rows < 2 ||
    grid.cols < 2 ||
    !Number.isFinite(grid.minAHD) ||
    !Number.isFinite(grid.maxAHD) ||
    grid.maxAHD - grid.minAHD < 1e-6
  ) {
    return { type: 'FeatureCollection', features: [] };
  }

  const firstIdx = Math.ceil(grid.minAHD / safeInterval);
  const lastIdx = Math.floor(grid.maxAHD / safeInterval);
  if (lastIdx < firstIdx) {
    return { type: 'FeatureCollection', features: [] };
  }

  // Cap total contour levels at 200 for safety on extreme mountain reliefs
  const totalLevels = lastIdx - firstIdx + 1;
  const stepMultiplier = totalLevels > 200 ? Math.ceil(totalLevels / 200) : 1;

  const features: Feature<LineString>[] = [];

  for (let lvlIdx = firstIdx; lvlIdx <= lastIdx; lvlIdx += stepMultiplier) {
    const level = Number((lvlIdx * safeInterval).toFixed(4));
    const isIndex = lvlIdx % 5 === 0;
    const segments: GridSegment[] = [];

    for (let r = 0; r < grid.rows - 1; r += 1) {
      for (let c = 0; c < grid.cols - 1; c += 1) {
        const tl = grid.elevationsAHD[r * grid.cols + c];
        const tr = grid.elevationsAHD[r * grid.cols + (c + 1)];
        const br = grid.elevationsAHD[(r + 1) * grid.cols + (c + 1)];
        const bl = grid.elevationsAHD[(r + 1) * grid.cols + c];

        const mask =
          (tl >= level ? 8 : 0) |
          (tr >= level ? 4 : 0) |
          (br >= level ? 2 : 0) |
          (bl >= level ? 1 : 0);

        if (mask === 0 || mask === 15) continue;

        const topPt = () => interpEdge(tl, tr, level, r, c, r, c + 1);
        const rightPt = () => interpEdge(tr, br, level, r, c + 1, r + 1, c + 1);
        const bottomPt = () => interpEdge(bl, br, level, r + 1, c, r + 1, c + 1);
        const leftPt = () => interpEdge(tl, bl, level, r, c, r + 1, c);

        switch (mask) {
          case 1:
          case 14:
            segments.push({ a: leftPt(), b: bottomPt() });
            break;
          case 2:
          case 13:
            segments.push({ a: bottomPt(), b: rightPt() });
            break;
          case 3:
          case 12:
            segments.push({ a: leftPt(), b: rightPt() });
            break;
          case 4:
          case 11:
            segments.push({ a: topPt(), b: rightPt() });
            break;
          case 5: {
            // Saddle case: disambiguate using cell center average
            const center = (tl + tr + br + bl) / 4;
            if (center >= level) {
              segments.push({ a: leftPt(), b: topPt() });
              segments.push({ a: bottomPt(), b: rightPt() });
            } else {
              segments.push({ a: leftPt(), b: bottomPt() });
              segments.push({ a: topPt(), b: rightPt() });
            }
            break;
          }
          case 6:
          case 9:
            segments.push({ a: topPt(), b: bottomPt() });
            break;
          case 7:
          case 8:
            segments.push({ a: leftPt(), b: topPt() });
            break;
          case 10: {
            // Saddle case: disambiguate using cell center average
            const center = (tl + tr + br + bl) / 4;
            if (center >= level) {
              segments.push({ a: leftPt(), b: bottomPt() });
              segments.push({ a: topPt(), b: rightPt() });
            } else {
              segments.push({ a: leftPt(), b: topPt() });
              segments.push({ a: bottomPt(), b: rightPt() });
            }
            break;
          }
          default:
            break;
        }
      }
    }

    const chains = chainSegments(segments);
    for (const chain of chains) {
      const coords: Position[] = chain.map(([rowF, colF]) => {
        const [lng, lat] = gridCellToLngLat(grid, rowF, colF);
        return [Number(lng.toFixed(7)), Number(lat.toFixed(7))];
      });
      if (coords.length < 2) continue;

      features.push({
        type: 'Feature',
        properties: {
          elevationAHD: Number(level.toFixed(3)),
          isIndex,
          intervalM: safeInterval,
        },
        geometry: {
          type: 'LineString',
          coordinates: coords,
        },
      });
    }
  }

  return {
    type: 'FeatureCollection',
    features,
  };
}
