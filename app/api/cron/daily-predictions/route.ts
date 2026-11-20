import { timingSafeEqual } from 'node:crypto'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ensureDefaultAnalysisScenarios } from '@/lib/db/seed'
import { xsmbAiReports, xsmbDraws, xsmbPredictions, xsmbScenarios } from '@/lib/db/schema'
import { AI_MODELS, generateDailyBatchPredictions, getAiFailureMessage, type AiProvider } from '@/lib/ai-prediction'
import { formulaPrediction } from '@/lib/xsmb-formulas'
import { syncRecentDraws, XSMB_USER_SCOPE } from '@/lib/xsmb-source'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const REQUIRED_SCENARIOS = 6
const PROVIDERS: AiProvider[] = ['groq', 'deepseek']
const BASE_METHODS = [
  { id: 'c1', name: 'Công thức 1' },
  { id: 'c2', name: 'Công thức 2' },
  { id: 'c3', name: 'Công thức 3' },
  { id: 'groq', name: 'Groq AI' },
  { id: 'deepseek', name: 'DeepSeek AI' },
] as const

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
  if (provider === 'groq') return 'Groq'
  return provider === 'gemini' ? 'Gemini' : 'DeepSeek'
}

function matchingDigits(prediction: string, tail: string) {
  return [...prediction].filter((digit, index) => digit === tail[index]).length
}

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Cron secret is not configured.' }, { status: 503 })
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

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
      .select({
        drawDate: xsmbDraws.drawDate,
        day: xsmbDraws.day,
        special: xsmbDraws.special,
        tail: xsmbDraws.tail,
        prizes: xsmbDraws.prizes,
      })
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

    const recentDates = recentDraws.map((draw) => draw.drawDate)
    const methodIds = BASE_METHODS.map((method) => method.id)
    const [historicalMethodPredictions, currentMethodRows] = await Promise.all([
      db
        .select({ targetDate: xsmbPredictions.targetDate, scenarioId: xsmbPredictions.scenarioId, prediction: xsmbPredictions.prediction })
        .from(xsmbPredictions)
        .where(
          and(
            eq(xsmbPredictions.userId, XSMB_USER_SCOPE),
            inArray(xsmbPredictions.targetDate, recentDates),
            inArray(xsmbPredictions.scenarioId, methodIds),
          ),
        ),
      db
        .select({ scenarioId: xsmbPredictions.scenarioId, prediction: xsmbPredictions.prediction })
        .from(xsmbPredictions)
        .where(
          and(
            eq(xsmbPredictions.userId, XSMB_USER_SCOPE),
            eq(xsmbPredictions.targetDate, targetDate),
            inArray(xsmbPredictions.scenarioId, methodIds),
          ),
        ),
    ])

    const tailByDate = new Map(recentDraws.map((draw) => [draw.drawDate, draw.tail]))
    const methodPerformance = BASE_METHODS.map((method) => {
      const evaluated = historicalMethodPredictions.filter(
        (row) => row.scenarioId === method.id && tailByDate.has(row.targetDate),
      )
      const matchedDigits = evaluated.reduce(
        (sum, row) => sum + matchingDigits(row.prediction, tailByDate.get(row.targetDate) ?? ''),
        0,
      )
      const totalDigits = evaluated.length * 4
      return {
        scenarioId: method.id,
        name: method.name,
        matchedDigits,
        totalDigits,
        accuracyPercent: totalDigits ? ((matchedDigits / totalDigits) * 100).toFixed(1) : null,
      }
    })

    const currentMethodById = new Map(currentMethodRows.map((row) => [row.scenarioId, row.prediction]))
    const currentMethodPredictions = BASE_METHODS.map((method) => ({
      scenarioId: method.id,
      name: method.name,
      prediction: method.id === 'c1' || method.id === 'c2' || method.id === 'c3'
        ? formulaPrediction(method.id, tails)
        : currentMethodById.get(method.id) ?? null,
    }))

    const analysisContext = {
      draws: [...recentDraws].reverse().map((draw) => ({
        date: draw.drawDate,
        day: draw.day,
        special: draw.special,
        tail: draw.tail,
        prizes: draw.prizes,
      })),
      methodPerformance,
      currentMethodPredictions,
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
          analysisContext,
          scenarios: pendingScenarios.map((scenario) => ({
            id: scenario.id,
            name: scenario.name,
            prompt: scenario.prompt,
          })),
        })

        const rows = pendingScenarios.map((scenario) => {
          const report = generated.reports.get(scenario.id)
          if (!report) throw new Error('Missing generated scenario report')
          const scenarioId = predictionRowId(scenario.id, provider)
          const scenarioName = `${scenario.name} · ${providerLabel(provider)}`
          return {
            prediction: {
              userId: XSMB_USER_SCOPE,
              targetDate,
              scenarioId,
              scenarioName,
              provider,
              modelId: generated.modelId,
              promptSnapshot: scenario.prompt,
              prediction: report.prediction,
            },
            report: {
              userId: XSMB_USER_SCOPE,
              targetDate,
              scenarioId,
              scenarioName,
              provider,
              modelId: generated.modelId,
              promptSnapshot: scenario.prompt,
              prediction: report.prediction,
              analysis: report.analysis,
            },
          }
        })

        const saved = await db.transaction(async (transaction) => {
          const insertedPredictions = await transaction
            .insert(xsmbPredictions)
            .values(rows.map((row) => row.prediction))
            .onConflictDoNothing({
              target: [xsmbPredictions.userId, xsmbPredictions.targetDate, xsmbPredictions.scenarioId],
            })
            .returning({ id: xsmbPredictions.id })
          const insertedReports = await transaction
            .insert(xsmbAiReports)
            .values(rows.map((row) => row.report))
            .onConflictDoNothing({
              target: [xsmbAiReports.userId, xsmbAiReports.targetDate, xsmbAiReports.scenarioId],
            })
            .returning({ id: xsmbAiReports.id })
          return Math.min(insertedPredictions.length, insertedReports.length)
        })

        return { provider, saved }
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
