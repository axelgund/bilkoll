import { NextRequest, NextResponse } from 'next/server'
import * as cheerio from 'cheerio'

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'sv-SE,sv;q=0.9',
}

const FUEL_MAP: Record<string, string> = {
  BENSIN: 'Bensin', DIESEL: 'Diesel', EL: 'El',
  HYBRID: 'Laddhybrid', ELHYBRID: 'Laddhybrid', LADDHYBRID: 'Laddhybrid',
  GAS: 'Gas', ETANOL: 'Etanol',
}

const COLOR_MAP: Record<string, string> = {
  'BLÅ': 'Blå', BLA: 'Blå', BLUE: 'Blå',
  'RÖD': 'Röd', ROD: 'Röd', RED: 'Röd',
  SVART: 'Svart', BLACK: 'Svart',
  VIT: 'Vit', WHITE: 'Vit',
  'GRÅ': 'Grå', GRA: 'Grå', GRAY: 'Grå', GREY: 'Grå',
  SILVER: 'Silver',
  'GRÖN': 'Grön', GRON: 'Grön', GREEN: 'Grön',
  GUL: 'Gul', YELLOW: 'Gul',
  BRUN: 'Brun', BROWN: 'Brun',
  BEIGE: 'Beige', ORANGE: 'Orange',
}

const COLOR_WORDS = new Set(['vit','svart','grå','blå','röd','silver','grön','brun','beige','gul','orange','white','black'])

