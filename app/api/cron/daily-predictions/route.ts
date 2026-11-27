import { timingSafeEqual } from 'node:crypto'
import { and, desc, eq, inArray, lt } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AllProvidersFailedError, generateDailyCommentary, getProviderFailureSummaries, type AiProvider } from '@/lib/ai-prediction'
import { xsmbAiReports, xsmbDraws, xsmbPredictions } from '@/lib/db/schema'
import { calculateBacktest, BACKTEST_FREEZE_DATE, type BacktestResult } from '@/lib/xsmb-backtest'
import { FORMULA_SCENARIOS, positionRulePrediction } from '@/lib/xsmb-position-rules'
import { formulaPrediction } from '@/lib/xsmb-formulas'
import { syncRecentDraws, XSMB_USER_SCOPE } from '@/lib/xsmb-source'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 90

const COMMENTARY_SCENARIO_ID = 'AI_COMMENTARY'
const AUTOMATIC_COMMENTARY_MODEL = 'automatic-code'

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
  saved: Array<{ scenarioId: string; provider: AiProvider | 'formula'; prediction: string }>
  skipped: Array<{ scenarioId: string; reason: 'already_exists' | 'insufficient_history' }>
  failures: Array<{ scenarioId: string; provider: AiProvider | 'system'; message: string }>
}

function getCommentaryTable(backtest: BacktestResult) {
  const toRows = (rows: BacktestResult['groups']['all']) => rows.map(({ scenarioId, name, n, positions }) => ({
    scenarioId,
    name,
    n,
    positions: positions.map(({ hits, rate, expectedRate, pValue }) => ({ hits, rate, expectedRate, pValue })),
  }))
  return {
    tatCa: toRows(backtest.groups.all),
    ngoaiMau: toRows(backtest.groups['after-freeze']),
  }
}

function automaticCommentary(backtest: BacktestResult) {
  const observations = backtest.groups.all.flatMap((scenario) => scenario.positions.map((position, index) => ({
    name: scenario.name,
    n: scenario.n,
    hits: position.hits,
    rate: position.rate,
    expectedRate: position.expectedRate,
    pValue: position.pValue,
    position: ['nghìn', 'trăm', 'chục', 'đơn vị'][index],
  })))
  const best = observations
    .filter((item) => item.rate !== null && item.expectedRate !== null && item.rate > item.expectedRate)
    .sort((left, right) => (right.rate ?? 0) - (right.expectedRate ?? 0) - ((left.rate ?? 0) - (left.expectedRate ?? 0)))[0]

  if (!best) return 'Backtest chưa cho thấy vị trí nào vượt mức ngẫu nhiên kỳ vọng. Kết quả xổ số mang tính ngẫu nhiên; số liệu lịch sử không dự đoán được ngày mai.'
  const rate = `${((best.rate ?? 0) * 100).toFixed(1).replace('.', ',')}%`
  const expected = `${((best.expectedRate ?? 0) * 100).toFixed(1).replace('.', ',')}%`
  const sampleNote = best.n < 100 || backtest.groups.all.some((scenario) => scenario.n < 100) ? ' Mẫu còn nhỏ.' : ''
  const significanceNote = typeof best.pValue !== 'number' || best.pValue >= 0.05 / 28
    ? ' Chưa có bằng chứng khác ngẫu nhiên.'
    : ' Tín hiệu cần được diễn giải thận trọng.'
  return `${best.name} có tỷ lệ ${best.position} ${rate}, cao hơn mức ngẫu nhiên kỳ vọng ${expected}, nhưng đây chưa phải dự báo.${sampleNote}${significanceNote} Kết quả xổ số mang tính ngẫu nhiên.`
}

