import type { FeatureCollection } from 'geojson';
import {
  Box,
  Grid,
  Layers,
  Pause,
  Play,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import * as THREE from 'three';
import {
  getGridCellMetrics,
  sampleElevationAtLngLat,
  type ElevationGrid,
} from '../../engines/earthworks/demLoader';
import type { EarthworksGridResult } from '../../engines/earthworks/gridVolumeEngine';
import { extractPrimaryPolygon } from '../../engines/geo/auGeoKernel';

export interface TerrainViewport3DProps {
  grid: ElevationGrid;
  earthworksResult: EarthworksGridResult;
  boundaryGeoJson?: FeatureCollection;
  targetFflAHD: number;
  padSlopePct: number;
  renderActive: boolean;
  onFrameTick: () => void;
  verticalExaggeration: number;
  onVerticalExaggerationChange: (val: number) => void;
  showWireframe: boolean;
  onShowWireframeChange: (val: boolean) => void;
  showFflPlane: boolean;
  onShowFflPlaneChange: (val: boolean) => void;
  fullBleed?: boolean;
}

interface OrbitState {
  theta: number;
  phi: number;
  radius: number;
  autoOrbit: boolean;
  dragging: boolean;
  lastX: number;
  lastY: number;
}

const DEFAULT_ORBIT: Pick<OrbitState, 'theta' | 'phi' | 'radius'> = {
  theta: 0.72,
  phi: 0.95,
  radius: 142,
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function computeVertColor(
  inside: boolean,
  delta: number,
  elevNorm: number,
  maxCut: number,
  maxFill: number,
): [number, number, number] {
  if (!inside) {
    // Muted topo slate outside cadastral boundary
    const shade = clamp(elevNorm, 0, 1);
    return [
      lerp(0.15, 0.28, shade),
      lerp(0.2, 0.34, shade),
      lerp(0.27, 0.43, shade),
    ];
  }

  if (Math.abs(delta) <= 0.14) {
    // Balanced grade contour band (cyan)
    return [0.18, 0.79, 0.94];
  }

  if (delta > 0) {
    // Cut zone (amber -> deep orange)
    const t = clamp(delta / Math.max(1.2, maxCut), 0, 1);
    return [
      lerp(0.98, 0.92, t),
      lerp(0.76, 0.36, t),
      lerp(0.16, 0.05, t),
    ];
  }

  // Fill zone (mint emerald -> deep teal)
  const t = clamp(-delta / Math.max(1.2, maxFill), 0, 1);
  return [
    lerp(0.22, 0.03, t),
    lerp(0.84, 0.56, t),
    lerp(0.61, 0.42, t),
  ];
}

function computeScaleParams(grid: ElevationGrid, verticalExaggeration: number) {
  const metrics = getGridCellMetrics(grid);
  const maxSpan = Math.max(metrics.spanEastM, metrics.spanNorthM, 1);
  const sceneScale = 112 / maxSpan;
  const planeW = metrics.spanEastM * sceneScale;
  const planeD = metrics.spanNorthM * sceneScale;
  const reliefSpan = Math.max(1.8, grid.maxAHD - grid.minAHD);
  const baseVertScale = clamp(7.5 / reliefSpan, sceneScale * 1.4, sceneScale * 4.5);
  const vertScale = baseVertScale * (verticalExaggeration / 2);
  return {
    metrics,
    sceneScale,
    planeW,
    planeD,
    vertScale,
    baseAHD: grid.meanAHD,
  };
}

/**
 * 12d Model / Civil 3D-class Three.js WebGL2 3D Terrain & Cut/Fill Viewport.
 * Displaces PlaneGeometry from ElevationGrid, applies Cut (amber) / Fill (emerald) /
 * Balanced (cyan) per-vertex shading, renders translucent Design FFL plane and
 * draped cadastral parcel boundary, strictly gates rAF on OS_RENDER_STATE,
 * and falls back cleanly to an interactive isometric 2D canvas if WebGL2 fails.
 */
export function TerrainViewport3D({
  grid,
  earthworksResult,
  boundaryGeoJson,
  targetFflAHD,
  padSlopePct,
  renderActive,
  onFrameTick,
  verticalExaggeration,
  onVerticalExaggerationChange,
  showWireframe,
  onShowWireframeChange,
  showFflPlane,
  onShowFflPlaneChange,
  fullBleed = false,
}: TerrainViewport3DProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const webglCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fallbackCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [useFallback2D, setUseFallback2D] = useState<boolean>(false);
  const [autoOrbitUi, setAutoOrbitUi] = useState<boolean>(true);

  const orbitRef = useRef<OrbitState>({
    ...DEFAULT_ORBIT,
    autoOrbit: true,
    dragging: false,
    lastX: 0,
    lastY: 0,
  });

  const renderActiveRef = useRef<boolean>(renderActive);
  const onFrameTickRef = useRef<() => void>(onFrameTick);

  useEffect(() => {
    renderActiveRef.current = renderActive;
    onFrameTickRef.current = onFrameTick;
  }, [renderActive, onFrameTick]);

  // Three.js scene objects kept in refs for leak-free disposal & rapid updates
  const threeRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    terrainGroup: THREE.Group;
    disposeGroup: () => void;
    renderOnce: () => void;
  } | null>(null);

  const applyCameraFromOrbit = useCallback(
    (camera: THREE.PerspectiveCamera) => {
      const { theta, phi, radius } = orbitRef.current;
      const sinPhi = Math.sin(phi);
      camera.position.set(
        radius * sinPhi * Math.sin(theta),
        radius * Math.cos(phi),
        radius * sinPhi * Math.cos(theta),
      );
      camera.lookAt(0, 0, 0);
    },
    [],
  );

  // Initialize Three.js WebGLRenderer once (with clean StrictMode disposal)
  useEffect(() => {
    if (useFallback2D) return;
    const canvas = webglCanvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
        powerPreference: 'high-performance',
      });
    } catch {
      queueMicrotask(() => setUseFallback2D(true));
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setClearColor(0x0b1017, 1);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0b1017, 0.0022);

    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.5, 1600);
    applyCameraFromOrbit(camera);
    renderer.setSize(width, height, false);

    // Three-point civil lighting rig
    const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x0f172a, 0.98);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
    keyLight.position.set(70, 125, 65);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x3daee9, 0.45);
    rimLight.position.set(-85, 55, -75);
    scene.add(rimLight);

    const terrainGroup = new THREE.Group();
    scene.add(terrainGroup);

    const disposeGroup = () => {
      while (terrainGroup.children.length > 0) {
        const child = terrainGroup.children[0];
        terrainGroup.remove(child);
        if (
          child instanceof THREE.Mesh ||
          child instanceof THREE.Line ||
          child instanceof THREE.LineSegments
        ) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            for (const mat of child.material) mat.dispose();
          } else {
            child.material.dispose();
          }
        } else if (child instanceof THREE.GridHelper) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            for (const mat of child.material) mat.dispose();
          } else {
            child.material.dispose();
          }
        }
      }
    };

    const renderOnce = () => {
      applyCameraFromOrbit(camera);
      renderer.render(scene, camera);
    };

    threeRef.current = {
      renderer,
      scene,
      camera,
      terrainGroup,
      disposeGroup,
      renderOnce,
    };

    const handleContextLost = (evt: Event) => {
      evt.preventDefault();
      setUseFallback2D(true);
    };
    canvas.addEventListener('webglcontextlost', handleContextLost);

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const nextW = Math.max(1, Math.round(entry.contentRect.width));
        const nextH = Math.max(1, Math.round(entry.contentRect.height));
        camera.aspect = nextW / nextH;
        camera.updateProjectionMatrix();
        renderer.setSize(nextW, nextH, false);
        renderOnce();
      }
    });
    resizeObserver.observe(container);

    return () => {
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      resizeObserver.disconnect();
      disposeGroup();
      scene.clear();
      renderer.dispose();
      threeRef.current = null;
    };
  }, [applyCameraFromOrbit, useFallback2D]);

  // Rebuild 3D Terrain Mesh, FFL Design Plane, and Draped Parcel Boundary whenever DEM/grading changes
  useEffect(() => {
    if (useFallback2D) return;
    const ctx = threeRef.current;
    if (!ctx) return;

    ctx.disposeGroup();

    const { planeW, planeD, vertScale, baseAHD, sceneScale } =
      computeScaleParams(grid, verticalExaggeration);

    const segX = Math.max(1, grid.cols - 1);
    const segY = Math.max(1, grid.rows - 1);
    const terrainGeo = new THREE.PlaneGeometry(planeW, planeD, segX, segY);
    terrainGeo.rotateX(-Math.PI / 2);

    const posAttr = terrainGeo.attributes.position as THREE.BufferAttribute;
    const count = posAttr.count;
    const colors = new Float32Array(count * 3);
    const elevSpan = Math.max(0.01, grid.maxAHD - grid.minAHD);

    let minY = Number.POSITIVE_INFINITY;
    for (let r = 0; r < grid.rows; r += 1) {
      for (let c = 0; c < grid.cols; c += 1) {
        const idx = r * grid.cols + c;
        if (idx >= count) continue;
        const elev = grid.elevationsAHD[idx] ?? baseAHD;
        const y = (elev - baseAHD) * vertScale;
        if (y < minY) minY = y;
        posAttr.setY(idx, y);

        const inside = earthworksResult.insideMask[idx] === 1;
        const delta = earthworksResult.deltaGrid[idx] ?? 0;
        const elevNorm = (elev - grid.minAHD) / elevSpan;
        const [cr, cg, cb] = computeVertColor(
          inside,
          delta,
          elevNorm,
          earthworksResult.maxCutDepthM,
          earthworksResult.maxFillDepthM,
        );
        colors[idx * 3] = cr;
        colors[idx * 3 + 1] = cg;
        colors[idx * 3 + 2] = cb;
      }
    }

    posAttr.needsUpdate = true;
    terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    terrainGeo.computeVertexNormals();

    const terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.72,
      metalness: 0.08,
      side: THREE.DoubleSide,
    });
    const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
    ctx.terrainGroup.add(terrainMesh);

    if (showWireframe) {
      const wireGeo = terrainGeo.clone();
      const wireMat = new THREE.MeshBasicMaterial({
        color: 0x94a3b8,
        wireframe: true,
        transparent: true,
        opacity: 0.24,
      });
      const wireMesh = new THREE.Mesh(wireGeo, wireMat);
      wireMesh.position.y = 0.08;
      ctx.terrainGroup.add(wireMesh);
    }

    // Draped Cadastral Parcel Boundary Outline
    const primaryPoly = extractPrimaryPolygon(boundaryGeoJson);
    if (primaryPoly) {
      const [minLng, minLat, maxLng, maxLat] = grid.boundsWgs84;
      const lngSpan = Math.max(1e-9, maxLng - minLng);
      const latSpan = Math.max(1e-9, maxLat - minLat);
      const ring = primaryPoly.geometry.coordinates[0] ?? [];
      const linePts: THREE.Vector3[] = [];
      for (const pos of ring) {
        const u = (pos[0] - minLng) / lngSpan;
        const v = (maxLat - pos[1]) / latSpan;
        const sx = (u - 0.5) * planeW;
        const sz = (v - 0.5) * planeD;
        const elev = sampleElevationAtLngLat(grid, pos[0], pos[1]);
        const sy = (elev - baseAHD) * vertScale + 0.55;
        linePts.push(new THREE.Vector3(sx, sy, sz));
      }
      if (linePts.length >= 2) {
        const borderGeo = new THREE.BufferGeometry().setFromPoints(linePts);
        const borderMat = new THREE.LineBasicMaterial({
          color: 0x3daee9,
        });
        ctx.terrainGroup.add(new THREE.Line(borderGeo, borderMat));
      }
    }

    // Translucent Cyan Design FFL Plane (honours targetFflAHD & padSlopePct)
    if (showFflPlane) {
      const fflW = planeW * 0.86;
      const fflD = planeD * 0.86;
      const fflGeo = new THREE.PlaneGeometry(fflW, fflD, 1, 8);
      fflGeo.rotateX(-Math.PI / 2);
      const fflPos = fflGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < fflPos.count; i += 1) {
        const z = fflPos.getZ(i);
        const northOffsetM = -z / sceneScale;
        const proposedAtZ = targetFflAHD + (padSlopePct / 100) * northOffsetM;
        fflPos.setY(i, (proposedAtZ - baseAHD) * vertScale);
      }
      fflPos.needsUpdate = true;
      fflGeo.computeVertexNormals();

      const fflMat = new THREE.MeshStandardMaterial({
        color: 0x3daee9,
        emissive: 0x0c4a6e,
        emissiveIntensity: 0.35,
        transparent: true,
        opacity: 0.28,
        roughness: 0.25,
        metalness: 0.1,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      ctx.terrainGroup.add(new THREE.Mesh(fflGeo, fflMat));

      const edgeGeo = new THREE.EdgesGeometry(fflGeo);
      const edgeMat = new THREE.LineBasicMaterial({
        color: 0x7dd3fc,
        transparent: true,
        opacity: 0.85,
      });
      ctx.terrainGroup.add(new THREE.LineSegments(edgeGeo, edgeMat));
    }

    // Reference Datum Grid below terrain
    const gridHelper = new THREE.GridHelper(138, 18, 0x263547, 0x16202c);
    gridHelper.position.y = (Number.isFinite(minY) ? minY : -4) - 2.4;
    ctx.terrainGroup.add(gridHelper);

    ctx.renderOnce();
  }, [
    boundaryGeoJson,
    earthworksResult,
    grid,
    padSlopePct,
    showFflPlane,
    showWireframe,
    targetFflAHD,
    useFallback2D,
    verticalExaggeration,
  ]);

  // 2D Isometric Canvas Fallback Renderer
  const drawFallback2DFrame = useCallback(() => {
    const canvas = fallbackCanvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const cssW = Math.max(1, container.clientWidth);
    const cssH = Math.max(1, container.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetW = Math.round(cssW * dpr);
    const targetH = Math.round(cssH * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b1017';
    ctx.fillRect(0, 0, cssW, cssH);

    const { planeW, planeD, vertScale, baseAHD } = computeScaleParams(
      grid,
      verticalExaggeration,
    );
    const { theta, phi, radius } = orbitRef.current;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const cosP = Math.cos(phi);
    const sinP = Math.sin(phi);
    const scale2D = (Math.min(cssW, cssH) * 1.15) / Math.max(60, radius);

    const project = (x: number, y: number, z: number): [number, number] => {
      const rx = x * cosT - z * sinT;
      const rz = x * sinT + z * cosT;
      const py = y * sinP - rz * cosP;
      return [cssW * 0.5 + rx * scale2D, cssH * 0.56 - py * scale2D];
    };

    // Subsample grid cleanly for fast 2D fallback quads
    const stepR = Math.max(1, Math.floor(grid.rows / 22));
    const stepC = Math.max(1, Math.floor(grid.cols / 22));
    const elevSpan = Math.max(0.01, grid.maxAHD - grid.minAHD);

    for (let r = 0; r < grid.rows - stepR; r += stepR) {
      for (let c = 0; c < grid.cols - stepC; c += stepC) {
        const corners = [
          [r, c],
          [r, Math.min(grid.cols - 1, c + stepC)],
          [Math.min(grid.rows - 1, r + stepR), Math.min(grid.cols - 1, c + stepC)],
          [Math.min(grid.rows - 1, r + stepR), c],
        ];
        const pts: Array<[number, number]> = corners.map(([rr, cc]) => {
          const u = cc / Math.max(1, grid.cols - 1);
          const v = rr / Math.max(1, grid.rows - 1);
          const elev = grid.elevationsAHD[rr * grid.cols + cc] ?? baseAHD;
          return project(
            (u - 0.5) * planeW,
            (elev - baseAHD) * vertScale,
            (v - 0.5) * planeD,
          );
        });

        const idx = r * grid.cols + c;
        const inside = earthworksResult.insideMask[idx] === 1;
        const delta = earthworksResult.deltaGrid[idx] ?? 0;
        const elevNorm = ((grid.elevationsAHD[idx] ?? baseAHD) - grid.minAHD) / elevSpan;
        const [cr, cg, cb] = computeVertColor(
          inside,
          delta,
          elevNorm,
          earthworksResult.maxCutDepthM,
          earthworksResult.maxFillDepthM,
        );

        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        ctx.lineTo(pts[1][0], pts[1][1]);
        ctx.lineTo(pts[2][0], pts[2][1]);
        ctx.lineTo(pts[3][0], pts[3][1]);
        ctx.closePath();
        ctx.fillStyle = `rgb(${Math.round(cr * 255)}, ${Math.round(cg * 255)}, ${Math.round(cb * 255)})`;
        ctx.fill();
        if (showWireframe) {
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.28)';
          ctx.lineWidth = 0.6;
          ctx.stroke();
        }
      }
    }

    if (showFflPlane) {
      const fflY = (targetFflAHD - baseAHD) * vertScale;
      const hw = planeW * 0.43;
      const hd = planeD * 0.43;
      const p1 = project(-hw, fflY, -hd);
      const p2 = project(hw, fflY, -hd);
      const p3 = project(hw, fflY, hd);
      const p4 = project(-hw, fflY, hd);
      ctx.beginPath();
      ctx.moveTo(p1[0], p1[1]);
      ctx.lineTo(p2[0], p2[1]);
      ctx.lineTo(p3[0], p3[1]);
      ctx.lineTo(p4[0], p4[1]);
      ctx.closePath();
      ctx.fillStyle = 'rgba(61, 174, 233, 0.24)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(125, 211, 252, 0.85)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
  }, [
    earthworksResult,
    grid,
    showFflPlane,
    showWireframe,
    targetFflAHD,
    verticalExaggeration,
  ]);

  // Strict OS_RENDER_STATE requestAnimationFrame loop (pauses cleanly when renderActive === false)
  useEffect(() => {
    let rafId: number | null = null;
    let disposed = false;

    const renderSingleFrame = () => {
      if (useFallback2D) {
        drawFallback2DFrame();
      } else {
        threeRef.current?.renderOnce();
      }
    };

    if (!renderActive) {
      // Draw a single static frame so state changes remain crisp, then stay completely idle
      renderSingleFrame();
      return () => {
        disposed = true;
      };
    }

    const tick = () => {
      if (disposed || !renderActiveRef.current) return;

      const orbit = orbitRef.current;
      if (orbit.autoOrbit && !orbit.dragging) {
        orbit.theta += 0.0028;
      }

      renderSingleFrame();
      onFrameTickRef.current();
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);

    return () => {
      disposed = true;
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [drawFallback2DFrame, renderActive, useFallback2D]);

  const requestStaticRedraw = useCallback(() => {
    if (!renderActiveRef.current) {
      if (useFallback2D) {
        drawFallback2DFrame();
      } else {
        threeRef.current?.renderOnce();
      }
    }
  }, [drawFallback2DFrame, useFallback2D]);

  const handlePointerDown = (evt: ReactPointerEvent<HTMLDivElement>) => {
    evt.currentTarget.setPointerCapture(evt.pointerId);
    orbitRef.current.dragging = true;
    orbitRef.current.autoOrbit = false;
    orbitRef.current.lastX = evt.clientX;
    orbitRef.current.lastY = evt.clientY;
    setAutoOrbitUi(false);
  };

  const handlePointerMove = (evt: ReactPointerEvent<HTMLDivElement>) => {
    if (!orbitRef.current.dragging) return;
    const dx = evt.clientX - orbitRef.current.lastX;
    const dy = evt.clientY - orbitRef.current.lastY;
    orbitRef.current.lastX = evt.clientX;
    orbitRef.current.lastY = evt.clientY;
    orbitRef.current.theta -= dx * 0.008;
    orbitRef.current.phi = clamp(
      orbitRef.current.phi - dy * 0.007,
      0.24,
      Math.PI / 2 - 0.08,
    );
    requestStaticRedraw();
  };

  const handlePointerUp = (evt: ReactPointerEvent<HTMLDivElement>) => {
    if (evt.currentTarget.hasPointerCapture(evt.pointerId)) {
      evt.currentTarget.releasePointerCapture(evt.pointerId);
    }
    orbitRef.current.dragging = false;
  };

  const handleWheel = (evt: ReactWheelEvent<HTMLDivElement>) => {
    evt.preventDefault();
    const factor = evt.deltaY > 0 ? 1.08 : 0.92;
    orbitRef.current.radius = clamp(orbitRef.current.radius * factor, 56, 250);
    requestStaticRedraw();
  };

  const handleZoom = (direction: 'in' | 'out') => {
    orbitRef.current.radius = clamp(
      orbitRef.current.radius * (direction === 'in' ? 0.84 : 1.18),
      56,
      250,
    );
    requestStaticRedraw();
  };

  const handleResetView = () => {
    orbitRef.current.theta = DEFAULT_ORBIT.theta;
    orbitRef.current.phi = DEFAULT_ORBIT.phi;
    orbitRef.current.radius = DEFAULT_ORBIT.radius;
    orbitRef.current.autoOrbit = true;
    setAutoOrbitUi(true);
    requestStaticRedraw();
  };

  const toggleAutoOrbit = () => {
    const next = !orbitRef.current.autoOrbit;
    orbitRef.current.autoOrbit = next;
    setAutoOrbitUi(next);
  };

  return (
    <div
      data-testid="cutsheet-3d-viewport"
      className={
        fullBleed
          ? 'flex min-h-[290px] w-full flex-1 flex-col overflow-hidden bg-[#0b1017]'
          : 'flex flex-col overflow-hidden rounded-xl border border-slate-400/15 bg-[#0b1017]'
      }
    >
      {/* 3D Canvas Stage */}
      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
        className={
          fullBleed
            ? 'relative min-h-[260px] w-full flex-1 cursor-grab select-none overflow-hidden active:cursor-grabbing'
            : 'relative h-[250px] w-full cursor-grab select-none overflow-hidden active:cursor-grabbing sm:h-[290px]'
        }
        style={{ touchAction: 'none' }}
      >
        {useFallback2D ? (
          <canvas
            ref={fallbackCanvasRef}
            id="terrain-canvas"
            className="block h-full w-full"
          />
        ) : (
          <canvas
            ref={webglCanvasRef}
            id="terrain-canvas"
            className="block h-full w-full"
          />
        )}

        {/* Top Non-Overlapping HUD Bar (Legend + Camera Controls) */}
        <div className="pointer-events-none absolute top-2 right-2 left-2 flex flex-wrap items-center justify-between gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-400/18 bg-[#0c1118]/85 px-2 py-1 font-mono-tech text-[10px] text-slate-200 backdrop-blur-md">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-xs bg-amber-400" />
              Cut
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-xs bg-emerald-400" />
              Fill
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-xs bg-sky-400" />
              FFL
            </span>
            <span className="hidden text-slate-400 sm:inline">
              {useFallback2D ? '2D Iso Fallback' : 'WebGL2 3D'}
            </span>
          </div>

          <div
            className="pointer-events-auto flex items-center gap-1"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={toggleAutoOrbit}
              title={autoOrbitUi ? 'Pause auto-orbit' : 'Resume auto-orbit'}
              className={`inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border text-xs transition-colors backdrop-blur-md ${
                autoOrbitUi
                  ? 'border-[#3daee9]/45 bg-[#3daee9]/18 text-sky-200'
                  : 'border-slate-400/20 bg-[#0c1118]/80 text-slate-300 hover:text-white'
              }`}
            >
              {autoOrbitUi ? <Pause size={12} /> : <Play size={12} />}
            </button>
            <button
              type="button"
              onClick={() => handleZoom('in')}
              title="Zoom in"
              className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-slate-400/20 bg-[#0c1118]/80 text-slate-200 transition-colors hover:border-[#3daee9]/50 hover:text-white backdrop-blur-md"
            >
              <ZoomIn size={13} />
            </button>
            <button
              type="button"
              onClick={() => handleZoom('out')}
              title="Zoom out"
              className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-slate-400/20 bg-[#0c1118]/80 text-slate-200 transition-colors hover:border-[#3daee9]/50 hover:text-white backdrop-blur-md"
            >
              <ZoomOut size={13} />
            </button>
            <button
              type="button"
              onClick={handleResetView}
              title="Reset 3D camera"
              className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-slate-400/20 bg-[#0c1118]/80 text-slate-200 transition-colors hover:border-[#3daee9]/50 hover:text-white backdrop-blur-md"
            >
              <RotateCcw size={12} />
            </button>
          </div>
        </div>

        {/* Bottom-Left Elevation & Render Pause Pill */}
        <div className="pointer-events-none absolute right-2.5 bottom-2.5 left-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="rounded-md border border-slate-400/15 bg-[#0c1118]/80 px-2 py-1 font-mono-tech text-[10px] text-slate-300 backdrop-blur-md">
            Elev {grid.minAHD.toFixed(1)}–{grid.maxAHD.toFixed(1)} m AHD • FFL{' '}
            <span className="text-sky-300">{targetFflAHD.toFixed(2)} m</span>
          </div>
          {!renderActive && (
            <div className="rounded-md border border-amber-400/35 bg-amber-500/15 px-2 py-1 font-mono-tech text-[10px] font-semibold text-amber-200 backdrop-blur-md">
              Render Paused (Background)
            </div>
          )}
        </div>
      </div>

      {/* Bottom Viewport Toolbar: Wireframe, FFL Plane, Vertical Exaggeration */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-400/12 bg-[#121821] px-3 py-2 text-[11px]">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            data-testid="cutsheet-wireframe-toggle"
            onClick={() => onShowWireframeChange(!showWireframe)}
            className={`inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
              showWireframe
                ? 'border-[#3daee9]/50 bg-[#3daee9]/16 text-sky-200'
                : 'border-slate-400/18 bg-[#161e29] text-slate-300 hover:text-white'
            }`}
          >
            <Grid size={12} />
            Wireframe
          </button>
          <button
            type="button"
            data-testid="cutsheet-ffl-plane-toggle"
            onClick={() => onShowFflPlaneChange(!showFflPlane)}
            className={`inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
              showFflPlane
                ? 'border-[#3daee9]/50 bg-[#3daee9]/16 text-sky-200'
                : 'border-slate-400/18 bg-[#161e29] text-slate-300 hover:text-white'
            }`}
          >
            <Layers size={12} />
            Design FFL Plane
          </button>
          <span className="hidden items-center gap-1 text-[10.5px] text-slate-400 sm:inline-flex">
            <Box size={11} className="text-slate-500" />
            Drag to orbit • Scroll to zoom
          </span>
        </div>

        <label className="flex items-center gap-2 font-mono-tech text-[10.5px] text-slate-300">
          <span>Z-Exag</span>
          <input
            type="range"
            min={1}
            max={5}
            step={0.25}
            value={verticalExaggeration}
            onChange={(e) => onVerticalExaggerationChange(Number(e.target.value))}
            aria-label="Vertical Exaggeration"
            className="w-20 accent-[#3daee9] sm:w-24"
          />
          <span className="w-8 text-right text-sky-300">
            {verticalExaggeration.toFixed(1)}×
          </span>
        </label>
      </div>
    </div>
  );
}
