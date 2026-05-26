# Bilkoll

Swedish car valuation web app. User enters a registration number → gets market price based on live Blocket listings.

## Stack
- **Frontend:** Next.js 15 + Tailwind CSS + custom CSS variables (`app/globals.css`)
- **Python tools:** `../tools/` (relative to this directory) — called as subprocesses via `app/api/_python.ts`

## Project structure
```
app/
  page.tsx               # Full SPA — landing / loading / results states
  globals.css            # All custom CSS (CSS variables, plate styling, cards)
  layout.tsx             # Root layout + Google Fonts
  api/
    _python.ts           # Shared helper: spawns python/python3/py, tries all three
    lookup/route.ts      # GET /api/lookup?reg=GXC991 → calls lookup_vehicle.py
    listings/route.ts    # GET /api/listings?make=audi&model=a6&year=2016 → calls scrape_blocket.py
../tools/
  lookup_vehicle.py      # Scrapes biluppgifter.se (then car.info fallback) for vehicle specs
  scrape_blocket.py      # Scrapes Blocket HTML articles for comparable listings
```

## Key behaviours
- All API routes fall back silently — null vehicle → mock Volvo, empty listings → mock listings
- Vehicle lookup: `biluppgifter.se/fordon/{REG}/` parses `<div class="info"><em>value</em><span>label</span></div>`
- Blocket scraper: parses `<article>` elements, no Accept-Encoding header (avoids brotli decode issue)
- Python spawn: never use `spawn('python', ...)` directly — always use `runPython()` from `_python.ts`
- CSS: avoid Tailwind for custom components — use named classes in globals.css instead

## Running
```bash
npm run dev        # starts on localhost:3000
```
```bash
# From parent directory (c:\Users\axelg\Pictures\Screenshots)
python tools/lookup_vehicle.py --reg GXC991
python tools/scrape_blocket.py --make audi --model a6 --year 2016 --count 10
```

## Known issues / next steps
- Vehicle model string from biluppgifter includes generation code (e.g. "A6 C7 Avant") — fine to keep
- Blocket search uses base model only (first word of model string) — `baseModel()` in page.tsx
- Verdict card only shows when user enters an asking price (optional field on landing or inline on results)
- Listings links are real Blocket URLs
