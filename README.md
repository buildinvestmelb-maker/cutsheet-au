# CutSheet AU Pro

**Commercial Australian GIS Terrain, Hydrology & Bulk Earthworks Workstation** — built natively on **GDA2020 / MGA2020 (Zones 49–56 / EPSG:7849–7856)** and **Australian Height Datum (AHD)**. Runs both **standalone** (ready for 1-click Vercel deployment) and **embedded inside `devaware-os`** with live `@devaware/os-bridge` sync into `Feaso OS`.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/buildinvestmelb-maker/cutsheet-au)

## Core Engineering Capabilities

- **Full-Bleed GIS & CAD Workstation (`MapLibre GL v6` + `Three.js WebGL2`)**
  - Satellite (Esri World Imagery), Dark Vector (OpenFreeMap), and zero-network Offline MGA2020 Grid basemaps + NSW/QLD public cadastre tile overlays.
  - Real-time draped **Terrain Lens** (`Hillshade`, `Civil Slope Bands`, `Cut / Fill Map`) with sun azimuth, sun altitude, vertical exaggeration, and opacity sliders.
  - Interactive CAD toolbar: 1-Click Parcel Snap, Draw Custom Polygon, Draw Site Rectangle, Draw Section A–A' Line, AU Address / `lat, lng` search (Photon AU), Capital City jumps (`Sydney`, `Melbourne`, `Brisbane`, `Perth`, `Adelaide`), `3D Map` pitched view, and full-bleed **3D Studio** (`Three.js WebGL2`).
- **Live Australian DEM Ingestion**
  - **AWS Terrarium DEM** PNG tile streaming (`elevation = R*256 + G + B/256 - 32768`).
  - **ELVIS 1m LiDAR / GeoTIFF** (`geotiff` binary raster parsing with automatic GDA2020/GDA94 EPSG detection).
  - **Survey CSV / XYZ** point clouds interpolated onto metric GDA2020 grids via Inverse Distance Weighting (IDW).
- **Terrain Hydrology & Net Developable Area (`src/engines/earthworks/hydrologyEngine.ts`)**
  - **Horn 3×3 Metric Slope Classification:** 4 Australian civil bands (`0–5% Flat`, `5–10% Moderate`, `10–15% Benching`, `>15% Steep`) with exact `%` and `ha`.
  - **Barnes Priority-Flood Depression Detection:** Identifies enclosed ponding basins (`>0.15 m`), computes natural detention storage (`m³`), and drapes amber depression polygons.
  - **D8 Overland Flow Routing:** Computes steepest-descent drainage direction & upstream contributing catchment (`ha`), rendering width-scaled cyan overland flow channels & Net Developable Area (NDA).
- **4 Civil Grading Solvers & Commercial QS Engine (`src/engines/earthworks/gridVolumeEngine.ts`)**
  - **Best-Fit Plane (OLS)**, **Auto-Terrace Benches**, **Max Grade % Clamped**, and **Flat Pad (Uniform FFL)**.
  - **Target Cut:Fill Ratio** datum solver (`1.00 balanced` → `1.10 compaction` → `1.25 bulking`), **Zero-Balance FFL** binary search optimizer, and **Scenario A Pin** live cost comparison.
  - **AS 2870 Geotechnical Unit Rates** (`Sand`, `Clay`, `Rock`), custom **Edit Rates** drawer, Basalt/Rock Breakout %, Topsoil Strip & Respread, automatic retaining wall step detection (`>0.6 m`), Truck & Dog (`18 m³`) haulage loads, Per-Lot / Per-Ha / Per-m² metrics, and **Terrain Developability Score (`0–100`)**.
- **6 Commercial Engineering Exports & Share Links**
  - **PDF Civil Engineering Report** (`jsPDF` + `jspdf-autotable`), **LandXML 1.2 TIN Surface** (12d Model / Civil 3D), **AutoCAD DXF Contours**, **Civil BOQ CSV**, **GeoJSON**, and **MGA2020 XYZ CSV**, plus zero-backend `#site=...` URL sharing.

## Development & Verification

```bash
npm install
npm run dev        # Start local Vite 8 dev server
npm run typecheck  # Strict TypeScript checking
npm run lint       # Oxlint static analysis
npm run test       # Vitest unit tests (DEM, Hydrology, Grading, Exports)
npm run build      # Production bundle (dist/)
```