function tc(s: string | null | undefined): string {
  if (!s) return ''
  const t = s.trim().toLowerCase()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

function parseYear(val: string | null | undefined): number | null {
  if (!val) return null
  const m = String(val).match(/(20\d{2}|19\d{2})/)
  return m ? parseInt(m[0]) : null
}

function gearbox(raw: string | null | undefined): string | null {
  if (!raw) return null
  const v = raw.toUpperCase()
  if (v.includes('AUTO') || v.trim() === 'A') return 'Automat'
  if (v.includes('MAN') || v.trim() === 'M') return 'Manuell'
  return tc(raw)
}

function mapColor(raw: string): string {
  const key = raw.replace(/\s.*/, '').toUpperCase()
  return COLOR_MAP[key] ?? tc(raw) ?? 'Okänd'
}

function makeGetter(kv: Record<string, string>) {
  return (...keys: string[]): string | null => {
    for (const k of keys) {
      for (const [label, val] of Object.entries(kv)) {
        if (label.includes(k.toLowerCase())) return val
      }
    }
    return null
  }
}

async function biluppgifter(reg: string) {
  const res = await fetch(`https://biluppgifter.se/fordon/${reg}/`, { headers: HEADERS })
  if (!res.ok) return null

  const $ = cheerio.load(await res.text())
  const kv: Record<string, string> = {}
  $('div.info').each((_, el) => {
    const em = $(el).find('em').text().trim()
    const span = $(el).find('span').text().trim()
    if (em && span) kv[span.toLowerCase()] = em
  })
  if (Object.keys(kv).length === 0) return null

  const get = makeGetter(kv)

  let title = $('title').text().trim()
  title = title.replace(/\s*-\s*Biluppgifter\.se.*$/i, '').trim()
  title = title.replace(/^[A-ZÅÄÖ]{2,3}\d{2,3}\s+/, '').trim()
  title = title.replace(/,\s*\d+hk.*$/i, '').trim()
  title = title.replace(/,\s*(19|20)\d{2}.*$/, '').trim()
  title = title.replace(/\s+(19|20)\d{2}$/, '').trim()
  const words = title.split(/\s+/)
  while (words.length && COLOR_WORDS.has(words[words.length - 1].toLowerCase())) words.pop()
  const parts = words.join(' ').split(/\s+/)
  const make = parts[0] ?? ''
  const model = parts.slice(1).join(' ')
  if (!make) return null

  const fuelRaw = (get('bränsle', 'drivmedel') ?? '').toUpperCase()
  const colorRaw = (get('färg', 'color') ?? '').toUpperCase()

  let hp: number | null = null
  const hpRaw = get('hästkrafter', 'effekt')
  if (hpRaw) { const m = hpRaw.match(/(\d+)/); if (m) hp = parseInt(m[1]) }

  let mileage: number | null = null
  const milRaw = get('miltal', 'mätarställning', 'körsträcka')
  if (milRaw) { const d = milRaw.replace(/\D/g, ''); if (d) mileage = parseInt(d) }

  let owners: number | null = null
  const ownRaw = get('brukare', 'ägare')
  if (ownRaw) { const m = ownRaw.match(/(\d+)/); if (m) owners = parseInt(m[1]) }

  let consumption: number | null = null
  const consRaw = get('förbrukning', 'bränsleförbrukning')
  if (consRaw) { const m = consRaw.match(/([\d,.]+)/); if (m) { try { consumption = parseFloat(m[1].replace(',', '.')) } catch {} } }

  let emissions: number | null = null
  const emisRaw = get('utsläpp', 'co2')
  if (emisRaw) { const m = emisRaw.match(/(\d+)/); if (m) emissions = parseInt(m[1]) }

  let drive: string | null = null
  const driveRaw = get('drivhjul', 'drift')
  if (driveRaw) {
    const d = driveRaw.toUpperCase()
    drive = (d.includes('4WD') || d.includes('AWD') || d.includes('4X4')) ? 'AWD'
           : (d.includes('2WD') || d.includes('FWD') || d.includes('RWD')) ? '2WD'
           : tc(driveRaw)
  }

  return {
    make: tc(make), model: tc(model),
    year: parseYear(get('modellår', 'årsmodell', 'year')),
    fuel: FUEL_MAP[fuelRaw] ?? tc(fuelRaw) ?? 'Okänt',
    color: mapColor(colorRaw),
    hp, transmission: gearbox(get('växellåda', 'transmission')),
    mileage, owners, consumption, emissions, drive,
  }
}

async function carinfo(reg: string) {
  const res = await fetch(`https://www.car.info/sv-se/license-plate/SE/${reg}`, { headers: HEADERS })
  if (res.status === 429 || !res.ok) return null

  const $ = cheerio.load(await res.text())
  const pageText = $('body').text().toLowerCase()
  if (pageText.includes('kaffepaus') || pageText.includes('exceeded your quota')) return null

  const kv: Record<string, string> = {}
  $('dl').each((_, dl) => {
    const dts = $(dl).find('dt')
    const dds = $(dl).find('dd')
    dts.each((i, dt) => {
      const dd = dds.eq(i)
      if (dd.length) kv[$(dt).text().trim().toLowerCase()] = dd.text().trim()
    })
  })
  $('table tr').each((_, row) => {
    const cells = $(row).find('th, td').map((_, c) => $(c).text().trim()).get()
    if (cells.length >= 2) kv[cells[0].toLowerCase()] = cells[1]
  })

  const get = makeGetter(kv)
  const titleText = $('title').text().trim()
  const make = get('make', 'brand', 'märke') ?? (titleText.split(' ')[0] || null)
  const model = get('model', 'modell')
  if (!make) return null

  const fuelRaw = (get('fuel', 'drivmedel', 'bränsle') ?? '').toUpperCase()
  const colorRaw = (get('color', 'colour', 'färg') ?? '').toUpperCase()

  let hp: number | null = null
  const hpRaw = get('effect', 'power', 'hästkrafter', 'effekt')
  if (hpRaw) { const m = hpRaw.match(/(\d+)/); if (m) hp = parseInt(m[1]) }

  let mileage: number | null = null
  const milRaw = get('miltal', 'mätarställning', 'mileage', 'körsträcka')
  if (milRaw) { const d = milRaw.replace(/\D/g, ''); if (d) mileage = parseInt(d) }

  let owners: number | null = null
  const ownRaw = get('ägare', 'brukare', 'owners')
  if (ownRaw) { const m = ownRaw.match(/(\d+)/); if (m) owners = parseInt(m[1]) }

  let emissions: number | null = null
  const emisRaw = get('utsläpp', 'co2', 'emission')
  if (emisRaw) { const m = emisRaw.match(/(\d+)/); if (m) emissions = parseInt(m[1]) }

  let consumption: number | null = null
  const consRaw = get('förbrukning', 'bränsleförbrukning', 'consumption')
  if (consRaw) { const m = consRaw.match(/([\d,.]+)/); if (m) { try { consumption = parseFloat(m[1].replace(',', '.')) } catch {} } }

  let drive: string | null = null
  const driveRaw = get('drivhjul', 'drive', 'drift')
  if (driveRaw) {
    const d = driveRaw.toUpperCase()
    drive = (d.includes('4WD') || d.includes('AWD') || d.includes('4X4') || d.includes('QUATTRO')) ? 'AWD'
           : (d.includes('2WD') || d.includes('FWD') || d.includes('RWD')) ? '2WD'
           : tc(driveRaw)
  }

  return {
    make: tc(make), model: tc(model ?? ''),
    year: parseYear(get('year', 'model year', 'årsmodell', 'år')),
    fuel: FUEL_MAP[fuelRaw] ?? tc(fuelRaw) ?? 'Okänt',
    color: mapColor(colorRaw),
    hp, transmission: gearbox(get('transmission', 'gearbox', 'växellåda')),
    mileage, owners, consumption, emissions, drive,
  }
}

export async function GET(request: NextRequest) {
  const reg = request.nextUrl.searchParams.get('reg')
  if (!reg) return NextResponse.json(null, { status: 400 })

  const clean = reg.replace(/[\s-]/g, '').toUpperCase()

  try {
    const data = await biluppgifter(clean) ?? await carinfo(clean)
    return NextResponse.json(data, { status: data ? 200 : 404 })
  } catch (err) {
    console.error('[/api/lookup]', err)
    return NextResponse.json(null, { status: 502 })
  }
}
