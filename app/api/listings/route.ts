import { NextRequest, NextResponse } from 'next/server'
import * as cheerio from 'cheerio'

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'sv-SE,sv;q=0.9,en-US;q=0.8',
  'Referer': 'https://www.blocket.se/',
}

const SEARCH_URL = 'https://www.blocket.se/annonser/hela_sverige/fordon/bilar'

function toInt(val: string | null | undefined): number | null {
  if (!val) return null
  const d = val.replace(/\D/g, '')
  return d ? parseInt(d) : null
}

function parseDetails(text: string) {
  let year: number | null = null
  let mileage: number | null = null
  let fuel: string | null = null
  let transmission: string | null = null

  const parts = text.split(/[∙•·]/).map(p => p.trim()).filter(Boolean)
  for (const part of parts) {
    const pl = part.toLowerCase()
    if (/^(19|20)\d{2}$/.test(part)) {
      year = parseInt(part)
    } else if (/\d/.test(part) && pl.includes('mil')) {
      const d = part.replace(/\D/g, '')
      if (d) mileage = parseInt(d)
    } else if (['automat', 'manuell', 'automatisk'].some(t => pl.includes(t))) {
      transmission = part
    } else if (pl === 'el' || ['bensin', 'diesel', 'hybrid', 'gas', 'etanol'].some(f => pl.includes(f))) {
      fuel = part
    }
  }

  return { year, mileage, fuel, transmission }
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const make  = searchParams.get('make')?.trim().toLowerCase()
  const model = searchParams.get('model')?.trim().toLowerCase()
  const year  = searchParams.get('year')?.trim()

  if (!make || !model || !year || isNaN(Number(year))) {
    return NextResponse.json({ error: 'make, model, year required' }, { status: 400 })
  }

  try {
    const url = new URL(SEARCH_URL)
    url.searchParams.set('q', `${make} ${model}`)
    url.searchParams.set('cg', '1020')

    const res = await fetch(`https://api.scraperapi.com/?api_key=${process.env.SCRAPER_API_KEY}&url=${encodeURIComponent(url.toString())}`)
    if (!res.ok) return NextResponse.json([])

    const $ = cheerio.load(await res.text())
    const listings: object[] = []

    $('article').each((_, article) => {
      if (listings.length >= 30) return false as unknown as void

      const el = $(article)

      const link = el.find('a[href*="/mobility/item/"]').first()
      if (!link.length) return

      const href = link.attr('href') ?? ''
      const listingUrl = href.startsWith('http') ? href : `https://www.blocket.se${href}`

      const makeModel = el.find('h2').first().text().trim()
      const subtitle  = el.find('[class*="text-caption"][class*="mb-4"]').first().text().trim()
      const title     = subtitle ? `${makeModel} ${subtitle}`.trim() : makeModel

      const detailsText = el.find('span[class*="text-caption"][class*="font-bold"]').first().text().trim()
      const { year: yr, mileage, fuel, transmission } = parseDetails(detailsText)

      const price = toInt(el.find('span[class*="t3"]').first().text().trim())
      if (!price) return

      const location = el.find('span[class*="truncate"]').first().text().trim().split('∙')[0].trim()

      listings.push({ title, price, year: yr, mileage, fuel, transmission, url: listingUrl, location })
    })

    return NextResponse.json(listings)
  } catch (err) {
    console.error('[/api/listings]', err)
    return NextResponse.json([])
  }
}

