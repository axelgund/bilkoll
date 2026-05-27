'use client'

import { useState, useMemo, useEffect } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

type AppState    = 'landing' | 'loading' | 'results' | 'error'
type StepStatus  = 'idle' | 'active' | 'done'

interface Vehicle {
  make:          string
  model:         string
  year:          number
  fuel:          string
  color:         string
  hp?:           number
  transmission?: string
  mileage?:      number | null
  owners?:       number | null
  consumption?:  number | null
  emissions?:    number | null
  drive?:        string | null
}

interface Listing {
  title:         string
  price:         number
  year:          number | null
  mileage:       number | null
  fuel:          string | null
  transmission:  string | null
  url:           string
  location:      string
}

interface ClassifiedListing extends Listing {
  matched:    boolean
  yearOk:     boolean
  fuelOk:     boolean
  normPrice:  number
  milSimilar: boolean
}

// ── Mock data (shown when real data is unavailable) ───────────────────────────

const MOCK_VEHICLE: Vehicle = {
  make: 'Volvo', model: 'V60 T4 Momentum',
  year: 2019, fuel: 'Bensin', color: 'Blå metallic',
  hp: 190, transmission: 'Automat', mileage: 6500,
}

const MOCK_LISTINGS: Listing[] = [
  { title: 'Volvo V60 T4 Momentum',     price: 249000, year: 2019, mileage: 6200, fuel: 'Bensin',  transmission: 'Automat',  url: '#', location: 'Stockholm' },
  { title: 'Volvo V60 T4 Inscription',  price: 269000, year: 2019, mileage: 5800, fuel: 'Bensin',  transmission: 'Automat',  url: '#', location: 'Göteborg'  },
  { title: 'Volvo V60 T4',              price: 235000, year: 2018, mileage: 8100, fuel: 'Bensin',  transmission: 'Manuell',  url: '#', location: 'Malmö'      },
  { title: 'Volvo V60 T4 R-Design',     price: 279000, year: 2020, mileage: 4500, fuel: 'Bensin',  transmission: 'Automat',  url: '#', location: 'Uppsala'    },
  { title: 'Volvo V60 T4 Momentum',     price: 255000, year: 2019, mileage: 7300, fuel: 'Bensin',  transmission: 'Automat',  url: '#', location: 'Linköping'  },
  { title: 'Volvo V60 T4 Business Pro', price: 239000, year: 2019, mileage: 9000, fuel: 'Bensin',  transmission: 'Automat',  url: '#', location: 'Örebro'     },
]

const STEP_LABELS = [
  'Hämtar fordonsinformation',
  'Söker liknande bilar på Blocket',
  'Beräknar marknadsvärde',
]

// 3% price change per 1 000 Swedish mil (10 000 km)
const RATE_PER_MIL = 0.00003

// ── Helpers ───────────────────────────────────────────────────────────────────

function delay(ms: number) { return new Promise<void>(r => setTimeout(r, ms)) }

function median(prices: number[]): number {
  const s = [...prices].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}

function verdict(asking: number, normMed: number) {
  const pct = (normMed - asking) / normMed
  if (pct >  0.05) return { label: 'Bra pris',     cls: 'good', emoji: '↓' }
  if (pct < -0.05) return { label: 'Dyrt',          cls: 'bad',  emoji: '↑' }
  return                   { label: 'Marknadspris', cls: 'fair', emoji: '~' }
}

function fuelMatch(listFuel: string | null, carFuel: string): boolean {
  if (!listFuel) return true
  const TYPES = ['diesel', 'bensin', 'el', 'hybrid', 'gas', 'etanol']
  const l = listFuel.toLowerCase()
  const c = carFuel.toLowerCase()
  const lType = TYPES.find(f => l.includes(f)) ?? null
  const cType = TYPES.find(f => c.includes(f)) ?? null
  if (!lType || !cType) return true
  if (lType === cType) return true
  if (lType === 'hybrid' || cType === 'hybrid') return lType === cType
  return false
}

