import { desc, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { xsmbAiReports, xsmbDraws, xsmbPredictions } from '@/lib/db/schema'
import { syncRecentDraws, XSMB_USER_SCOPE } from '@/lib/xsmb-source'
import type { PredictionMeta, XsmbAiCommentary, XsmbAiReport, XsmbDraw } from '@/lib/xsmb-types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 45

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
  let syncError: string | null = null
  let refreshedAt: string | null = null
  const targetDate = getVietnamDate()

  try {
    try {
      const sync = await syncRecentDraws()
      syncError = sync.syncError
      refreshedAt = sync.syncedAt
    } catch (error) {
      syncError = error instanceof Error ? error.message : 'Không thể đồng bộ dữ liệu Minh Ngọc'
    }

    const [storedDraws, storedPredictions, storedReports] = await Promise.all([
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
      db
        .select()
        .from(xsmbAiReports)
        .where(eq(xsmbAiReports.userId, XSMB_USER_SCOPE))
        .orderBy(desc(xsmbAiReports.targetDate), desc(xsmbAiReports.createdAt))
        .limit(3000),
    ])

    const targetPredictionCount = storedPredictions.filter((prediction) => prediction.targetDate === targetDate).length
    console.log('[xsmb] saved predictions for target date', { targetDate, count: targetPredictionCount })

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
        reports: {},
      })
    }

    function getOrCreateDraw(date: string) {
      const current = byDate.get(date)
      if (current) return current
      const created: XsmbDraw = {
        date,
        day: '',
        special: '',
        tail: '',
        prizes: [],
        predictions: {},
        predictionMeta: {},
        reports: {},
      }
      byDate.set(date, created)
      return created
    }

    for (const prediction of storedPredictions) {
      const draw = getOrCreateDraw(prediction.targetDate)
      draw.predictions[prediction.scenarioId] = prediction.prediction
      draw.predictionMeta[prediction.scenarioId] = {
        name: prediction.scenarioName,
        provider: prediction.provider,
      }
    }

    let aiCommentary: XsmbAiCommentary | null = null
    for (const report of storedReports) {
      if (report.scenarioId === 'AI_COMMENTARY' && report.targetDate === targetDate) {
        aiCommentary = {
          targetDate: report.targetDate,
          analysis: report.analysis,
          provider: report.provider,
          modelId: report.modelId,
        }
        continue
      }
      if (report.provider === 'formula') continue
      const draw = getOrCreateDraw(report.targetDate)
      const reportData: XsmbAiReport = {
        name: report.scenarioName,
        provider: report.provider,
        modelId: report.modelId,
        prediction: report.prediction,
        analysis: report.analysis,
      }
      draw.predictions[report.scenarioId] = report.prediction
      draw.predictionMeta[report.scenarioId] = {
        name: report.scenarioName,
        provider: report.provider,
      }
      draw.reports[report.scenarioId] = reportData
    }

    const draws = [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 180)
    const syncedAt = refreshedAt ?? storedDraws[0]?.syncedAt?.toISOString() ?? null

    return NextResponse.json({ draws, count: draws.length, syncedAt, syncError, aiCommentary }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'Không thể tải dữ liệu lịch sử từ cơ sở dữ liệu.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
