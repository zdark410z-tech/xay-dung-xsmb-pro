import { generateText } from 'ai'
import { and, desc, eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { xsmbDraws, xsmbPredictions, xsmbScenarios } from '@/lib/db/schema'
import { isSameOriginRequest } from '@/lib/request-security'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 45

const USER_SCOPE = 'shared'
const AI_MODELS = {
  gemini: 'google/gemini-3.8-flash',
  deepseek: 'deepseek/deepseek-v4.1-flash',
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
}

function frequencyPrediction(values: string[], rank = 0) {
  return Array.from({ length: 4 }, (_, index) => {
    const counts: Record<string, number> = {}
    values.forEach((value) => {
      const digit = value[index]
      if (digit) counts[digit] = (counts[digit] || 0) + 1
    })
    const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1])
    return ranked[rank]?.[0] ?? ranked[0]?.[0] ?? '0'
  }).join('')
}

function formulaPrediction(scenarioId: string, tails: string[]) {
  if (scenarioId === 'c1') return frequencyPrediction(tails)
  if (scenarioId === 'c2') return frequencyPrediction(tails, 1)
  if (scenarioId === 'c3') {
    return Array.from({ length: 4 }, (_, index) => {
      const average = tails.reduce((sum, tail) => sum + Number(tail[index] ?? 0), 0) / tails.length
      return String(Math.round(average) % 10)
    }).join('')
  }
  return null
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
      .limit(5)
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
      const model = scenario.provider === 'gemini' ? AI_MODELS.gemini : AI_MODELS.deepseek
      try {
        const result = await generateText({
          model,
          instructions:
            'Bạn phân tích dữ liệu xổ số cho mục đích tham khảo, không cam kết hay khẳng định kết quả. Hãy làm theo kịch bản được cung cấp và chỉ trả về đúng một chuỗi gồm 4 chữ số.',
          prompt: [
            `Ngày xổ số mục tiêu: ${targetDate}.`,
            `Đuôi 4 số giải đặc biệt gần nhất, mới nhất trước: ${tails.join(', ')}.`,
            `Kịch bản: ${scenario.prompt}`,
            'Chỉ trả về một dãy 4 chữ số, không giải thích và không thêm dấu câu.',
          ].join('\n'),
          maxOutputTokens: 8,
        })
        prediction = result.text.match(/\d{4}/)?.[0] ?? null
      } catch {
        return NextResponse.json({ error: 'Dịch vụ AI chưa phản hồi. Vui lòng thử lại sau.' }, { status: 502 })
      }

      if (!prediction) {
        return NextResponse.json({ error: 'AI không trả về dãy 4 chữ số hợp lệ. Hãy thử lại.' }, { status: 502 })
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
