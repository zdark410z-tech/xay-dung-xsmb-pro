import { desc, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { xsmbDraws, xsmbPredictions } from '@/lib/db/schema'
import { syncRecentDraws, XSMB_USER_SCOPE } from '@/lib/xsmb-source'
import type { PredictionMeta, XsmbDraw } from '@/lib/xsmb-types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 45

export async function GET() {
  let syncError: string | null = null
  let refreshedAt: string | null = null

  try {
    try {
      const sync = await syncRecentDraws()
      syncError = sync.syncError
      refreshedAt = sync.syncedAt
    } catch (error) {
      syncError = error instanceof Error ? error.message : 'Không thể đồng bộ dữ liệu Minh Ngọc'
    }

    const [storedDraws, storedPredictions] = await Promise.all([
      db
        .select()
        .from(xsmbDraws)
        .where(eq(xsmbDraws.userId, XSMB_USER_SCOPE))
        .orderBy(desc(xsmbDraws.drawDate))
        .limit(180),
      db
        .select()
        .from(xsmbPredictions)
        .where(eq(xsmbPredictions.userId, XSMB_USER_SCOPE))
        .orderBy(desc(xsmbPredictions.targetDate), desc(xsmbPredictions.createdAt))
        .limit(3000),
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

    return NextResponse.json({ draws, count: draws.length, syncedAt, syncError })
  } catch {
    return NextResponse.json({ error: 'Không thể tải dữ liệu lịch sử từ cơ sở dữ liệu.' }, { status: 503 })
  }
}
