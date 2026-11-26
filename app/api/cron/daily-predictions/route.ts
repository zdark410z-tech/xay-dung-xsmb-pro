import { timingSafeEqual } from 'node:crypto'
import { and, desc, eq, inArray, lt } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ensureDefaultAnalysisScenarios } from '@/lib/db/seed'
import { xsmbDraws, xsmbPredictions, xsmbScenarios } from '@/lib/db/schema'
import { generateSinglePrediction, getAiFailureMessage, type AiProvider } from '@/lib/ai-prediction'
import { syncRecentDraws, XSMB_USER_SCOPE } from '@/lib/xsmb-source'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const REQUIRED_SCENARIOS = 6

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

type CronResult = {
  saved: Array<{ scenarioId: string; provider: AiProvider; prediction: string }>
  skipped: Array<{ scenarioId: string; reason: 'already_exists' }>
  failures: Array<{ scenarioId: string; provider: AiProvider | 'system'; message: string }>
}

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Cron secret is not configured.', saved: [], skipped: [], failures: [] }, { status: 503 })
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized.', saved: [], skipped: [], failures: [] }, { status: 401 })
  }

  const result: CronResult = { saved: [], skipped: [], failures: [] }
  const targetDate = getVietnamDate()
  const unavailableProviders = new Set<AiProvider>()

  try {
    await ensureDefaultAnalysisScenarios()
    const scenarios = await db
      .select()
      .from(xsmbScenarios)
      .where(
        and(
          eq(xsmbScenarios.userId, XSMB_USER_SCOPE),
          eq(xsmbScenarios.isActive, true),
          eq(xsmbScenarios.isBuiltin, false),
          inArray(xsmbScenarios.provider, ['gemini', 'deepseek', 'groq']),
        ),
      )
      .orderBy(xsmbScenarios.sortOrder)
      .limit(REQUIRED_SCENARIOS + 1)

    if (scenarios.length !== REQUIRED_SCENARIOS) {
      return NextResponse.json({
        status: 'waiting_for_six_scenarios',
        targetDate,
        configured: scenarios.length,
        required: REQUIRED_SCENARIOS,
        ...result,
      })
    }

    const sync = await syncRecentDraws()
    if (sync.count < 10) {
      return NextResponse.json({
        status: 'waiting_for_ten_draws',
        targetDate,
        availableDraws: sync.count,
        message: sync.syncError ? 'Không thể đồng bộ dữ liệu kỳ quay mới.' : null,
        ...result,
      })
    }

    const recentDraws = await db
      .select({ tail: xsmbDraws.tail })
      .from(xsmbDraws)
      .where(and(eq(xsmbDraws.userId, XSMB_USER_SCOPE), lt(xsmbDraws.drawDate, targetDate)))
      .orderBy(desc(xsmbDraws.drawDate))
      .limit(10)
    const tails = recentDraws.map((draw) => draw.tail).filter((tail) => /^\d{4}$/.test(tail))

    if (tails.length < 10) {
      return NextResponse.json({
        status: 'waiting_for_ten_draws',
        targetDate,
        availableDraws: tails.length,
        ...result,
      })
    }

    const scenarioIds = scenarios.map((scenario) => scenario.id)
    const existing = await db
      .select({ scenarioId: xsmbPredictions.scenarioId })
      .from(xsmbPredictions)
      .where(
        and(
          eq(xsmbPredictions.userId, XSMB_USER_SCOPE),
          eq(xsmbPredictions.targetDate, targetDate),
          inArray(xsmbPredictions.scenarioId, scenarioIds),
        ),
      )
    const existingIds = new Set(existing.map((row) => row.scenarioId))

    for (const scenario of scenarios) {
      if (existingIds.has(scenario.id)) {
        result.skipped.push({ scenarioId: scenario.id, reason: 'already_exists' })
        continue
      }

      const preferredProvider = scenario.provider as AiProvider
      try {
        const generated = await generateSinglePrediction({
          provider: preferredProvider,
          targetDate,
          tails,
          scenarioName: scenario.name,
          scenarioPrompt: scenario.prompt,
          unavailableProviders,
        })

        const [inserted] = await db
          .insert(xsmbPredictions)
          .values({
            userId: XSMB_USER_SCOPE,
            targetDate,
            scenarioId: scenario.id,
            scenarioName: scenario.name,
            provider: generated.provider,
            modelId: generated.modelId,
            promptSnapshot: scenario.prompt,
            prediction: generated.prediction,
          })
          .onConflictDoNothing({
            target: [xsmbPredictions.userId, xsmbPredictions.targetDate, xsmbPredictions.scenarioId],
          })
          .returning({ scenarioId: xsmbPredictions.scenarioId })

        if (inserted) {
          existingIds.add(scenario.id)
          result.saved.push({
            scenarioId: scenario.id,
            provider: generated.provider,
            prediction: generated.prediction,
          })
        } else {
          result.skipped.push({ scenarioId: scenario.id, reason: 'already_exists' })
        }
      } catch (error) {
        const message = getAiFailureMessage(error, preferredProvider)
        console.error('[daily-predictions] scenario generation failed', {
          scenarioId: scenario.id,
          provider: preferredProvider,
          message,
        })
        result.failures.push({ scenarioId: scenario.id, provider: preferredProvider, message })
      }
    }

    return NextResponse.json({
      status: result.failures.length ? 'partial' : 'completed',
      targetDate,
      ...result,
    }, { status: result.failures.length ? 502 : 200 })
  } catch (error) {
    console.error('[daily-predictions] cron failed', {
      name: error instanceof Error ? error.name : 'UnknownError',
    })
    result.failures.push({
      scenarioId: 'cron',
      provider: 'system',
      message: 'Không thể chạy dự đoán tự động. Vui lòng thử lại sau.',
    })
    return NextResponse.json({ status: 'failed', targetDate, ...result }, { status: 503 })
  }
}
