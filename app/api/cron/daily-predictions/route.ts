import { timingSafeEqual } from 'node:crypto'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { xsmbDraws, xsmbPredictions, xsmbScenarios } from '@/lib/db/schema'
import { AI_MODELS, generateDailyBatchPredictions, getAiFailureMessage, type AiProvider } from '@/lib/ai-prediction'
import { syncRecentDraws, XSMB_USER_SCOPE } from '@/lib/xsmb-source'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 45

const REQUIRED_SCENARIOS = 6
const PROVIDERS: AiProvider[] = ['gemini', 'deepseek']

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

function predictionRowId(scenarioId: string, provider: AiProvider) {
  return `${scenarioId}--${provider}`
}

function providerLabel(provider: AiProvider) {
  return provider === 'gemini' ? 'Gemini' : 'DeepSeek'
}

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Cron secret is not configured.' }, { status: 503 })
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  try {
    const scenarios = await db
      .select()
      .from(xsmbScenarios)
      .where(
        and(
          eq(xsmbScenarios.userId, XSMB_USER_SCOPE),
          eq(xsmbScenarios.isActive, true),
          eq(xsmbScenarios.isBuiltin, false),
          inArray(xsmbScenarios.provider, ['gemini', 'deepseek']),
        ),
      )
      .orderBy(xsmbScenarios.sortOrder)
      .limit(REQUIRED_SCENARIOS + 1)

    if (scenarios.length !== REQUIRED_SCENARIOS) {
      return NextResponse.json({
        status: 'waiting_for_six_scenarios',
        configured: scenarios.length,
        required: REQUIRED_SCENARIOS,
      })
    }

    const targetDate = getVietnamDate()
    const sync = await syncRecentDraws()
    if (sync.count < 10) {
      return NextResponse.json({
        status: 'waiting_for_ten_draws',
        targetDate,
        availableDraws: sync.count,
        message: sync.syncError,
      })
    }

    const recentDraws = await db
      .select({ tail: xsmbDraws.tail })
      .from(xsmbDraws)
      .where(eq(xsmbDraws.userId, XSMB_USER_SCOPE))
      .orderBy(desc(xsmbDraws.drawDate))
      .limit(10)
    const tails = recentDraws.map((draw) => draw.tail).filter((tail) => /^\d{4}$/.test(tail))

    if (tails.length < 10) {
      return NextResponse.json({
        status: 'waiting_for_ten_draws',
        targetDate,
        availableDraws: tails.length,
      })
    }

    const scheduledIds = scenarios.flatMap((scenario) =>
      PROVIDERS.map((provider) => predictionRowId(scenario.id, provider)),
    )
    const existing = await db
      .select({ scenarioId: xsmbPredictions.scenarioId })
      .from(xsmbPredictions)
      .where(
        and(
          eq(xsmbPredictions.userId, XSMB_USER_SCOPE),
          eq(xsmbPredictions.targetDate, targetDate),
          inArray(xsmbPredictions.scenarioId, scheduledIds),
        ),
      )
    const existingIds = new Set(existing.map((row) => row.scenarioId))

    if (existingIds.size === scheduledIds.length) {
      return NextResponse.json({ status: 'already_complete', targetDate, saved: existingIds.size })
    }

    const providerRuns = await Promise.allSettled(
      PROVIDERS.map(async (provider) => {
        const pendingScenarios = scenarios.filter(
          (scenario) => !existingIds.has(predictionRowId(scenario.id, provider)),
        )
        if (!pendingScenarios.length) return { provider, saved: 0 }

        const generated = await generateDailyBatchPredictions({
          provider,
          targetDate,
          tails,
          scenarios: pendingScenarios.map((scenario) => ({
            id: scenario.id,
            name: scenario.name,
            prompt: scenario.prompt,
          })),
        })

        const inserted = await db
          .insert(xsmbPredictions)
          .values(pendingScenarios.map((scenario) => ({
            userId: XSMB_USER_SCOPE,
            targetDate,
            scenarioId: predictionRowId(scenario.id, provider),
            scenarioName: `${scenario.name} · ${providerLabel(provider)}`,
            provider,
            modelId: generated.modelId,
            promptSnapshot: scenario.prompt,
            prediction: generated.predictions.get(scenario.id)!
          })))
          .onConflictDoNothing({
            target: [xsmbPredictions.userId, xsmbPredictions.targetDate, xsmbPredictions.scenarioId],
          })
          .returning({ id: xsmbPredictions.id })

        return { provider, saved: inserted.length }
      }),
    )

    const saved = providerRuns.reduce(
      (total, run) => total + (run.status === 'fulfilled' ? run.value.saved : 0),
      0,
    )
    const failures = providerRuns.flatMap((run, index) =>
      run.status === 'rejected'
        ? [{ provider: PROVIDERS[index], message: getAiFailureMessage(run.reason, PROVIDERS[index]) }]
        : [],
    )

    if (failures.length) {
      return NextResponse.json({ status: 'partial', targetDate, saved, failures }, { status: 502 })
    }

    return NextResponse.json({ status: 'completed', targetDate, saved })
  } catch {
    return NextResponse.json({ error: 'Không thể chạy dự đoán tự động.' }, { status: 503 })
  }
}