async function saveDailyFormulaPredictions(targetDate: string, result: CronResult) {
  const scenarioIds = FORMULA_SCENARIOS.map((scenario) => scenario.id)
  const scenarios = FORMULA_SCENARIOS

  const priorDraws = await db
    .select({ date: xsmbDraws.drawDate, tail: xsmbDraws.tail, prizes: xsmbDraws.prizes })
    .from(xsmbDraws)
    .where(and(eq(xsmbDraws.userId, XSMB_USER_SCOPE), lt(xsmbDraws.drawDate, targetDate)))
    .orderBy(desc(xsmbDraws.drawDate))
    .limit(10)
  const existing = await db
    .select({ scenarioId: xsmbPredictions.scenarioId })
    .from(xsmbPredictions)
    .where(and(
      eq(xsmbPredictions.userId, XSMB_USER_SCOPE),
      eq(xsmbPredictions.targetDate, targetDate),
      inArray(xsmbPredictions.scenarioId, scenarioIds),
    ))
  const existingIds = new Set(existing.map((row) => row.scenarioId))
  const tails = priorDraws.map((draw) => draw.tail).filter((tail) => /^\d{4}$/.test(tail))

  for (const scenario of scenarios) {
    if (existingIds.has(scenario.id)) {
      result.skipped.push({ scenarioId: scenario.id, reason: 'already_exists' })
      continue
    }

    const calculated = /^c[1-3]$/.test(scenario.id)
      ? tails.length ? formulaPrediction(scenario.id, tails) : null
      : positionRulePrediction(scenario.id, targetDate, priorDraws)?.prediction ?? null
    if (!calculated) {
      result.skipped.push({ scenarioId: scenario.id, reason: 'insufficient_history' })
      continue
    }

    try {
      await db
        .insert(xsmbPredictions)
        .values({
          userId: XSMB_USER_SCOPE,
          targetDate,
          scenarioId: scenario.id,
          scenarioName: scenario.name,
          provider: 'formula',
          modelId: null,
          promptSnapshot: scenario.prompt,
          prediction: calculated,
        })
        .onConflictDoNothing({
          target: [xsmbPredictions.userId, xsmbPredictions.targetDate, xsmbPredictions.scenarioId],
        })

      const [persisted] = await db
        .select({ scenarioId: xsmbPredictions.scenarioId, prediction: xsmbPredictions.prediction })
        .from(xsmbPredictions)
        .where(and(
          eq(xsmbPredictions.userId, XSMB_USER_SCOPE),
          eq(xsmbPredictions.targetDate, targetDate),
          eq(xsmbPredictions.scenarioId, scenario.id),
        ))
        .limit(1)

      if (!persisted) throw new Error('Không tìm thấy dòng dự đoán sau khi lưu')
      existingIds.add(scenario.id)
      result.saved.push({ scenarioId: scenario.id, provider: 'formula', prediction: persisted.prediction })
    } catch (error) {
      const details = error && typeof error === 'object' ? error as Record<string, unknown> : {}
      const name = error instanceof Error ? error.name : 'UnknownError'
      const message = error instanceof Error ? error.message : String(error)
      console.error('[daily-predictions] formula persistence failed', {
        scenarioId: scenario.id,
        targetDate,
        name,
        message,
        code: typeof details.code === 'string' ? details.code : null,
      })
      result.failures.push({ scenarioId: scenario.id, provider: 'system', message: `${name}: ${message.slice(0, 160)}` })
    }
  }
}

async function saveDailyCommentary(targetDate: string, backtest: BacktestResult, result: CronResult) {
  const promptSnapshot = JSON.stringify(getCommentaryTable(backtest))
  const fallback = automaticCommentary(backtest)
  const [reservation] = await db
    .insert(xsmbAiReports)
    .values({
      userId: XSMB_USER_SCOPE,
      targetDate,
      scenarioId: COMMENTARY_SCENARIO_ID,
      scenarioName: 'Nhận xét AI hằng ngày',
      provider: 'formula',
      modelId: AUTOMATIC_COMMENTARY_MODEL,
      promptSnapshot,
      analysis: fallback,
      prediction: '',
    })
    .onConflictDoNothing({
      target: [xsmbAiReports.userId, xsmbAiReports.targetDate, xsmbAiReports.scenarioId],
    })
    .returning({ id: xsmbAiReports.id })

  if (!reservation) {
    result.skipped.push({ scenarioId: COMMENTARY_SCENARIO_ID, reason: 'already_exists' })
    return
  }

  try {
    const generated = await generateDailyCommentary(backtest)
    await db
      .update(xsmbAiReports)
      .set({
        provider: generated.provider,
        modelId: generated.modelId,
        analysis: generated.analysis,
      })
      .where(eq(xsmbAiReports.id, reservation.id))
    result.saved.push({ scenarioId: COMMENTARY_SCENARIO_ID, provider: generated.provider, prediction: generated.analysis })
  } catch (error) {
    console.error('[daily-predictions] commentary generation failed; saved automatic code commentary', {
      targetDate,
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : String(error),
    })
    if (error instanceof AllProvidersFailedError) {
      for (const failure of getProviderFailureSummaries(error)) {
        const provider = failure.provider as AiProvider
        result.failures.push({ scenarioId: COMMENTARY_SCENARIO_ID, provider, message: failure.message })
      }
    } else {
      result.failures.push({
        scenarioId: COMMENTARY_SCENARIO_ID,
        provider: 'system',
        message: 'Không thể cập nhật nhận xét AI; đã lưu nhận xét tự động.',
      })
    }
    result.saved.push({ scenarioId: COMMENTARY_SCENARIO_ID, provider: 'formula', prediction: fallback })
  }
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

  try {
    const sync = await syncRecentDraws()
    await saveDailyFormulaPredictions(targetDate, result)

    const draws = await db
      .select({ date: xsmbDraws.drawDate, tail: xsmbDraws.tail, prizes: xsmbDraws.prizes })
      .from(xsmbDraws)
      .where(eq(xsmbDraws.userId, XSMB_USER_SCOPE))
      .orderBy(desc(xsmbDraws.drawDate))
    const backtest = calculateBacktest(draws, targetDate, BACKTEST_FREEZE_DATE)
    await saveDailyCommentary(targetDate, backtest, result)

    return NextResponse.json({
      status: result.failures.length ? 'partial' : 'completed',
      targetDate,
      syncedDraws: sync.count,
      syncError: sync.syncError,
      ...result,
    }, { status: result.failures.length ? 502 : 200, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[daily-predictions] cron failed', {
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : String(error),
    })
    result.failures.push({
      scenarioId: 'cron',
      provider: 'system',
      message: 'Không thể chạy dự đoán tự động. Vui lòng thử lại sau.',
    })
    return NextResponse.json({ status: 'failed', targetDate, ...result }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
