import { desc, eq, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { xsmbDraws, xsmbPredictions } from '@/lib/db/schema'
import type { PredictionMeta, XsmbDraw } from '@/lib/xsmb-types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SOURCE_URL = 'https://www.minhngoc.net.vn/ket-qua-xo-so/mien-bac.html'
const USER_SCOPE = 'shared'
const DAYS: Record<string, string> = {
  'chủ nhật': 'CN',
  'thứ hai': 'T2',
  'thứ ba': 'T3',
  'thứ tư': 'T4',
  'thứ năm': 'T5',
  'thứ sáu': 'T6',
  'thứ bảy': 'T7',
}

type ParsedDraw = Omit<XsmbDraw, 'predictions' | 'predictionMeta'>

function clean(value: string) {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function toDateKey(value: string) {
  const [day, month, year] = value.split('/')
  return `${year}-${month}-${day}`
}

function parseSource(html: string): ParsedDraw[] {
  const draws: ParsedDraw[] = []
  const headings = [...html.matchAll(/class=["']title["'][^>]*>[\s\S]{0,180}?KẾT QUẢ XỔ SỐ[\s\S]{0,180}?(\d{2}\/\d{2}\/\d{4})/gi)]

  headings.forEach((heading, index) => {
    const date = toDateKey(heading[1])
    const section = html.slice(heading.index ?? 0, headings[index + 1]?.index ?? html.length)
    const header = clean(section.slice(0, 500)).toLocaleLowerCase('vi-VN')
    const day = Object.entries(DAYS).find(([name]) => header.includes(name))?.[1] ?? ''
    const table = section.match(/<table[\s\S]*?<\/table>/i)?.[0] ?? ''
    const prizes: string[][] = []

    for (const row of table.matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
      const rowText = clean(row[0])
      if (!/Giải/i.test(rowText)) continue
      const cells = [...row[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => clean(cell[1]))
      if (cells.length < 2) continue
      const numbers = cells.slice(1).join(' ').match(/\b\d{2,5}\b/g) ?? []
      if (numbers.length) prizes.push(numbers)
    }

    if (prizes.length < 8) return
    const special = prizes[0][0]
    draws.push({ date, day, special, tail: special.slice(-4), prizes: prizes.slice(0, 8) })
  })

  return draws.filter((draw, index, list) => list.findIndex((item) => item.date === draw.date) === index)
}

export async function GET() {
  let syncError: string | null = null
  let refreshedAt: string | null = null

  try {
    try {
      const response = await fetch(`${SOURCE_URL}?sync=${Date.now()}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; XSMB research sync)' },
        cache: 'no-store',
      })
      if (!response.ok) throw new Error(`Nguồn kết quả trả về ${response.status}`)

      const freshDraws = parseSource(await response.text())
      if (!freshDraws.length) throw new Error('Không đọc được kết quả mới từ nguồn dữ liệu')

      await db
        .insert(xsmbDraws)
        .values(freshDraws.map((draw) => ({
          drawDate: draw.date,
          day: draw.day,
          special: draw.special,
          tail: draw.tail,
          prizes: draw.prizes,
          userId: USER_SCOPE,
        })))
        .onConflictDoUpdate({
          target: xsmbDraws.drawDate,
          set: {
            day: sql`excluded.day`,
            special: sql`excluded.special`,
            tail: sql`excluded.tail`,
            prizes: sql`excluded.prizes`,
            syncedAt: sql`now()`,
          },
        })
      refreshedAt = new Date().toISOString()
    } catch (error) {
      syncError = error instanceof Error ? error.message : 'Không thể đồng bộ dữ liệu Minh Ngọc'
    }

    const [storedDraws, storedPredictions] = await Promise.all([
      db
        .select()
        .from(xsmbDraws)
        .where(eq(xsmbDraws.userId, USER_SCOPE))
        .orderBy(desc(xsmbDraws.drawDate))
        .limit(180),
      db
        .select()
        .from(xsmbPredictions)
        .where(eq(xsmbPredictions.userId, USER_SCOPE))
        .orderBy(desc(xsmbPredictions.targetDate), desc(xsmbPredictions.createdAt))
        .limit(1200),
    ])

    const byDate = new Map<string, XsmbDraw>()
    for (const draw of storedDraws) {
      byDate.set(draw.drawDate, {
        date: draw.drawDate,
        day: draw.day,
        special: draw.special,
        tail: draw.tail,
        prizes: draw.prizes,
        predictions: {},
        predictionMeta: {},
      })
    }

    for (const prediction of storedPredictions) {
      const draw = byDate.get(prediction.targetDate) ?? {
        date: prediction.targetDate,
        day: '',
        special: '',
        tail: '',
        prizes: [],
        predictions: {},
        predictionMeta: {} as Record<string, PredictionMeta>,
      }
      draw.predictions[prediction.scenarioId] = prediction.prediction
      draw.predictionMeta[prediction.scenarioId] = {
        name: prediction.scenarioName,
        provider: prediction.provider,
      }
      byDate.set(prediction.targetDate, draw)
    }

    const draws = [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 180)
    const syncedAt = refreshedAt ?? storedDraws[0]?.syncedAt?.toISOString() ?? null

    return NextResponse.json({
      draws,
      count: draws.length,
      syncedAt,
      syncError,
    })
  } catch {
    return NextResponse.json({ error: 'Không thể tải dữ liệu lịch sử từ cơ sở dữ liệu.' }, { status: 503 })
  }
}
