import { desc, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { xsmbDraws } from '@/lib/db/schema'
import type { XsmbDraw } from '@/lib/xsmb-types'

const SOURCE_URL = 'https://www.minhngoc.net.vn/ket-qua-xo-so/mien-bac.html'
export const XSMB_USER_SCOPE = 'shared'

const DAYS: Record<string, string> = {
  'chủ nhật': 'CN',
  'thứ hai': 'T2',
  'thứ ba': 'T3',
  'thứ tư': 'T4',
  'thứ năm': 'T5',
  'thứ sáu': 'T6',
  'thứ bảy': 'T7',
}

type ParsedDraw = Omit<XsmbDraw, 'predictions' | 'predictionMeta' | 'reports'>

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

function subtractDays(dateKey: string, offset: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() - offset)
  return date.toISOString().slice(0, 10)
}

export function archiveUrl(dateKey: string) {
  const [year, month, day] = dateKey.split('-')
  return `https://www.minhngoc.net.vn/ket-qua-xo-so/mien-bac/${day}-${month}-${year}.html`
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

export async function fetchDrawPage(url: string) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; XSMB research sync)' },
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error(`Nguồn kết quả trả về ${response.status}`)
  return parseSource(await response.text())
}

export async function syncRecentDraws() {
  let syncError: string | null = null
  let sourceSucceeded = false
  const changedDraws = new Map<string, ParsedDraw>()
  const storedDraws = await db
    .select()
    .from(xsmbDraws)
    .where(eq(xsmbDraws.userId, XSMB_USER_SCOPE))
    .orderBy(desc(xsmbDraws.drawDate))
    .limit(180)
  const byDate = new Map<string, ParsedDraw>(
    storedDraws.map((draw) => [draw.drawDate, {
      date: draw.drawDate,
      day: draw.day,
      special: draw.special,
      tail: draw.tail,
      prizes: draw.prizes,
    }]),
  )

  try {
    const responseDraws = await fetchDrawPage(`${SOURCE_URL}?sync=${Date.now()}`)
    if (!responseDraws.length) throw new Error('Không đọc được kết quả mới từ nguồn dữ liệu')
    sourceSucceeded = true
    responseDraws.forEach((draw) => {
      byDate.set(draw.date, draw)
      changedDraws.set(draw.date, draw)
    })
  } catch (error) {
    syncError = error instanceof Error ? error.message : 'Không thể đồng bộ dữ liệu Minh Ngọc'
  }

  const latestDate = [...byDate.keys()].sort((a, b) => b.localeCompare(a))[0]
  if (!latestDate) throw new Error(syncError ?? 'Chưa có kết quả xổ số được lưu')

  const candidateDates = Array.from({ length: 15 }, (_, index) => subtractDays(latestDate, index))
  const oldestDate = candidateDates[candidateDates.length - 1]

  for (let cursor = 0; byDate.size < 10 && cursor < candidateDates.length; cursor += 4) {
    const batch = candidateDates.slice(cursor, cursor + 4).filter((date) => !byDate.has(date))
    if (!batch.length) continue

    const pages = await Promise.allSettled(batch.map((date) => fetchDrawPage(archiveUrl(date))))
    pages.forEach((page) => {
      if (page.status === 'rejected') {
        syncError ??= 'Không tải được đầy đủ các kỳ lưu trữ'
        return
      }
      page.value.forEach((draw) => {
        if (draw.date >= oldestDate && draw.date <= latestDate) {
          byDate.set(draw.date, draw)
          changedDraws.set(draw.date, draw)
        }
      })
    })
  }

  const recentDraws = [...byDate.values()]
    .filter((draw) => /^\d{4}$/.test(draw.tail))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10)

  const rowsToSave = [...changedDraws.values()].filter((draw) => draw.date >= oldestDate && draw.date <= latestDate)
  if (rowsToSave.length) {
    await db
      .insert(xsmbDraws)
      .values(rowsToSave.map((draw) => ({
        drawDate: draw.date,
        day: draw.day,
        special: draw.special,
        tail: draw.tail,
        prizes: draw.prizes,
        userId: XSMB_USER_SCOPE,
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
  }

  if (recentDraws.length < 10 && syncError === null && !sourceSucceeded) {
    syncError = `Chỉ có ${recentDraws.length} kỳ kết quả để phân tích.`
  }

  return {
    draws: recentDraws,
    count: recentDraws.length,
    syncedAt: sourceSucceeded || rowsToSave.length ? new Date().toISOString() : storedDraws[0]?.syncedAt?.toISOString() ?? null,
    syncError: recentDraws.length >= 10 ? null : syncError ?? `Chỉ có ${recentDraws.length} kỳ kết quả để phân tích.`,
  }
}
