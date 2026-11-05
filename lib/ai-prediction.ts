import { createDeepSeek } from '@ai-sdk/deepseek'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { generateText, Output } from 'ai'
import type { ScenarioProvider } from '@/lib/xsmb-types'

export type AiProvider = Extract<ScenarioProvider, 'gemini' | 'deepseek'>

export const AI_MODELS = {
  gemini: 'gemini-4-argon',
  deepseek: 'deepseek-v4-flash',
} as const

export class MissingProviderApiKeyError extends Error {
  constructor(readonly provider: AiProvider) {
    super('A provider API key is not configured')
    this.name = 'MissingProviderApiKeyError'
  }
}

function createModel(provider: AiProvider) {
  if (provider === 'gemini') {
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
    if (!apiKey) throw new MissingProviderApiKeyError(provider)
    return createGoogleGenerativeAI({ apiKey })(AI_MODELS.gemini)
  }

  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) throw new MissingProviderApiKeyError(provider)
  return createDeepSeek({ apiKey })(AI_MODELS.deepseek)
}

type ScenarioPrompt = {
  id: string
  name: string
  prompt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function logProviderFailure(operation: string, provider: AiProvider, error: unknown) {
  const details = isRecord(error) ? error : {}
  const rawMessage = error instanceof Error ? error.message : 'Unknown provider error'
  const message = rawMessage
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]')
    .replace(/((?:api[_ -]?key|access[_ -]?token|authorization)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]')
    .slice(0, 240)

  console.error('[v0] Direct AI provider request failed', {
    operation,
    provider,
    model: AI_MODELS[provider],
    errorName: typeof details.name === 'string' ? details.name : 'UnknownError',
    statusCode: typeof details.statusCode === 'number' ? details.statusCode : null,
    message,
  })
}

export function getAiFailureMessage(error: unknown) {
  if (error instanceof MissingProviderApiKeyError) {
    return error.provider === 'gemini'
      ? 'Chưa cấu hình GOOGLE_GENERATIVE_AI_API_KEY trong Vars của project.'
      : 'Chưa cấu hình DEEPSEEK_API_KEY trong Vars của project.'
  }

  const statusCode = isRecord(error) && typeof error.statusCode === 'number' ? error.statusCode : null
  if (statusCode === 401 || statusCode === 403) {
    return 'Nhà cung cấp từ chối khóa API. Hãy kiểm tra khóa và quyền truy cập của model.'
  }
  if (statusCode === 404) return 'Không tìm thấy model đã cấu hình ở nhà cung cấp.'
  if (statusCode === 429) return 'Nhà cung cấp đang giới hạn lượt gọi. Vui lòng thử lại sau.'
  return 'API AI chưa phản hồi. Vui lòng thử lại sau.'
}

export async function generateSinglePrediction({
  provider,
  targetDate,
  tails,
  scenarioName,
  scenarioPrompt,
}: {
  provider: AiProvider
  targetDate: string
  tails: string[]
  scenarioName: string
  scenarioPrompt: string
}) {
  try {
    const result = await generateText({
      model: createModel(provider),
      instructions:
        'Bạn phân tích dữ liệu xổ số cho mục đích tham khảo, không cam kết hay khẳng định kết quả. Hãy làm theo kịch bản được cung cấp và chỉ trả về đúng một chuỗi gồm 4 chữ số.',
      prompt: [
        `Ngày xổ số mục tiêu: ${targetDate}.`,
        `Có ${tails.length} kỳ gần nhất; đuôi 4 số giải đặc biệt, mới nhất trước: ${tails.join(', ')}.`,
        `Tên kịch bản: ${scenarioName}.`,
        `Nội dung kịch bản: ${scenarioPrompt}`,
        'Chỉ trả về một dãy 4 chữ số, không giải thích và không thêm dấu câu.',
      ].join('\n'),
      maxOutputTokens: 32,
    })
    const prediction = result.text.match(/\d{4}/)?.[0]
    if (!prediction) throw new Error('AI model returned no four-digit prediction')
    return { prediction, modelId: AI_MODELS[provider] }
  } catch (error) {
    logProviderFailure('single-prediction', provider, error)
    throw error
  }
}

export async function generateDailyBatchPredictions({
  provider,
  targetDate,
  tails,
  scenarios,
}: {
  provider: AiProvider
  targetDate: string
  tails: string[]
  scenarios: ScenarioPrompt[]
}) {
  try {
    const result = await generateText({
      model: createModel(provider),
      output: Output.json(),
      instructions:
        'Bạn phân tích xổ số để tham khảo, không huấn luyện hay thay đổi trọng số mô hình. Hãy xử lý độc lập từng kịch bản và trả về JSON có dạng {"predictions":[{"scenarioId":"...","prediction":"0123"}]}. Mỗi prediction phải là chuỗi đúng 4 chữ số.',
      prompt: JSON.stringify({
        targetDate,
        recentSpecialTails: tails,
        scenarios: scenarios.map((scenario) => ({
          scenarioId: scenario.id,
          name: scenario.name,
          instructions: scenario.prompt,
        })),
      }),
      maxOutputTokens: 768,
    })

    const output = result.output
    if (!isRecord(output) || !Array.isArray(output.predictions)) {
      throw new Error('AI model returned an invalid prediction batch')
    }

    const expectedIds = new Set(scenarios.map((scenario) => scenario.id))
    const predictions = new Map<string, string>()

    for (const item of output.predictions) {
      if (!isRecord(item) || typeof item.scenarioId !== 'string' || typeof item.prediction !== 'string') {
        throw new Error('AI model returned an invalid scenario result')
      }
      if (!expectedIds.has(item.scenarioId) || !/^\d{4}$/.test(item.prediction)) {
        throw new Error('AI model returned an unknown scenario or invalid number')
      }
      predictions.set(item.scenarioId, item.prediction)
    }

    if (predictions.size !== expectedIds.size) {
      throw new Error('AI model did not return a result for every scenario')
    }

    return predictions
  } catch (error) {
    logProviderFailure('daily-batch', provider, error)
    throw error
  }
}
