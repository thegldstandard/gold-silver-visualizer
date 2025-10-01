
# Gold & Silver Strategy Visualizer

A clean, standalone web app that charts:
- Gold and Silver **prices** (via uploaded Excel/CSV or MetalpriceAPI)
- The **gold/silver ratio** (gold ÷ silver) as a translucent background overlay
- A **strategy portfolio** that switches between gold and silver at user‑chosen ratio thresholds

## Features
- **Start date + End date**, start metal, start amount (USD)
- Toggle lines: **Gold (buy & hold)**, **Silver (buy & hold)**, **My Portfolio**, **G/S Ratio overlay**
- Load **Excel (.xlsx)** or **CSV (date,gold,silver)** to seed local cache (1990–2025 supported)
- Use API **only for missing or newer dates** (default API key included but you can change it)
- **Offline mode** to run from local cache or uploaded Excel/CSV only
- Download current-range CSV for offline reuse

## Quick start (Laptop)
```bash
# 1) Install Node.js 18+ (or 20+)
# 2) In a terminal:
cd gold-silver-visualizer
npm install
npm run dev
# open http://localhost:5173
```

## Use your Excel file (1990–2025)
- Click **Load Excel (.xlsx)…** and pick your file.
- The app parses headers like `date`, `gold`, `silver` (case-insensitive) and common symbols `XAU`, `XAG`.
- Dates should be `YYYY-MM-DD` or Excel serials; both are accepted.
- Your file is **merged into a persistent local cache** so future runs don’t refetch that history.

## API fallback (only when needed)
- If you **extend the end date** beyond your file (e.g., up to today), the app fetches only the **missing range** via MetalpriceAPI.
- The default API key is embedded in `src/App.tsx` (`DEFAULT_API_KEY`). Replace it if you want:
  ```ts
  const DEFAULT_API_KEY = 'YOUR_KEY_HERE';
  ```
- The fetcher is **rate-limit friendly**: chunked by year, exponential backoff, adaptive throttle, and cache.

## CSV format
Minimal CSV:
```csv
date,gold,silver
1990-01-02,401.10,5.02
1990-01-03,402.15,5.05
```
You can also **download CSV** for the current range from the app.

## Deploy to GitHub Pages
1. Create a repo on GitHub (e.g., `gold-silver-visualizer`).
2. Commit this folder and push:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<you>/gold-silver-visualizer.git
   git push -u origin main
   ```
3. Build:
   ```bash
   npm run build
   ```
4. Serve `/dist` on GitHub Pages. Two options:
   - **GitHub Pages from `docs/`**: move `dist` to `docs` and push.
   - **gh-pages branch**: use your preferred deployment method to publish `dist`.

## Notes
- **Data source UI is hidden**. The app uses your Excel/CSV and only hits the API if you’re not in **Offline mode** and the selected window has missing dates.
- All values are in **USD** per oz; ratio is currency‑independent.
- No financial advice — educational/visualization tool only.


---

## New: percentage chart & auto-load data

- The chart now displays **percentage gains** for Gold (buy & hold), Silver (buy & hold), and **My Portfolio**, plus the **difference** vs each buy & hold in **percentage points**.
- To make the app load your prices automatically without any upload UI:
  1. Create a folder `public/data/`
  2. Put your file as **`public/data/prices.csv`** (preferred) or **`public/data/prices.xlsx`**
  3. The app auto-loads this file on startup and uses it as the default history
- CSV headers can be `date,gold,silver` or any of `Date / Gold / Gold USD / XAU` and `Silver / Silver USD / XAG` — all are detected.
- Dates like `01/01/1990` or Excel serials are normalized to ISO internally.
