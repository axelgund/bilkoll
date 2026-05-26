import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import { runPython } from '../_python'

const SCRIPT = path.join(process.cwd(), '..', 'tools', 'scrape_blocket.py')

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const make  = searchParams.get('make')?.trim().toLowerCase()
  const model = searchParams.get('model')?.trim().toLowerCase()
  const year  = searchParams.get('year')?.trim()

  if (!make || !model || !year || isNaN(Number(year))) {
    return NextResponse.json({ error: 'make, model, year required' }, { status: 400 })
  }

  try {
    const stdout = await runPython(
      [SCRIPT, '--make', make, '--model', model, '--year', year, '--count', '20'],
      30_000,
    )
    const data = JSON.parse(stdout.trim() || '[]')
    return NextResponse.json(Array.isArray(data) ? data : [])
  } catch (err) {
    console.error('[/api/listings]', err)
    return NextResponse.json([])
  }
}
