import { timingSafeEqual } from 'node:crypto'
import { count, eq, sql } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { xsmbDraws } from '@/lib/db/schema'
import { archiveUrl, fetchDrawPage, XSMB_USER_SCOPE } from '@/lib/xsmb-source'

export const maxDuration = 60
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_RUN_MS = 45_000
const REQUEST_DELAY_MS = 1_200
const REQUIRED_PRIZES = 8

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const authorization = request.headers.get('authorization')
  if (!secret || !authorization?.startsWith('Bearer ')) return false

  const actual = Buffer.from(authorization.slice('Bearer '.length))
  const expected = Buffer.from(secret)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function getVietnamDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function subtractDays(dateKey: string, offset: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() - offset)
  return date.toISOString().slice(0, 10)
}

function isValidDraw(draw: { prizes: string[][]; tail: string }) {
  return draw.prizes.length >= REQUIRED_PRIZES && /^\d{4}$/.test(draw.tail)
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function getSummary() {
  const [bounds] = await db
    .select({
      oldestDate: sql<string | null>`min(${xsmbDraws.drawDate})`,
      newestDate: sql<string | null>`max(${xsmbDraws.drawDate})`,
      totalDraws: count(),
    })
    .from(xsmbDraws)
    .where(eq(xsmbDraws.userId, XSMB_USER_SCOPE))

  return {
    oldestDate: bounds?.oldestDate ?? null,
    newestDate: bounds?.newestDate ?? null,
    totalDraws: Number(bounds?.totalDraws ?? 0),
  }
}

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Cron secret is not configured.' }, { status: 503 })
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  const targetDate = subtractDays(getVietnamDate(), 730)
  const initial = await getSummary()
  const result = {
    inserted: 0,
    requests: 0,
    ...initial,
    done: Boolean(initial.oldestDate && initial.oldestDate <= targetDate),
    stopReason: 'target_reached',
  }

  if (result.done) return NextResponse.json(result)

  const startedAt = Date.now()
  let cursor = initial.oldestDate ? subtractDays(initial.oldestDate, 1) : getVietnamDate()
  let consecutiveEmptyPages = 0
  let lastRequestAt = 0

  while (true) {
    if (Date.now() - startedAt >= MAX_RUN_MS) {
      result.stopReason = 'time_limit'
      break
    }
    if (cursor < targetDate) {
      result.done = true
      result.stopReason = 'target_reached'
      break
    }

    if (lastRequestAt) {
      const remainingDelay = REQUEST_DELAY_MS - (Date.now() - lastRequestAt)
      if (remainingDelay > 0) await wait(remainingDelay)
      if (Date.now() - startedAt >= MAX_RUN_MS) {
        result.stopReason = 'time_limit'
        break
      }
    }

    let draws
    result.requests += 1
    lastRequestAt = Date.now()
    try {
      draws = await fetchDrawPage(archiveUrl(cursor))
    } catch {
      result.stopReason = 'network_error'
      break
    }

    const validDraws = draws.filter(isValidDraw)
    if (!validDraws.length) {
      consecutiveEmptyPages += 1
      if (consecutiveEmptyPages >= 2) {
        result.stopReason = 'consecutive_empty_pages'
        break
      }
      cursor = subtractDays(cursor, 1)
      continue
    }

    consecutiveEmptyPages = 0
    const pageOldestDate = validDraws.reduce((oldest, draw) => draw.date < oldest ? draw.date : oldest, validDraws[0].date)
    const rowsToUpsert = validDraws
      .filter((draw) => draw.date >= targetDate)
      .map((draw) => ({
        drawDate: draw.date,
        day: draw.day,
        special: draw.special,
        tail: draw.tail,
        prizes: draw.prizes.slice(0, REQUIRED_PRIZES),
        userId: XSMB_USER_SCOPE,
      }))

    if (rowsToUpsert.length) {
      const saved = await db
        .insert(xsmbDraws)
        .values(rowsToUpsert)
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
        .returning({ drawDate: xsmbDraws.drawDate })
      result.inserted += saved.length
    }

    cursor = subtractDays(pageOldestDate, 1)
    if (pageOldestDate <= targetDate) {
      result.done = true
      result.stopReason = 'target_reached'
      break
    }
  }

  const finalSummary = await getSummary()
  result.oldestDate = finalSummary.oldestDate
  result.newestDate = finalSummary.newestDate
  result.totalDraws = finalSummary.totalDraws

  return NextResponse.json(result)
}
