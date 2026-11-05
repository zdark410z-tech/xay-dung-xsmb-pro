import { and, desc, eq } from 'drizzle-orm'
import { generateSinglePrediction, getAiFailureMessage, type AiProvider } from '@/lib/ai-prediction'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { formulaPrediction } from '@/lib/xsmb-formulas'
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

    const [existing] = await db
      .select({ prediction: xsmbPredictions.prediction })
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
        scenarioId: scenario.id,
        targetDate,
        alreadySaved: true,
      })
    }

    const recentDraws = await db
      .select({ tail: xsmbDraws.tail })
      .from(xsmbDraws)
      .where(eq(xsmbDraws.userId, USER_SCOPE))
      .orderBy(desc(xsmbDraws.drawDate))
      .limit(10)
    const tails = recentDraws.map((draw) => draw.tail).filter((tail) => /^\d{4}$/.test(tail))

    if (!tails.length) {
      return NextResponse.json({ error: 'Chưa có kết quả xổ số để phân tích. Hãy đồng bộ dữ liệu trước.' }, { status: 409 })
    }

    let prediction: string | null = null
    let modelId: string | null = scenario.modelId

    if (scenario.provider === 'formula') {
      prediction = formulaPrediction(scenario.id, tails)
      if (!prediction) {
        return NextResponse.json({ error: 'Kịch bản công thức không được hỗ trợ.' }, { status: 400 })
      }
      modelId = null
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
      } catch (error) {
        return NextResponse.json({ error: getAiFailureMessage(error, scenario.provider) }, { status: 502 })
      }
    }

    const [inserted] = await db
      .insert(xsmbPredictions)
      .values({
        userId: USER_SCOPE,
        targetDate,
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        provider: scenario.provider,
        modelId,
        promptSnapshot: scenario.prompt,
        prediction,
      })
      .onConflictDoNothing({
        target: [xsmbPredictions.userId, xsmbPredictions.targetDate, xsmbPredictions.scenarioId],
      })
      .returning({ prediction: xsmbPredictions.prediction })

    if (inserted) {
      return NextResponse.json({ prediction: inserted.prediction, scenarioId: scenario.id, targetDate })
    }

    const [saved] = await db
      .select({ prediction: xsmbPredictions.prediction })
      .from(xsmbPredictions)
      .where(
        and(
          eq(xsmbPredictions.userId, USER_SCOPE),
          eq(xsmbPredictions.targetDate, targetDate),
          eq(xsmbPredictions.scenarioId, scenario.id),
        ),
      )
      .limit(1)

    return NextResponse.json({
      prediction: saved?.prediction ?? prediction,
      scenarioId: scenario.id,
      targetDate,
      alreadySaved: true,
    })
  } catch {
    return NextResponse.json({ error: 'Không thể lưu dự đoán vào lịch sử.' }, { status: 503 })
  }
}
