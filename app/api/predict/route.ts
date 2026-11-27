import { and, desc, eq, lt } from 'drizzle-orm'
import { generateSinglePrediction, getAiFailureMessage, getProviderFailureSummaries, type AiProvider } from '@/lib/ai-prediction'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AI_PREDICTIONS_ENABLED } from '@/lib/ai-config'
import { formulaPrediction } from '@/lib/xsmb-formulas'
import { positionRulePrediction } from '@/lib/xsmb-position-rules'
import { xsmbDraws, xsmbPredictions, xsmbScenarios } from '@/lib/db/schema'
import { isSameOriginRequest } from '@/lib/request-security'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 45

const USER_SCOPE = 'shared'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
}

function getVietnamDateTime() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour),
  }
}

function invalidTargetDateMessage(targetDate: string, today: string) {
  return targetDate < today
    ? 'Không thể dự đoán cho ngày đã qua. Chỉ chấp nhận ngày hôm nay theo giờ Việt Nam.'
    : 'Không thể dự đoán cho ngày tương lai. Chỉ chấp nhận ngày hôm nay theo giờ Việt Nam.'
}

function safePersistenceError(error: unknown) {
  const details = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const name = error instanceof Error ? error.name : 'UnknownError'
  let message = error instanceof Error ? error.message : String(error)
  const secrets = Object.entries(process.env)
    .filter(([key, value]) => value && /DATABASE_URL|API_KEY|SECRET|TOKEN/i.test(key))
    .map(([, value]) => value as string)
    .filter((value) => value.length >= 8)
  for (const secret of secrets) message = message.replaceAll(secret, '[redacted]')
  message = message
    .replace(/postgres(?:ql)?:\/\/[^\s"'`]+/gi, '[database connection redacted]')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]')
    .replace(/((?:api[_ -]?key|access[_ -]?token|authorization|password|secret)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]')
    .slice(0, 180)
  return { name, message, code: typeof details.code === 'string' || typeof details.code === 'number' ? details.code : null }
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Yêu cầu không hợp lệ.' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Dữ liệu gửi lên không hợp lệ.' }, { status: 400 })
  }

  if (!isRecord(body) || typeof body.scenarioId !== 'string' || !isDateKey(body.targetDate)) {
    return NextResponse.json({ error: 'Vui lòng chọn kịch bản và ngày dự đoán hợp lệ.' }, { status: 400 })
  }

  const { scenarioId, targetDate } = body
  const requestDateTime = getVietnamDateTime()
  if (targetDate !== requestDateTime.date) {
    return NextResponse.json({ error: invalidTargetDateMessage(targetDate, requestDateTime.date) }, { status: 400 })
  }

  try {
    const [scenario] = await db
      .select()
      .from(xsmbScenarios)
      .where(
        and(
          eq(xsmbScenarios.userId, USER_SCOPE),
          eq(xsmbScenarios.id, scenarioId),
          eq(xsmbScenarios.isActive, true),
        ),
      )
      .limit(1)

    if (!scenario) {
      return NextResponse.json({ error: 'Không tìm thấy kịch bản đang hoạt động.' }, { status: 404 })
    }
    if (!AI_PREDICTIONS_ENABLED && scenario.provider !== 'formula') {
      return NextResponse.json({ error: 'Dự đoán bằng AI đang tắt' }, { status: 403 })
    }

    const [existing] = await db
      .select({ prediction: xsmbPredictions.prediction, provider: xsmbPredictions.provider })
      .from(xsmbPredictions)
      .where(
        and(
          eq(xsmbPredictions.userId, USER_SCOPE),
          eq(xsmbPredictions.targetDate, targetDate),
          eq(xsmbPredictions.scenarioId, scenario.id),
        ),
      )
      .limit(1)

    if (existing) {
      return NextResponse.json({
        prediction: existing.prediction,
        provider: existing.provider,
        scenarioId: scenario.id,
        targetDate,
        saved: true,
        persisted: true,
        alreadySaved: true,
      })
    }

    const latestDateTime = getVietnamDateTime()
    if (targetDate !== latestDateTime.date) {
      return NextResponse.json({ error: invalidTargetDateMessage(targetDate, latestDateTime.date) }, { status: 400 })
    }
    if (latestDateTime.hour >= 18) {
      return NextResponse.json({
        error: 'Đã qua 18:00 giờ Việt Nam. Chỉ có thể xem dự đoán đã lưu; không thể tạo dự đoán mới.',
      }, { status: 409 })
    }

    const recentDraws = await db
      .select({ tail: xsmbDraws.tail })
      .from(xsmbDraws)
      .where(and(eq(xsmbDraws.userId, USER_SCOPE), lt(xsmbDraws.drawDate, targetDate)))
      .orderBy(desc(xsmbDraws.drawDate))
      .limit(10)
    const tails = recentDraws.map((draw) => draw.tail).filter((tail) => /^\d{4}$/.test(tail))

    const isPositionFormula = scenario.provider === 'formula' && /^kb(?:[7-9]|1[0-3])$/.test(scenario.id)
    if (!tails.length && !(scenario.id === 'kb12' && scenario.provider === 'formula')) {
      return NextResponse.json({ error: 'Chưa có kết quả xổ số để phân tích. Hãy đồng bộ dữ liệu trước.' }, { status: 409 })
    }

    let prediction: string | null = null
    let modelId: string | null = scenario.modelId
    let activeProvider: AiProvider | 'formula' = scenario.provider as AiProvider | 'formula'

    if (scenario.provider === 'formula') {
      if (isPositionFormula) {
        const priorDraws = await db
          .select({ date: xsmbDraws.drawDate, tail: xsmbDraws.tail, prizes: xsmbDraws.prizes })
          .from(xsmbDraws)
          .where(and(eq(xsmbDraws.userId, USER_SCOPE), lt(xsmbDraws.drawDate, targetDate)))
          .orderBy(desc(xsmbDraws.drawDate))
          .limit(2)
        const calculated = positionRulePrediction(scenario.id, targetDate, priorDraws)
        prediction = calculated?.prediction ?? null
        if (!prediction) {
          return NextResponse.json({ error: 'Chưa đủ dữ liệu của các kỳ liền trước cho kịch bản này.' }, { status: 409 })
        }
      } else {
        prediction = formulaPrediction(scenario.id, tails)
      }
      if (!prediction) {
        return NextResponse.json({ error: 'Kịch bản công thức không được hỗ trợ.' }, { status: 400 })
      }
      modelId = null
      activeProvider = 'formula'
    } else {
      try {
        const result = await generateSinglePrediction({
          provider: scenario.provider as AiProvider,
          targetDate,
          tails,
          scenarioName: scenario.name,
          scenarioPrompt: scenario.prompt,
        })
        prediction = result.prediction
        modelId = result.modelId
        activeProvider = result.provider
      } catch (error) {
        const providerErrors = getProviderFailureSummaries(error)
        return NextResponse.json({
          error: providerErrors.length
            ? providerErrors.map(({ message }) => message).join(' · ')
            : getAiFailureMessage(error, scenario.provider as AiProvider),
          ...(providerErrors.length ? { providerErrors } : {}),
        }, { status: 502 })
      }
    }

    if (activeProvider === 'formula') {
      let inserted = false
      try {
        const [newRow] = await db
          .insert(xsmbPredictions)
          .values({
            userId: USER_SCOPE,
            targetDate,
            scenarioId: scenario.id,
            scenarioName: scenario.name,
            provider: 'formula',
            modelId: null,
            promptSnapshot: scenario.prompt,
            prediction,
          })
          .onConflictDoNothing({
            target: [xsmbPredictions.userId, xsmbPredictions.targetDate, xsmbPredictions.scenarioId],
          })
          .returning({ scenarioId: xsmbPredictions.scenarioId })
        inserted = Boolean(newRow)

        const [persisted] = await db
          .select({ prediction: xsmbPredictions.prediction, provider: xsmbPredictions.provider })
          .from(xsmbPredictions)
          .where(and(
            eq(xsmbPredictions.userId, USER_SCOPE),
            eq(xsmbPredictions.targetDate, targetDate),
            eq(xsmbPredictions.scenarioId, scenario.id),
          ))
          .limit(1)

        if (!persisted) throw new Error('Không tìm thấy dòng dự đoán sau khi lưu')
        return NextResponse.json({
          prediction: persisted.prediction,
          provider: persisted.provider,
          scenarioId: scenario.id,
          targetDate,
          saved: true,
          persisted: true,
          ...(!inserted ? { alreadySaved: true } : {}),
        }, { headers: { 'Cache-Control': 'no-store' } })
      } catch (error) {
        const details = safePersistenceError(error)
        console.error('[predict] formula persistence failed', {
          scenarioId: scenario.id,
          targetDate,
          name: details.name,
          message: details.message,
          code: details.code,
        })
        return NextResponse.json({
          error: `Không lưu được dự đoán (${details.name}: ${details.message})`,
          scenarioId: scenario.id,
          targetDate,
          persisted: false,
        }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
      }
    }

    const [inserted] = await db
      .insert(xsmbPredictions)
      .values({
        userId: USER_SCOPE,
        targetDate,
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        provider: activeProvider,
        modelId,
        promptSnapshot: scenario.prompt,
        prediction,
      })
      .onConflictDoNothing({
        target: [xsmbPredictions.userId, xsmbPredictions.targetDate, xsmbPredictions.scenarioId],
      })
      .returning({ prediction: xsmbPredictions.prediction, provider: xsmbPredictions.provider })

    if (inserted) {
      return NextResponse.json({ prediction: inserted.prediction, provider: inserted.provider, scenarioId: scenario.id, targetDate, saved: true, persisted: true }, { headers: { 'Cache-Control': 'no-store' } })
    }

    const [saved] = await db
      .select({ prediction: xsmbPredictions.prediction, provider: xsmbPredictions.provider })
      .from(xsmbPredictions)
      .where(
        and(
          eq(xsmbPredictions.userId, USER_SCOPE),
          eq(xsmbPredictions.targetDate, targetDate),
          eq(xsmbPredictions.scenarioId, scenario.id),
        ),
      )
      .limit(1)

    if (!saved) {
      return NextResponse.json({ error: 'Không thể xác nhận dự đoán đã lưu trong lịch sử.', persisted: false }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
    }

    return NextResponse.json({
      prediction: saved.prediction,
      provider: saved.provider,
      scenarioId: scenario.id,
      targetDate,
      saved: true,
      persisted: true,
      alreadySaved: true,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'Không thể lưu dự đoán vào lịch sử.' }, { status: 503 })
  }
}
