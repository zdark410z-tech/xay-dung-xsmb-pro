import { count, desc } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { xsmbDraws, xsmbPredictions, xsmbScenarios } from '@/lib/db/schema'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function getDatabaseHost() {
  const value = process.env.DATABASE_URL
  if (!value) return null

  try {
    const url = new URL(value)
    return url.port ? `${url.hostname}:${url.port}` : url.hostname
  } catch {
    return null
  }
}

export async function GET() {
  const databaseHost = getDatabaseHost()
  try {
    const [drawCount, predictionCount, scenarioCount, latestPrediction] = await Promise.all([
      db.select({ value: count() }).from(xsmbDraws),
      db.select({ value: count() }).from(xsmbPredictions),
      db.select({ value: count() }).from(xsmbScenarios),
      db.select({ createdAt: xsmbPredictions.createdAt })
        .from(xsmbPredictions)
        .orderBy(desc(xsmbPredictions.createdAt))
        .limit(1),
    ])

    return NextResponse.json({
      ok: true,
      xsmb_draws: drawCount[0]?.value ?? 0,
      xsmb_predictions: predictionCount[0]?.value ?? 0,
      xsmb_scenarios: scenarioCount[0]?.value ?? 0,
      latest_prediction_created_at: latestPrediction[0]?.createdAt?.toISOString() ?? null,
      database_host: databaseHost,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({
      ok: false,
      xsmb_draws: null,
      xsmb_predictions: null,
      xsmb_scenarios: null,
      latest_prediction_created_at: null,
      database_host: databaseHost,
    }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
