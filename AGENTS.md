# AGENTS.md — Map Lab. DA Engineering & Product Governance

All engineers and coding agents working in this repository MUST follow these non-negotiable commercial-grade rules derived from the **Map Lab. DA Blueprint**.

## 1. Product Identity & Universal 8-State Australian Parity
- **Brand:** **Map Lab. DA** — Commercial Australian Parcel, Civil Terrain, Hydrology & Development Intelligence Platform.
- **Universal 8-State Parity:** Every feature, parcel lookup, cadastre overlay, capital quick-jump, MGA2020 zone projection (`EPSG:7849`–`EPSG:7856`), statutory transfer duty model, planning authority disclosure, and environmental constraint screening MUST work consistently across all **8 Australian states and territories (`NSW`, `VIC`, `QLD`, `WA`, `SA`, `TAS`, `ACT`, `NT`)**.
- **Zero Single-State Lock-In:** Never ship VIC-only parcel buttons, hardcoded single-state placeholders, or state-locked tools.

## 2. Non-Negotiable Business & Data Rules
- **No Double Actions (Idempotency):** Every primary mutating or heavy action (`Save Site`, `Delete Site`, `Optimize RLV`, `Export PDF/LandXML/DXF`) MUST guard against rapid multi-clicks and refreshes—disabling while in flight and processing strictly once with zero duplicate records.
- **Strict Private Data Wall:** Saved deals, custom unit rates, and feasibility snapshots belong strictly to the authenticated user (`auth.uid() = user_id` under PostgreSQL Row-Level Security in Supabase, and strict per-account session isolation in local device vault fallback). User A must never read, search, edit, or delete User B's records even via direct URLs or IDs.
- **Real Saved Data Only:** Persist saved sites cleanly to cloud storage when configured (`VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`) and durable browser storage (`IndexedDB`) as fallback so data survives hard refreshes and session recovery.
- **Polite Input Validation & Error Handling:** Validate all inputs before saving or calculating—reject blank site names, malformed emails, coordinates outside Australia, negative unit rates/areas/yields, and oversized parcels (`> 500 ha`) or undersized parcels (`< 0.02 ha`) with clear plain-English inline messages. Never emit `NaN`, blank crash screens, or raw stack traces.
- **Graceful Service Outages:** When any state GIS server, DEM tile provider, geocoder, or cloud database is unavailable or slow, show a clear plain-English banner with a **Retry** action, preserve unsaved user work, never write corrupted records, and allow immediate fallback to manual boundary drawing / local screening DTM.
- **Provenance & Pre-Feasibility Disclosure:** Every analysis screen and PDF report must disclose the active parcel & elevation source and state that outputs are commercial pre-feasibility screening estimates (not a licensed cadastral survey or certified civil engineering construction design).

## 3. Mobile-First Field Usability & Commercial Quality
- **Mobile First (`390×844`):** Zero horizontal overflow (`scrollWidth <= innerWidth`), thumb-friendly (`>= 44×44px`) field controls, full-screen touch map with collapsible/expandable bottom-sheet inspector, and 1-tap GPS **"Locate My Site"**.
- **Zero-Placeholder Invariant:** No hardcoded mock arrays, dead buttons, `TODO`/`FIXME` comments, or stubbed handlers.
- **Cloud Hosting & Secret Hygiene:** Never hardcode API keys, database service-role keys, or private tokens in client or repo code. Keep all secrets in environment variables, keep strict TypeScript / linter / unit test / security checks active, and ship zero hardcoded `localhost` URLs.
