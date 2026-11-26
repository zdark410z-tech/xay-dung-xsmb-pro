import { createDeepSeek } from '@ai-sdk/deepseek'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createGroq } from '@ai-sdk/groq'
import { generateText } from 'ai'
import type { ScenarioProvider } from '@/lib/xsmb-types'

export type AiProvider = Extract<ScenarioProvider, 'gemini' | 'deepseek' | 'groq'>

export const AI_MODELS = {
  gemini: 'gemini-3.8-flash',
  deepseek: 'deepseek-flash',
  groq: 'openai/gpt-oss-20b',
} as const

const GEMINI_FALLBACK_MODEL = 'gemini-3.5-flash'
const PROVIDER_FAILOVER_ORDER: AiProvider[] = ['groq', 'deepseek', 'gemini']

type ProviderFailure = { provider: AiProvider; error: unknown }

export class AllProvidersFailedError extends Error {
  constructor(readonly failures: ProviderFailure[]) {
    super('All configured AI providers failed')
    this.name = 'AllProvidersFailedError'
  }
}

export class MissingProviderApiKeyError extends Error {
  constructor(readonly provider: AiProvider) {
    super('A provider API key is not configured')
    this.name = 'MissingProviderApiKeyError'
  }
}

class InvalidPredictionOutputError extends Error {
  constructor() {
    super('AI model returned no four-digit prediction')
    this.name = 'InvalidPredictionOutputError'
  }
}

function createModel(provider: AiProvider, modelId: string = AI_MODELS[provider]) {
  if (provider === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY
    if (!apiKey) throw new MissingProviderApiKeyError(provider)
    return createGoogleGenerativeAI({ apiKey })(modelId)
  }

  if (provider === 'groq') {
    const apiKey = process.env.GROQ_API_KEY
    if (!apiKey) throw new MissingProviderApiKeyError(provider)
    return createGroq({ apiKey })(modelId)
  }

  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) throw new MissingProviderApiKeyError(provider)
  return createDeepSeek({ apiKey })(modelId)
}

type DirectModel = ReturnType<typeof createModel>

function isTemporaryModelOverload(error: unknown) {
  const statusCode = isRecord(error) && typeof error.statusCode === 'number' ? error.statusCode : null
  const message = safeErrorMessage(error)
  if (statusCode === 429 || /quota|resource[_\s-]?exhausted|rate.?limit|daily limit/i.test(message)) return false
  return statusCode === 503 || /currently experiencing high demand|temporarily unavailable|overloaded/i.test(message)
}

