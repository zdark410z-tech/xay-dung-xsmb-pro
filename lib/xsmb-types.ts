export type ScenarioProvider = 'formula' | 'gemini' | 'deepseek' | 'groq'

export type Scenario = {
  id: string
  name: string
  provider: ScenarioProvider
  modelId: string | null
  prompt: string
  sortOrder: number
  isBuiltin: boolean
  isActive: boolean
}

export type PredictionMeta = {
  name: string
  provider: ScenarioProvider
}

export type XsmbAiReport = {
  name: string
  provider: Extract<ScenarioProvider, 'gemini' | 'deepseek' | 'groq'>
  modelId: string
  prediction: string
  analysis: string
}

export type XsmbDraw = {
  date: string
  day: string
  special: string
  tail: string
  prizes: string[][]
  predictions: Record<string, string>
  predictionMeta: Record<string, PredictionMeta>
  reports: Record<string, XsmbAiReport>
}

export type XsmbAiCommentary = {
  targetDate: string
  analysis: string
  provider: ScenarioProvider
  modelId: string
}

export type XsmbHistoryResponse = {
  draws: XsmbDraw[]
  count: number
  syncedAt: string | null
  syncError: string | null
  aiCommentary?: XsmbAiCommentary | null
}