function baseModel(model: string) { return model.split(' ')[0] }

function fmt(n: number) { return n.toLocaleString('sv-SE') }

function useCountUp(target: number | null, duration = 750, delay = 220): number | null {
  const [val, setVal] = useState<number | null>(null)
  useEffect(() => {
    if (target === null) { setVal(null); return }
    setVal(0)
    const final = target
    let raf: number
    const t = setTimeout(() => {
      const t0 = performance.now()
      function tick(now: number) {
        const p = Math.min((now - t0) / duration, 1)
        const e = 1 - Math.pow(1 - p, 3)
        setVal(Math.round(final * e))
        if (p < 1) raf = requestAnimationFrame(tick)
        else setVal(final)
      }
      raf = requestAnimationFrame(tick)
    }, delay)
    return () => { clearTimeout(t); cancelAnimationFrame(raf) }
  }, [target, duration, delay])
  return val
}

// ── EU plate strip ────────────────────────────────────────────────────────────

function EuStrip() {
  return (
    <div className="plate-eu">
      <div className="eu-stars">
        {[0,1,2,3,4,5,6,7,8].map(i => (
          <span key={i} style={{ color:'var(--plate-yellow)', fontSize:'5.5px', textAlign:'center', lineHeight:1 }}>
            {i === 4 ? ' ' : '★'}
          </span>
        ))}
      </div>
      <span className="eu-country">S</span>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Home() {
  const [appState,    setAppState]   = useState<AppState>('landing')
  const [regInput,    setRegInput]   = useState('')
  const [askingPrice, setAskingPrice] = useState('')
  const [steps,       setSteps]      = useState<StepStatus[]>(['idle','idle','idle'])
  const [vehicle,     setVehicle]    = useState<Vehicle>(MOCK_VEHICLE)
  const [listings,    setListings]   = useState<Listing[]>(MOCK_LISTINGS)
  const [shared,      setShared]     = useState(false)

  // ── Derived stats ───────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const carMil  = vehicle.mileage ?? null
    const carFuel = vehicle.fuel ?? ''
    const carYear = vehicle.year

    const classified: ClassifiedListing[] = listings.map(l => {
      const yearOk  = l.year === null || Math.abs(l.year - carYear) <= 2
      const fuelOk  = fuelMatch(l.fuel, carFuel)
      const matched = yearOk && fuelOk

      const normPrice = (carMil !== null && l.mileage !== null)
        ? Math.round(l.price * (1 + (l.mileage - carMil) * RATE_PER_MIL))
        : l.price

      const milSimilar = carMil !== null && l.mileage !== null
        && Math.abs(l.mileage - carMil) <= Math.max(carMil * 0.35, 1500)

      return { ...l, matched, yearOk, fuelOk, normPrice, milSimilar }
    })

    const matchedSet  = classified.filter(l => l.matched)
    const forStats    = matchedSet.length >= 3 ? matchedSet : classified
    const filteredOut = classified.length - forStats.length

    const rawPrices  = forStats.map(l => l.price)
    const normPrices = forStats.map(l => l.normPrice)
    if (!rawPrices.length) return null

    const med     = median(rawPrices)
    const normMed = median(normPrices)
    const min     = Math.min(...rawPrices)
    const max     = Math.max(...rawPrices)

    const mileages = forStats.map(l => l.mileage).filter((m): m is number => m !== null)
    const avgMil   = mileages.length
      ? Math.round(mileages.reduce((a, b) => a + b, 0) / mileages.length)
      : null

    const suggestedLow  = Math.round(normMed * 0.93)
    const suggestedHigh = Math.round(normMed * 0.97)

    const asking = askingPrice ? parseInt(askingPrice, 10) : null
    const verd   = asking ? verdict(asking, normMed) : null

    const range     = max - min || 1
    const listedPct = asking ? Math.round(((asking - min) / range) * 90 + 5) : null
    const medianPct = Math.round(((med - min) / range) * 90 + 5)

    const confidence: 'high' | 'medium' | 'low' =
      matchedSet.length >= 10 ? 'high' :
      matchedSet.length >= 5  ? 'medium' : 'low'

    const normMean = normPrices.reduce((a, b) => a + b, 0) / normPrices.length
    const spread   = Math.round(Math.sqrt(
      normPrices.reduce((a, b) => a + Math.pow(b - normMean, 2), 0) / normPrices.length
    ))

    let askingPercentile: number | null = null
    if (asking) {
      const below = rawPrices.filter(p => p < asking).length
      askingPercentile = Math.round((below / rawPrices.length) * 100)
    }

    return {
      med, normMed, min, max, avgMil,
      count: forStats.length,
      filteredOut,
      asking, verd,
      listedPct, medianPct,
      suggestedLow, suggestedHigh,
      classified,
      mileageNormalized: carMil !== null,
      confidence,
      spread,
      askingPercentile,
    }
  }, [listings, askingPrice, vehicle])

  const animNormMed = useCountUp(stats?.normMed ?? null)
  const animAsking  = useCountUp(stats?.asking  ?? null)
  const animCount   = useCountUp(stats?.count   ?? null)
  const animAvgMil  = useCountUp(stats?.avgMil  ?? null)

  // ── Search flow ─────────────────────────────────────────────────────────────

  async function startSearch(override?: string) {
    const plate = (override ?? regInput).replace(/\s/g, '')
    if (plate.length < 4) return

    setAppState('loading')
    setSteps(['idle','idle','idle'])

    setSteps(['active','idle','idle'])
    let v: Vehicle | null = null
    try {
      const r = await fetch(`/api/lookup?reg=${plate}`)
      if (r.ok) { const d = await r.json(); if (d) v = d }
    } catch { /* network error */ }
    await delay(200)

    if (!v) {
      setAppState('error')
      return
    }

    setVehicle(v)
    setSteps(['done','idle','idle'])

    await delay(100)
    setSteps(['done','active','idle'])
    try {
      const model = encodeURIComponent(baseModel(v.model))
      const r = await fetch(`/api/listings?make=${encodeURIComponent(v.make)}&model=${model}&year=${v.year}`)
      if (r.ok) {
        const data: Listing[] = await r.json()
        if (data.length > 0) setListings(data)
      }
    } catch { /* keep mock listings */ }
    await delay(200)
    setSteps(['done','done','idle'])

    await delay(100)
    setSteps(['done','done','active'])
    await delay(350)
    setSteps(['done','done','done'])

    await delay(100)
    window.history.pushState({}, '', `?reg=${plate}`)
    setAppState('results')
  }

  function goHome() {
    setAppState('landing')
    setRegInput('')
    setAskingPrice('')
    setSteps(['idle', 'idle', 'idle'])
    setVehicle(MOCK_VEHICLE)
    setListings(MOCK_LISTINGS)
    window.history.pushState({}, '', '/')
  }

  function retrySearch() {
    setAppState('landing')
  }

  async function shareReport() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setShared(true)
      setTimeout(() => setShared(false), 2000)
    } catch { /* clipboard unavailable */ }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const reg = params.get('reg')
    if (reg) {
      const clean = reg.replace(/\s/g, '').toUpperCase().slice(0, 6)
      const formatted = clean.length > 3 ? clean.slice(0, 3) + ' ' + clean.slice(3) : clean
      setRegInput(formatted)
      startSearch(clean)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleRegInput(e: React.ChangeEvent<HTMLInputElement>) {
    let v = e.target.value.replace(/\s/g,'').toUpperCase().slice(0, 6)
    if (v.length > 3) v = v.slice(0,3) + ' ' + v.slice(3)
    setRegInput(v)
  }

  function handlePriceInput(e: React.ChangeEvent<HTMLInputElement>) {
    setAskingPrice(e.target.value.replace(/\D/g,''))
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      <nav className="nav">
        <button className="logo" onClick={goHome} aria-label="Bilkoll - gå till startsidan">Bil<span>koll</span></button>
        <span className="nav-hint">Baserat på Blocket.se</span>
      </nav>

      {/* ══ LANDING ══════════════════════════════════════════════════════════ */}
      {appState === 'landing' && (
        <main className="landing" role="main">
          <p className="eyebrow">Oberoende prisanalys &middot; Sverige</p>
          <h1 className="hero-title">
            Vad är <em>bilen</em><br />egentligen värd?
          </h1>
          <p className="hero-sub">
            Ange registreringsnumret — vi analyserar aktuella annonser på Blocket och ger dig priset på sekunder.
          </p>

          <div className="plate-row">
            <div className="plate-wrapper">
              <EuStrip />
              <input
                type="text"
                className="plate-input"
                placeholder="ABC 123"
                value={regInput}
                onChange={handleRegInput}
                onKeyDown={e => e.key === 'Enter' && startSearch()}
                maxLength={7}
                autoComplete="off"
                spellCheck={false}
                aria-label="Registreringsnummer"
              />
            </div>
            <button className="search-btn" onClick={() => startSearch()} aria-label="Sök pris för fordon">
              Sök pris
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
          </div>

          <div className="price-hint-row">
            <input
              type="text"
              className="price-hint-input"
              placeholder="Begärt pris (valfritt)"
              value={askingPrice ? parseInt(askingPrice).toLocaleString('sv-SE') : ''}
              onChange={handlePriceInput}
              aria-label="Begärt pris för jämförelse (valfritt)"
            />
          </div>

          <div className="trust-row">
            {['Gratis & ingen registrering','Realtidsdata från Blocket','Miletalsjusterad analys'].map(t => (
              <div key={t} className="trust-item">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {t}
              </div>
            ))}
          </div>
        </main>
      )}

      {/* ══ LOADING ══════════════════════════════════════════════════════════ */}
      {appState === 'loading' && (
        <div className="loading-view">
          <div className="loading-plate-display">
            <div className="loading-plate-eu"><EuStrip /></div>
            <div className="loading-plate-text">{regInput || 'ABC 123'}</div>
          </div>
          <p className="loading-title">Analyserar bilen&hellip;</p>
          <div className="loading-steps">
            {STEP_LABELS.map((label, i) => (
              <div key={i} className={`loading-step ${steps[i]}`}>
                <div className="step-icon">
                  {steps[i] === 'done' && (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══ ERROR ════════════════════════════════════════════════════════════ */}
      {appState === 'error' && (
        <div className="loading-view">
          <div className="loading-plate-display">
            <div className="loading-plate-eu"><EuStrip /></div>
            <div className="loading-plate-text">{regInput || 'ABC 123'}</div>
          </div>
          <p className="loading-title">Fordon hittades inte</p>
          <p style={{ color: 'var(--text-2)', fontSize: 14, marginBottom: 24, maxWidth: 340, textAlign: 'center', lineHeight: 1.6 }}>
            Registreringsnumret <strong style={{ color: 'var(--text)' }}>{regInput}</strong> kunde inte hittas i bilregistret. 
            <br />
            <span style={{ fontSize: '13px', display: 'block', marginTop: 8 }}>
              Kontrollera stavningen och försök igen. Om problemet kvarstår kan registreringsnumret vara oregistrerat.
            </span>
          </p>
          <button className="btn-primary" onClick={retrySearch}>Försök igen</button>
        </div>
      )}

      {/* ══ RESULTS ══════════════════════════════════════════════════════════ */}
      {appState === 'results' && stats && (
        <div className="results-view" role="main" aria-live="polite">
          <div className="results-wrap">

            {/* Car header */}
            <div className="car-header a1">
              <h1 className="car-name">{vehicle.make} {vehicle.model}</h1>
              <div className="chip-row">
                {[
                  String(vehicle.year),
                  vehicle.fuel,
                  vehicle.hp ? `${vehicle.hp} hk` : null,
                  vehicle.transmission,
                  vehicle.drive,
                  vehicle.color,
                  vehicle.mileage != null ? `${fmt(vehicle.mileage)} mil` : null,
                  vehicle.consumption != null ? `${vehicle.consumption} l/100km` : null,
                  vehicle.emissions != null ? `${vehicle.emissions} g/km` : null,
                  vehicle.owners != null ? `${vehicle.owners} ägare` : null,
                ].filter(Boolean).map(c => <span key={c} className="chip">{c}</span>)}
              </div>
            </div>

            {/* Negotiation card — always shown */}
            <div className={`negotiation-card a2${stats.verd ? ` ${stats.verd.cls}` : ''}`}>
              <div className="neg-left">
                <div className="neg-tag">
                  {stats.asking ? 'Bedömning' : 'Förhandlingsunderlag'}
                </div>

                {stats.asking && stats.verd ? (
                  <>
                    <div className="neg-heading">{stats.verd.label}</div>
                    <div className="neg-sub">
                      {fmt(Math.abs(stats.normMed - stats.asking))} kr{' '}
                      {stats.asking < stats.normMed ? 'under' : 'över'} rimligt bud
                    </div>
                  </>
                ) : (
                  <>
                    <div className="neg-heading">Rimligt bud</div>
                    <div className="neg-range">
                      {fmt(stats.suggestedLow)} – {fmt(stats.suggestedHigh)} kr
                    </div>
                  </>
                )}

                <div className="neg-note">
                  {stats.mileageNormalized ? 'Justerat för miltal · ' : ''}
                  {stats.count} annonser
                  {stats.filteredOut > 0 ? ` · ${stats.filteredOut} filtrerade` : ''}
                  {vehicle.owners != null ? ` · ${vehicle.owners} ägare` : ''}
                  {' · '}
                  <span className={`confidence-badge ${stats.confidence}`}>
                    {stats.confidence === 'high' ? 'Hög säkerhet' : stats.confidence === 'medium' ? 'Medel säkerhet' : 'Låg säkerhet'}
                  </span>
                </div>
                {stats.askingPercentile !== null && (
                  <div className="neg-percentile">
                    {stats.askingPercentile > 50
                      ? `Dyrare än ${stats.askingPercentile}% av liknande annonser`
                      : `Billigare än ${100 - stats.askingPercentile}% av liknande annonser`}
                  </div>
                )}
              </div>

              <div className="neg-right">
                {stats.asking ? (
                  <>
                    <div className="neg-price-label">Begärt pris</div>
                    <div className="neg-price-num">{fmt(animAsking ?? stats.asking)} kr</div>
                    <div className="neg-price-sub">
                      Rimligt bud: {fmt(stats.suggestedLow)}–{fmt(stats.suggestedHigh)}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="neg-price-label">
                      {stats.mileageNormalized ? 'Miletalsjusterat median' : 'Marknadsmedian'}
                    </div>
                    <div className="neg-price-num">{fmt(animNormMed ?? stats.normMed)} kr</div>
                  </>
                )}
              </div>
            </div>

            {/* Market range bar */}
            <div className="card a2">
              <div className="card-label">Prisintervall på marknaden</div>
              <div className="bar-wrap">
                <div className="bar-track">
                  <div className="bar-fill" />
                  {stats.listedPct !== null && (
                    <div
                      className="bar-marker m-listed"
                      style={{ left: `${stats.listedPct}%` }}
                      title={`Begärt pris: ${fmt(stats.asking!)} kr`}
                    />
                  )}
                  <div
                    className="bar-marker m-median"
                    style={{ left: `${stats.medianPct}%` }}
                    title={`Median: ${fmt(stats.med)} kr`}
                  />
                </div>
                <div className="bar-edge-labels">
                  <span>{fmt(stats.min)} kr</span>
                  <span>{fmt(stats.max)} kr</span>
                </div>
              </div>
              <div className="legend">
                {stats.listedPct !== null && (
                  <div className="legend-item">
                    <div className="legend-dot" style={{ background:'var(--accent)' }} />
                    <span>Begärt pris &mdash; {fmt(stats.asking!)} kr</span>
                  </div>
                )}
                <div className="legend-item">
                  <div className="legend-dot" style={{ background:'#333' }} />
                  <span>Median &mdash; {fmt(stats.med)} kr</span>
                </div>
              </div>

              {!stats.asking && (
                <div className="inline-price-row">
                  <span className="inline-price-label">Jämför med ett pris:</span>
                  <input
                    type="text"
                    className="inline-price-input"
                    placeholder="Ange begärt pris (kr)"
                    value={askingPrice ? parseInt(askingPrice).toLocaleString('sv-SE') : ''}
                    onChange={handlePriceInput}
                    aria-label="Begärt pris för jämförelse"
                  />
                </div>
              )}
            </div>

            {/* Stats */}
            <div className="stats-grid a3">
              <div className="stat-card">
                <div className="stat-val">{animCount ?? stats.count}</div>
                <div className="stat-lbl">Matchande annonser</div>
              </div>
              <div className="stat-card">
                <div className="stat-val">{fmt(animNormMed ?? stats.normMed)}</div>
                <div className="stat-lbl">
                  {stats.mileageNormalized ? 'Justerat median (kr)' : 'Medianpris (kr)'}
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-val">{stats.avgMil !== null ? `${fmt(animAvgMil ?? stats.avgMil)} mil` : '—'}</div>
                <div className="stat-lbl">Snittmiltal</div>
              </div>
            </div>

            {/* Listings table */}
            <div className="listings-card a4">
              <div className="listings-head">
                <span>Bil</span><span>År</span><span>Miltal</span><span>Pris</span><span />
              </div>
              {[...stats.classified]
                .filter(l => l.matched)
                .filter(l => l.price >= stats.normMed * 0.65 && l.price <= stats.normMed * 1.45)
                .sort((a, b) => Math.abs(a.normPrice - stats.normMed) - Math.abs(b.normPrice - stats.normMed))
                .slice(0, 12)
                .map((l, i) => {
                const tier = l.normPrice < stats.normMed * 0.94 ? 'low'
                           : l.normPrice > stats.normMed * 1.06 ? 'high' : ''
                return (
                  <div key={i} className="listing-row" style={{ animationDelay: `${0.22 + i * 0.015}s` }}>
                    <span className="l-name">
                      <span
                        className="match-dot ok"
                        title="Matchar specifikation"
                        role="img"
                        aria-label="Matchar specifikation"
                      />
                      {l.title}
                    </span>
                    <span className="l-mono">{l.year ?? '—'}</span>
                    <span className={`l-mono${l.milSimilar ? ' mil-match' : ''}`}>
                      {l.mileage != null ? `${fmt(l.mileage)} mil` : '—'}
                    </span>
                    <span className={`l-price${tier ? ` ${tier}` : ''}`}>{fmt(l.price)}</span>
                    <a href={l.url} target="_blank" rel="noopener noreferrer" className="l-link">
                      Blocket ↗
                    </a>
                  </div>
                )
              })}
            </div>

            <div className="action-row a4">
              <button className="btn-primary" onClick={goHome} title="Gå till startsidan för att söka en ny bil">Sök en ny bil</button>
              <button className="btn-ghost" onClick={shareReport} title="Kopiera länken till rapporten" aria-label={shared ? 'Länken är kopierad' : 'Dela rapport'}>
                {shared ? 'Kopierad ✓' : 'Dela rapport'}
              </button>
            </div>

          </div>
        </div>
      )}

      <footer className="footer">
        <span>© 2026 Bilkoll</span>
        <span>Data hämtas från Blocket.se &middot; Inte affilierat med Blocket eller Schibsted</span>
      </footer>
    </>
  )
}