async function generateWithModelFallback<T>(
  provider: AiProvider,
  operation: string,
  run: (model: DirectModel) => Promise<T>,
) {
  const modelIds: string[] = provider === 'gemini'
    ? [AI_MODELS.gemini, GEMINI_FALLBACK_MODEL]
    : [AI_MODELS[provider]]

  for (let index = 0; index < modelIds.length; index += 1) {
    const modelId = modelIds[index]
    try {
      return { result: await run(createModel(provider, modelId)), modelId }
    } catch (error) {
      const hasFallback = index < modelIds.length - 1
      const invalidPredictionOutput = error instanceof InvalidPredictionOutputError
      if (hasFallback && (isTemporaryModelOverload(error) || invalidPredictionOutput)) {
        console.warn('[v0] Gemini primary model failed; switching to fallback', {
          reason: invalidPredictionOutput ? 'invalid output' : 'temporary provider overload',
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

function isProviderFallbackEligible(error: unknown) {
  if (error instanceof MissingProviderApiKeyError || error instanceof InvalidPredictionOutputError) return true

  const statusCode = isRecord(error) && typeof error.statusCode === 'number' ? error.statusCode : null
  const message = safeErrorMessage(error)
  const isRequestTimeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
  return statusCode === 401 || statusCode === 402 || statusCode === 403 || statusCode === 404 ||
    statusCode === 429 || (statusCode !== null && statusCode >= 500) || isRequestTimeout ||
    /timeout|timed out|aborted|fetch failed|network error|econnreset|eai_again|enotfound|econnrefused|socket hang up|quota|resource[_\s-]?exhausted|rate.?limit|daily limit|too many requests|insufficient balance|low balance|balance is not enough|temporarily unavailable|overloaded|high demand/i.test(message)
}

function providerFallbackSequence(primary: AiProvider, unavailableProviders?: Set<AiProvider>) {
  return [primary, ...PROVIDER_FAILOVER_ORDER.filter((provider) => provider !== primary)]
    .filter((provider) => !unavailableProviders?.has(provider))
}

function isQuotaOrRateLimitError(error: unknown) {
  const statusCode = isRecord(error) && typeof error.statusCode === 'number' ? error.statusCode : null
  return statusCode === 429 || /quota|resource[_\s-]?exhausted|rate.?limit|daily limit|too many requests/i.test(safeErrorMessage(error))
}

async function generateWithProviderFallback<T>(
  primaryProvider: AiProvider,
  operation: string,
  run: (provider: AiProvider) => Promise<{ result: T; modelId: string }>,
  unavailableProviders?: Set<AiProvider>,
) {
  const providers = providerFallbackSequence(primaryProvider, unavailableProviders)
  const failures: ProviderFailure[] = []

  if (providers.length === 0) {
    throw new Error('All AI providers are temporarily unavailable for this run')
  }

  for (let index = 0; index < providers.length; index += 1) {
    const provider = providers[index]
    try {
      return { ...(await run(provider)), provider }
    } catch (error) {
      failures.push({ provider, error })
      if (unavailableProviders && isQuotaOrRateLimitError(error)) unavailableProviders.add(provider)
      const nextProvider = providers[index + 1]
      if (!nextProvider || !isProviderFallbackEligible(error)) {
        if (failures.length === 1) throw error
        throw new AllProvidersFailedError(failures)
      }

      console.warn('[v0] AI provider unavailable; switching to fallback', {
        operation,
        provider,
        nextProvider,
        statusCode: isRecord(error) && typeof error.statusCode === 'number' ? error.statusCode : null,
      })
    }
  }

  throw new AllProvidersFailedError(failures)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function extractPrediction(text: string) {
  const normalized = text.trim().replace(/^```[a-z0-9_-]*\s*/i, '').replace(/\s*```$/, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(normalized)
  } catch {
    parsed = null
  }

  if (isRecord(parsed) && typeof parsed.prediction === 'string' && /^\d{4}$/.test(parsed.prediction)) {
    return parsed.prediction
  }

  const labeledPrediction = normalized.match(
    /(?:prediction|predicted(?:\s+number)?|dự đoán|số chính|số được chọn)\s*(?:(?:is|là)\s*)?[:：=-]?\s*["'`]?(\d{4})/i,
  )
  if (labeledPrediction) return labeledPrediction[1]

  const candidates = [...new Set(normalized.match(/(?<!\d)\d{4}(?!\d)/g) ?? [])]
  return candidates.length === 1 ? candidates[0] : null
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

function providerDisplayName(provider: AiProvider) {
  if (provider === 'gemini') return 'Gemini'
  if (provider === 'groq') return 'Groq'
  return 'DeepSeek'
}

export function getAiFailureMessage(error: unknown, provider?: AiProvider): string {
  if (error instanceof AllProvidersFailedError) {
    if (error.failures.length === 0) {
      return 'Các nhà cung cấp AI đã bị tạm dừng do giới hạn quota trong lần chạy này.'
    }
    const attemptedProviders = error.failures.map(({ provider: failedProvider }) => providerDisplayName(failedProvider)).join(' → ')
    const lastFailure = error.failures[error.failures.length - 1]
    return `Đã thử ${attemptedProviders} nhưng không nhà cung cấp nào phản hồi được. ${lastFailure ? getAiFailureMessage(lastFailure.error, lastFailure.provider) : 'Vui lòng thử lại sau.'}`
  }

  if (error instanceof MissingProviderApiKeyError) {
    if (error.provider === 'gemini') return 'Chưa cấu hình GEMINI_API_KEY trong Vars của project.'
    if (error.provider === 'groq') return 'Chưa cấu hình GROQ_API_KEY trong Vars của project.'
    return 'Chưa cấu hình DEEPSEEK_API_KEY trong Vars của project.'
  }

  const details = isRecord(error) ? error : {}
  const statusCode = typeof details.statusCode === 'number' ? details.statusCode : null
  const message = safeErrorMessage(error)
  if (/insufficient balance|low balance|balance is not enough/i.test(message)) {
    return provider === 'groq'
      ? 'Groq đang giới hạn lượt gọi hoặc tài khoản không đủ điều kiện. Hãy kiểm tra giới hạn tại GroqCloud.'
      : 'DeepSeek báo số dư API không đủ. Hãy nạp số dư hoặc kiểm tra billing của tài khoản DeepSeek.'
  }
  if (/high demand|overloaded|temporarily unavailable/i.test(message)) {
    return provider === 'gemini'
      ? 'Gemini đang quá tải tạm thời; hệ thống đã thử model Flash dự phòng.'
      : 'Nhà cung cấp đang quá tải tạm thời. Vui lòng thử lại sau.'
  }
  if (/quota|resource[_\s-]?exhausted|rate.?limit|exceeded your current|limit exceeded|daily limit/i.test(message)) {
    return provider === 'gemini'
      ? 'Gemini đã vượt quota hiện tại. Hãy kiểm tra hạn mức/billing hoặc chờ quota được làm mới.'
      : 'Nhà cung cấp AI đã vượt quota hiện tại. Hãy kiểm tra hạn mức/billing hoặc thử lại sau.'
  }
  if (statusCode === 401 || statusCode === 403 || /unauthorized|invalid api key|forbidden/i.test(message)) {
    return 'Nhà cung cấp từ chối khóa API. Hãy kiểm tra khóa và quyền truy cập của model.'
  }
  if (/no object generated|could not parse the response/i.test(message)) {
    return `${provider === 'gemini' ? 'Gemini' : 'Mô hình AI'} đã phản hồi nhưng định dạng không đọc được. Hãy thử lại hoặc đổi model.`
  }
  if (/AI model returned (no four-digit prediction|invalid prediction json)/i.test(message)) {
    return `${provider === 'gemini' ? 'Gemini' : 'Mô hình AI'} đã phản hồi nhưng không trả về đúng định dạng 4 chữ số. Hãy thử lại hoặc đổi kịch bản.`
  }
  if (statusCode === 404) return 'Không tìm thấy model đã cấu hình ở nhà cung cấp.'
  if (statusCode === 429) return 'Nhà cung cấp đang giới hạn lượt gọi. Vui lòng chờ quota được làm mới hoặc kiểm tra billing.'
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
  unavailableProviders,
}: {
  provider: AiProvider
  targetDate: string
  tails: string[]
  scenarioName: string
  scenarioPrompt: string
  unavailableProviders?: Set<AiProvider>
}) {
  const usesUnavailableContext = /methodPerformance|currentMethodPredictions|prizes/i.test(scenarioPrompt)
  const safeScenarioPrompt = usesUnavailableContext
    ? 'Dựa trên 10 đuôi giải đặc biệt gần nhất được cung cấp, xem xét tần suất và xu hướng theo từng vị trí. Chọn một bộ số tham khảo theo phương pháp của kịch bản, không đánh giá bằng hiệu suất cũ hoặc dự đoán của phương pháp khác.'
    : scenarioPrompt.replace(/analysisContext\.draws/gi, '10 kỳ GĐB gần nhất được cung cấp')

  const generated = await generateWithProviderFallback(provider, 'single-prediction', (activeProvider) =>
    generateWithModelFallback(activeProvider, 'single-prediction', async (model) => {
      const result = await generateText({
        model,
        instructions:
          'Bạn phân tích dữ liệu xổ số cho mục đích tham khảo, không cam kết hay khẳng định kết quả. Dùng kịch bản làm phương pháp chọn số, nhưng bỏ qua yêu cầu phân tích dài hoặc liệt kê nhiều bộ số. Chỉ trả về duy nhất một chuỗi gồm đúng 4 chữ số ASCII, không JSON, không giải thích, không dấu câu.',
        prompt: [
          `Ngày xổ số mục tiêu: ${targetDate}.`,
          `Có ${tails.length} kỳ gần nhất; đuôi 4 số giải đặc biệt, mới nhất trước: ${tails.join(', ')}.`,
          `Tên kịch bản: ${scenarioName}.`,
          `Phương pháp chọn số (chỉ dùng làm tiêu chí, không làm theo yêu cầu về độ dài/định dạng đầu ra): ${safeScenarioPrompt}`,
          'Đầu ra duy nhất: một chuỗi 4 chữ số.',
        ].join('\n'),
        maxOutputTokens: 128,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(10_000),
      })
      const prediction = extractPrediction(result.text)
      if (!prediction) throw new InvalidPredictionOutputError()
      return { prediction }
    }),
    unavailableProviders,
  )
  return {
    prediction: generated.result.prediction,
    modelId: generated.modelId,
    provider: generated.provider,
  }

}
