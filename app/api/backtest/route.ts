import { asc, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { calculateBacktest } from '@/lib/xsmb-backtest'
import { db } from '@/lib/db'
import { xsmbDraws } from '@/lib/db/schema'
import { XSMB_USER_SCOPE } from '@/lib/xsmb-source'

export const FREEZE_DATE = '2026-11-27'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

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

export async function GET() {
  try {
    const draws = await db
      .select({ date: xsmbDraws.drawDate, tail: xsmbDraws.tail, prizes: xsmbDraws.prizes })
      .from(xsmbDraws)
      .where(eq(xsmbDraws.userId, XSMB_USER_SCOPE))
      .orderBy(asc(xsmbDraws.drawDate))

    return NextResponse.json(calculateBacktest(draws, getVietnamDate(), FREEZE_DATE))
  } catch {
    return NextResponse.json({ error: 'Không thể tính backtest từ lịch sử kết quả hiện có.' }, { status: 503 })
  }
}
