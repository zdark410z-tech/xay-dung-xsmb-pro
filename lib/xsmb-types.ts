export type ScenarioProvider = 'formula' | 'gemini' | 'deepseek'

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

export type XsmbDraw = {
  date: string
  day: string
  special: string
  tail: string
  prizes: string[][]
  predictions: Record<string, string>
  predictionMeta: Record<string, PredictionMeta>
}

export type XsmbHistoryResponse = {
  draws: XsmbDraw[]
  count: number
  syncedAt: string | null
  syncError: string | null
}
