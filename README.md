# Map Lab. DA

**Commercial Australian Parcel Mapping, Civil Terrain, Hydrology & Deal Intelligence Platform** — built natively on **GDA2020 / MGA2020 (Zones 49–56 / EPSG:7849–7856)** and **Australian Height Datum (AHD)** with universal parity across **all 8 Australian states and territories (`NSW, VIC, QLD, WA, SA, TAS, ACT, NT`)**.

**Live Web App (Vercel Production — Mobile & Desktop):** [https://cutsheet-au-rlfu.vercel.app/](https://cutsheet-au-rlfu.vercel.app/)

[![Import & Deploy on Vercel](https://vercel.com/button)](https://vercel.com/new/import?s=https://github.com/buildinvestmelb-maker/cutsheet-au)

## Key Commercial Capabilities

- **Universal 8-State Cadastral Parcel Mapping & 1-Tap Legal Parcel Snap (`api/cadastre.ts`)**
  - Dedicated Vercel Fluid Compute GIS proxy serving official government cadastral parcel polygons & live boundary overlays across `NSW` (Spatial Services), `VIC` (Vicmap / DataVic), `QLD` (Queensland Spatial), `WA` (Landgate SLIP), `SA` (Location SA / PlanSA), `TAS` (theLIST), `ACT` (ACTmapi), and `NT` (NR Maps / NT Cadastre) with zero CORS failures and graceful outage handling.
  - Works identically in every state and territory — zero single-state lock-in.
- **Connected Cross-App Development Intelligence (`src/engines/deal/mapLabIntelligenceEngine.ts`)**
  - **Paddock-to-Offer Deal Scorecard:** Fuses live civil earthworks (`CutSheet`), environmental constraints (`EnviroSim` AS 3959 BAL + 1% AEP Flood + Riparian), yield & lot sizing (`FormGen`), and iterative 2026–27 8-state statutory stamp duty & Residual Land Value (`Feaso OS`) into a live Max Land Offer Price (`RLV`, `$/m²`, `$/ha`, `$/lot`, Margin %, Est. IRR %).
  - **Earthworks-to-RLV Optimizer:** Sweeps all 4 civil grading strategies (`Best-Fit Plane`, `Auto-Terrace`, `Max Grade %`, `Flat Pad`) across FFL datums to surface the grading configuration that maximises RLV (`+$` uplift).
  - **Unified True Net Developable Area (NDA) & Automated ARR 2019 OSD Basin Sizer:** Combines Horn 3×3 steep slope (`>15%`), Barnes Priority-Flood natural detention storage credit, D8 overland flow channels, BAL-FZ/Flood/Riparian exclusions, and 1% AEP On-Site Detention sizing & costing.
- **Mobile-First Field Engineering (`390×844` & Desktop `1440×900`)**
  - `44×44px` thumb-friendly CAD tool rail, 1-tap GPS `"Locate My Site"`, compact 8-state selector, and interactive `Map | Split | Panel` bottom-sheet mode switcher with zero horizontal overflow.
- **Private Cloud Accounts & Strict Data Wall (`src/data/cloudDealStore.ts` + `supabase/migrations/002_map_lab_da_deals.sql`)**
  - Email/password accounts with strict per-user private saved sites, idempotent save protection, and browser Back/Forward/Refresh state recovery.
  - Supports multi-device cloud persistence via Supabase Auth + Postgres Row-Level Security (`auth.uid() = user_id`), with automatic salted per-account IndexedDB vault fallback when Supabase env vars are omitted.
- **6 Bankable & CAD Engineering Exports**
  - **PDF Civil & Acquisition Memo** (`jsPDF` + `jspdf-autotable`), **LandXML 1.2 TIN**, **AutoCAD DXF Contours**, **Civil BOQ CSV**, **GeoJSON**, and **MGA2020 XYZ CSV**.

## Optional Multi-Device Cloud Sync (Supabase + Vercel)

To enable multi-device cloud sync across browsers and mobile devices, run [`supabase/migrations/002_map_lab_da_deals.sql`](./supabase/migrations/002_map_lab_da_deals.sql) in your Supabase project and configure these Environment Variables in your Vercel project settings:

```env
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-public-key>
```

## Development & Verification

```bash
npm install
npm run dev        # Start local Vite 8 dev server
npm run typecheck  # Strict TypeScript checking (app + Vercel api/)
npm run lint       # Oxlint static analysis
npm run test       # Vitest unit tests (8-state parity, RLV, OSD, privacy wall, exports)
npm run build      # Production bundle (dist/)
```
