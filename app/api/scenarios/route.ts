import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { xsmbScenarios } from '@/lib/db/schema'
import { isSameOriginRequest } from '@/lib/request-security'
import type { Scenario } from '@/lib/xsmb-types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const USER_SCOPE = 'shared'
const AI_MODELS = {
  gemini: 'google/gemini-3.8-flash',
  deepseek: 'deepseek/deepseek-v4.1-flash',
} as const

type ScenarioBody = {
  id?: unknown
  name?: unknown
  provider?: unknown
  prompt?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readBody(request: NextRequest): Promise<ScenarioBody | null> {
  try {
    const body: unknown = await request.json()
    return isRecord(body) ? (body as ScenarioBody) : null
  } catch {
    return null
  }
}

function isAiProvider(value: unknown): value is 'gemini' | 'deepseek' {
  return value === 'gemini' || value === 'deepseek'
}

function toClientScenario(row: typeof xsmbScenarios.$inferSelect): Scenario {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    modelId: row.modelId,
    prompt: row.prompt,
    sortOrder: row.sortOrder,
    isBuiltin: row.isBuiltin,
    isActive: row.isActive,
  }
}

export async function GET() {
  try {
    const rows = await db
      .select()
      .from(xsmbScenarios)
      .where(and(eq(xsmbScenarios.userId, USER_SCOPE), eq(xsmbScenarios.isActive, true)))
      .orderBy(asc(xsmbScenarios.sortOrder), asc(xsmbScenarios.createdAt))

    return NextResponse.json({ scenarios: rows.map(toClientScenario) })
  } catch {
    return NextResponse.json({ error: 'Không thể tải danh sách kịch bản.' }, { status: 503 })
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Yêu cầu không hợp lệ.' }, { status: 403 })
  }

  const body = await readBody(request)
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : ''
  const provider = body?.provider

  if (name.length < 2 || name.length > 80) {
    return NextResponse.json({ error: 'Tên kịch bản cần từ 2 đến 80 ký tự.' }, { status: 400 })
  }
  if (prompt.length < 8 || prompt.length > 3000) {
    return NextResponse.json({ error: 'Nội dung kịch bản cần từ 8 đến 3.000 ký tự.' }, { status: 400 })
  }
  if (!isAiProvider(provider)) {
    return NextResponse.json({ error: 'Kịch bản mới cần chọn Gemini hoặc DeepSeek.' }, { status: 400 })
  }

  try {
    const [latest] = await db
      .select({ sortOrder: xsmbScenarios.sortOrder })
      .from(xsmbScenarios)
      .where(eq(xsmbScenarios.userId, USER_SCOPE))
      .orderBy(desc(xsmbScenarios.sortOrder))
      .limit(1)

    const [created] = await db
      .insert(xsmbScenarios)
      .values({
        id: randomUUID(),
        userId: USER_SCOPE,
        name,
        provider,
        modelId: AI_MODELS[provider],
        prompt,
        sortOrder: (latest?.sortOrder ?? -1) + 1,
        isBuiltin: false,
        isActive: true,
      })
      .returning()

    return NextResponse.json({ scenario: toClientScenario(created) }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Không thể lưu kịch bản mới.' }, { status: 503 })
  }
}

export async function PATCH(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Yêu cầu không hợp lệ.' }, { status: 403 })
  }

  const body = await readBody(request)
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'Thiếu mã kịch bản.' }, { status: 400 })

  try {
    const [current] = await db
      .select()
      .from(xsmbScenarios)
      .where(and(eq(xsmbScenarios.userId, USER_SCOPE), eq(xsmbScenarios.id, id)))
      .limit(1)

    if (!current || !current.isActive) {
      return NextResponse.json({ error: 'Không tìm thấy kịch bản.' }, { status: 404 })
    }
    if (current.provider === 'formula') {
      return NextResponse.json({ error: 'Kịch bản công thức mặc định không thể chỉnh sửa.' }, { status: 400 })
    }

    const name = typeof body?.name === 'string' ? body.name.trim() : current.name
    const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : current.prompt
    const provider = body?.provider === undefined ? current.provider : body.provider

    if (name.length < 2 || name.length > 80) {
      return NextResponse.json({ error: 'Tên kịch bản cần từ 2 đến 80 ký tự.' }, { status: 400 })
    }
    if (prompt.length < 8 || prompt.length > 3000) {
      return NextResponse.json({ error: 'Nội dung kịch bản cần từ 8 đến 3.000 ký tự.' }, { status: 400 })
    }
    if (!isAiProvider(provider)) {
      return NextResponse.json({ error: 'Chỉ hỗ trợ Gemini hoặc DeepSeek cho kịch bản AI.' }, { status: 400 })
    }

    const [updated] = await db
      .update(xsmbScenarios)
      .set({ name, prompt, provider, modelId: AI_MODELS[provider], updatedAt: new Date() })
      .where(and(eq(xsmbScenarios.userId, USER_SCOPE), eq(xsmbScenarios.id, id)))
      .returning()

    return NextResponse.json({ scenario: toClientScenario(updated) })
  } catch {
    return NextResponse.json({ error: 'Không thể cập nhật kịch bản.' }, { status: 503 })
  }
}

export async function DELETE(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Yêu cầu không hợp lệ.' }, { status: 403 })
  }

  const body = await readBody(request)
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'Thiếu mã kịch bản.' }, { status: 400 })

  try {
    const [scenario] = await db
      .select({ isBuiltin: xsmbScenarios.isBuiltin })
      .from(xsmbScenarios)
      .where(and(eq(xsmbScenarios.userId, USER_SCOPE), eq(xsmbScenarios.id, id)))
      .limit(1)

    if (!scenario || scenario.isBuiltin) {
      return NextResponse.json({ error: 'Chỉ có thể xóa kịch bản do bạn thêm.' }, { status: 400 })
    }

    await db
      .update(xsmbScenarios)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(xsmbScenarios.userId, USER_SCOPE), eq(xsmbScenarios.id, id)))

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Không thể xóa kịch bản.' }, { status: 503 })
  }
}
