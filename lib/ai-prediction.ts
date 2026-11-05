import { createDeepSeek } from '@ai-sdk/deepseek'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { generateText, Output } from 'ai'
import type { ScenarioProvider } from '@/lib/xsmb-types'

export type AiProvider = Extract<ScenarioProvider, 'gemini' | 'deepseek'>

export const AI_MODELS = {
  gemini: 'gemini-3.8-flash',
  deepseek: 'deepseek-v4-flash',
} as const

const GEMINI_FALLBACK_MODEL = 'gemini-3.5-flash'

export class MissingProviderApiKeyError extends Error {
  constructor(readonly provider: AiProvider) {
    super('A provider API key is not configured')
    this.name = 'MissingProviderApiKeyError'
  }
}

function createModel(provider: AiProvider, modelId: string = AI_MODELS[provider]) {
  if (provider === 'gemini') {
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
    if (!apiKey) throw new MissingProviderApiKeyError(provider)
    return createGoogleGenerativeAI({ apiKey })(modelId)
  }

  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) throw new MissingProviderApiKeyError(provider)
  return createDeepSeek({ apiKey })(modelId)
}

type DirectModel = ReturnType<typeof createModel>

function isTemporaryModelOverload(error: unknown) {
  const statusCode = isRecord(error) && typeof error.statusCode === 'number' ? error.statusCode : null
  return statusCode === 429 || statusCode === 503 || /currently experiencing high demand|temporarily unavailable|overloaded|timed? out|timeout|aborted/i.test(safeErrorMessage(error))
}

async function generateWithModelFallback<T>(
  provider: AiProvider,
  operation: string,
  run: (model: DirectModel) => Promise<T>,
) {
  const modelIds: string[] = provider === 'gemini'
    ? [AI_MODELS.gemini, GEMINI_FALLBACK_MODEL]
    : [AI_MODELS.deepseek]

  for (let index = 0; index < modelIds.length; index += 1) {
    const modelId = modelIds[index]
    try {
      return { result: await run(createModel(provider, modelId)), modelId }
    } catch (error) {
      const hasFallback = index < modelIds.length - 1
      if (hasFallback && isTemporaryModelOverload(error)) {
        console.warn('[v0] Gemini model busy; switching to fallback', {
          primaryModel: modelId,
          fallbackModel: modelIds[index + 1],
        })
        continue
      }
      logProviderFailure(operation, provider, error)
      throw error
    }
  }

  throw new Error('No AI model was available')
}

type ScenarioPrompt = {
  id: string
  name: string
  prompt: string
}

