import { FORMULA_SCENARIOS, positionRulePrediction, type FormulaScenarioId, type PositionDraw } from '@/lib/xsmb-position-rules'

export const BACKTEST_FREEZE_DATE = '2026-11-27'

export type BacktestWindow = 'all' | '90' | '30' | 'before-freeze' | 'after-freeze'

export type BacktestPositionMetric = {
  hits: number
  rate: number | null
  expectedRate: number | null
  pValue: number | 'mẫu nhỏ'
}

export type BacktestScenarioMetric = {
  scenarioId: FormulaScenarioId
  name: string
  n: number
  positions: [BacktestPositionMetric, BacktestPositionMetric, BacktestPositionMetric, BacktestPositionMetric]
  totalHits: number
  expectedTotalHits: number
  fullHits: number
  expectedFullHits: number
}

export type BacktestResult = {
  freezeDate: string
  todayDate: string
  groups: Record<BacktestWindow, BacktestScenarioMetric[]>
}

type EvaluatedDraw = {
  date: string
  candidates: [string[], string[], string[], string[]]
  tail: string
}

function dateDaysAgo(date: string, days: number) {
  const result = new Date(`${date}T00:00:00.000Z`)
  result.setUTCDate(result.getUTCDate() - days)
  return result.toISOString().slice(0, 10)
}

function normalCdf(value: number) {
  const absolute = Math.abs(value) / Math.sqrt(2)
  const t = 1 / (1 + 0.3275911 * absolute)
  const polynomial = (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t
  const erf = 1 - polynomial * Math.exp(-absolute * absolute)
  return value >= 0 ? (1 + erf) / 2 : (1 - erf) / 2
}

function metricFor(scenarioId: FormulaScenarioId, name: string, rows: EvaluatedDraw[]): BacktestScenarioMetric {
  const n = rows.length
  const hits = [0, 0, 0, 0]
  const expected = [0, 0, 0, 0]
  const variances = [0, 0, 0, 0]
  let fullHits = 0
  let expectedFullHits = 0

  rows.forEach((row) => {
    let fullMatch = true
    let fullChance = 1
    row.candidates.forEach((digits, index) => {
      const probability = digits.length / 10
      expected[index] += probability
      variances[index] += probability * (1 - probability)
      const matches = digits.includes(row.tail[index])
      if (matches) hits[index] += 1
      else fullMatch = false
      fullChance *= probability
    })
    if (fullMatch) fullHits += 1
    expectedFullHits += fullChance
  })

  const positions = hits.map((hit, index) => {
    const variance = variances[index]
    const z = n >= 50 && variance > 0 ? (hit - expected[index] - 0.5) / Math.sqrt(variance) : 0
    return {
      hits: hit,
      rate: n ? hit / n : null,
      expectedRate: n ? expected[index] / n : null,
      pValue: n >= 50 ? Math.max(0, Math.min(1, 1 - normalCdf(z))) : 'mẫu nhỏ',
    }
  }) as BacktestScenarioMetric['positions']

  return {
    scenarioId,
    name,
    n,
    positions,
    totalHits: hits.reduce((sum, hit) => sum + hit, 0),
    expectedTotalHits: expected.reduce((sum, value) => sum + value, 0),
    fullHits,
    expectedFullHits,
  }
}

export function calculateBacktest(
  sourceDraws: PositionDraw[],
  todayDate: string,
  freezeDate: string,
): BacktestResult {
  const draws = sourceDraws
    .filter((draw) => /^\d{4}$/.test(draw.tail))
    .sort((left, right) => left.date.localeCompare(right.date))
  const evaluated = new Map<FormulaScenarioId, EvaluatedDraw[]>()
  for (const scenario of FORMULA_SCENARIOS) evaluated.set(scenario.id, [])

  for (const draw of draws) {
    const priorDraws = draws.filter((prior) => prior.date < draw.date)
    for (const scenario of FORMULA_SCENARIOS) {
      const result = positionRulePrediction(scenario.id, draw.date, priorDraws)
      if (result) evaluated.get(scenario.id)?.push({ date: draw.date, candidates: result.candidates, tail: draw.tail })
    }
  }

  const cutoff30 = dateDaysAgo(todayDate, 29)
  const cutoff90 = dateDaysAgo(todayDate, 89)
  const windows: Array<[BacktestWindow, (row: EvaluatedDraw) => boolean]> = [
    ['all', () => true],
    ['30', (row) => row.date >= cutoff30],
    ['90', (row) => row.date >= cutoff90],
    ['before-freeze', (row) => row.date < freezeDate],
    ['after-freeze', (row) => row.date >= freezeDate],
  ]

  const groups = Object.fromEntries(windows.map(([window, predicate]) => [
    window,
    FORMULA_SCENARIOS.map((scenario) => metricFor(
      scenario.id,
      scenario.name,
      (evaluated.get(scenario.id) ?? []).filter(predicate),
    )),
  ])) as BacktestResult['groups']

  return { freezeDate, todayDate, groups }
}
