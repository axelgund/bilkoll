import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import { runPython } from '../_python'

const SCRIPT = path.join(process.cwd(), '..', 'tools', 'lookup_vehicle.py')

export async function GET(request: NextRequest) {
  const reg = request.nextUrl.searchParams.get('reg')
  if (!reg) return NextResponse.json(null, { status: 400 })

  const clean = reg.replace(/[\s-]/g, '').toUpperCase()

  try {
    const stdout = await runPython([SCRIPT, '--reg', clean], 15_000)
    const data   = JSON.parse(stdout.trim() || 'null')
    return NextResponse.json(data, { status: data ? 200 : 404 })
  } catch (err) {
    console.error('[/api/lookup]', err)
    return NextResponse.json(null, { status: 502 })
  }
}