type DailyAnalysisContext = {
  draws: Array<{
    date: string
    day: string
    special: string
    tail: string
    prizes: string[][]
  }>
  methodPerformance: Array<{
    scenarioId: string
    name: string
    matchedDigits: number
    totalDigits: number
    accuracyPercent: string | null
  }>
  currentMethodPredictions: Array<{
    scenarioId: string
    name: string
    prediction: string | null
  }>
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeErrorMessage(error: unknown) {
  const rawMessage = error instanceof Error ? error.message : 'Unknown provider error'
  return rawMessage
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]')
    .replace(/((?:api[_ -]?key|access[_ -]?token|authorization)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]')
    .slice(0, 240)
}

function logProviderFailure(operation: string, provider: AiProvider, error: unknown) {
  const details = isRecord(error) ? error : {}
  console.error('[v0] Direct AI provider request failed', {
    operation,
    provider,
    model: AI_MODELS[provider],
    errorName: typeof details.name === 'string' ? details.name : 'UnknownError',
    statusCode: typeof details.statusCode === 'number' ? details.statusCode : null,
    message: safeErrorMessage(error),
  })
}

export function getAiFailureMessage(error: unknown, provider?: AiProvider) {
  if (error instanceof MissingProviderApiKeyError) {
    return error.provider === 'gemini'
      ? 'Chưa cấu hình GOOGLE_GENERATIVE_AI_API_KEY trong Vars của project.'
      : 'Chưa cấu hình DEEPSEEK_API_KEY trong Vars của project.'
  }

  const details = isRecord(error) ? error : {}
  const statusCode = typeof details.statusCode === 'number' ? details.statusCode : null
  const message = safeErrorMessage(error)
  if (/insufficient balance|low balance|balance is not enough/i.test(message)) {
    return 'DeepSeek báo số dư API không đủ. Hãy nạp số dư hoặc kiểm tra billing của tài khoản DeepSeek.'
  }
  if (/high demand|overloaded|temporarily unavailable/i.test(message)) {
    return provider === 'gemini'
      ? 'Gemini đang quá tải tạm thời; hệ thống đã thử model Flash dự phòng.'
      : 'Nhà cung cấp đang quá tải tạm thời. Vui lòng thử lại sau.'
  }
  if (/quota|rate.?limit|exceeded your current/i.test(message)) {
    return provider === 'gemini'
      ? 'Gemini đã vượt quota hiện tại. Hãy kiểm tra hạn mức/billing hoặc chờ quota được làm mới.'
      : 'Nhà cung cấp AI đã vượt quota hiện tại. Hãy kiểm tra hạn mức/billing hoặc thử lại sau.'
  }
  if (statusCode === 401 || statusCode === 403 || /unauthorized|invalid api key|forbidden/i.test(message)) {
    return 'Nhà cung cấp từ chối khóa API. Hãy kiểm tra khóa và quyền truy cập của model.'
  }
  if (statusCode === 404) return 'Không tìm thấy model đã cấu hình ở nhà cung cấp.'
  if (statusCode === 429) return 'Nhà cung cấp đang giới hạn lượt gọi. Vui lòng thử lại sau.'
  if (process.env.NODE_ENV === 'development') {
    const name = typeof details.name === 'string' ? details.name : 'ProviderError'
    return `API AI chưa phản hồi (${name}): ${message}`
  }
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
  const { result, modelId } = await generateWithModelFallback(provider, 'single-prediction', (model) =>
    generateText({
      model,
      instructions:
        'Bạn phân tích dữ liệu xổ số cho mục đích tham khảo, không cam kết hay khẳng định kết quả. Hãy làm theo kịch bản được cung cấp và chỉ trả về đúng một chuỗi gồm 4 chữ số.',
      prompt: [
        `Ngày xổ số mục tiêu: ${targetDate}.`,
        `Có ${tails.length} kỳ gần nhất; đuôi 4 số giải đặc biệt, mới nhất trước: ${tails.join(', ')}.`,
        `Tên kịch bản: ${scenarioName}.`,
        `Nội dung kịch bản: ${scenarioPrompt}`,
        'Chỉ trả về một dãy 4 chữ số, không giải thích và không thêm dấu câu.',
      ].join('\n'),
      maxOutputTokens: 128,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(15_000),
    }),
  )
  const prediction = result.text.match(/\d{4}/)?.[0]
  if (!prediction) {
    const error = new Error('AI model returned no four-digit prediction')
    logProviderFailure('single-output-validation', provider, error)
    throw error
  }
  return { prediction, modelId }
}

export async function generateDailyBatchPredictions({
  provider,
  targetDate,
  tails,
  analysisContext,
  scenarios,
}: {
  provider: AiProvider
  targetDate: string
  tails: string[]
  analysisContext: DailyAnalysisContext
  scenarios: ScenarioPrompt[]
}) {
  const { result, modelId } = await generateWithModelFallback(provider, 'daily-batch', (model) =>
    generateText({
      model,
      output: Output.json(),
      instructions:
        'Bạn phân tích XSMB để tham khảo, không huấn luyện hay thay đổi trọng số mô hình. Hãy làm đầy đủ từng bước trong mỗi kịch bản bằng tiếng Việt, dùng số liệu cụ thể và % từ dữ liệu được cung cấp, không dùng placeholder. Trả về JSON đúng dạng {"reports":[{"scenarioId":"...","prediction":"0123","analysis":"báo cáo chi tiết"}]}. prediction là bộ 4 chữ số chính của kịch bản; analysis phải chứa phần tính toán và các phương án/rủi ro được yêu cầu. Gọi mọi tỷ lệ là tần suất hoặc điểm heuristic của mẫu ngắn, không khẳng định đó là xác suất trúng thật.',
      prompt: JSON.stringify({
        targetDate,
        recentSpecialTails: tails,
        analysisContext,
        scenarios: scenarios.map((scenario) => ({
          scenarioId: scenario.id,
          name: scenario.name,
          instructions: scenario.prompt,
        })),
      }),
      maxOutputTokens: 4096,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(20_000),
    }),
  )

  const output = result.output
  if (!isRecord(output) || !Array.isArray(output.reports)) {
    const error = new Error('AI model returned an invalid analysis batch')
    logProviderFailure('daily-output-validation', provider, error)
    throw error
  }

  const expectedIds = new Set(scenarios.map((scenario) => scenario.id))
  const reports = new Map<string, { prediction: string; analysis: string }>()

  for (const item of output.reports) {
    if (
      !isRecord(item) ||
      typeof item.scenarioId !== 'string' ||
      typeof item.prediction !== 'string' ||
      typeof item.analysis !== 'string'
    ) {
      const error = new Error('AI model returned an invalid scenario report')
      logProviderFailure('daily-output-validation', provider, error)
      throw error
    }
    if (!expectedIds.has(item.scenarioId) || !/^\d{4}$/.test(item.prediction) || item.analysis.trim().length < 80) {
      const error = new Error('AI model returned an incomplete or invalid scenario report')
      logProviderFailure('daily-output-validation', provider, error)
      throw error
    }
    reports.set(item.scenarioId, { prediction: item.prediction, analysis: item.analysis })
  }

  if (reports.size !== expectedIds.size) {
    const error = new Error('AI model did not return a report for every scenario')
    logProviderFailure('daily-output-validation', provider, error)
    throw error
  }

  return { reports, modelId }
}
