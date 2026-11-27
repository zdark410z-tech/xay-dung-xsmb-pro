export type PositionDraw = {
  date: string
  tail: string
  prizes: string[][]
}

export type PositionCandidates = [string[], string[], string[], string[]]

export type PositionRuleResult = {
  candidates: PositionCandidates
  prediction: string
}

export const FORMULA_SCENARIOS = [
  { id: 'kb7', name: 'Đối chiếu giải hôm trước', prompt: 'Nghìn lấy đầu/cuối G2 theo ngày lẻ/chẵn, rồi chữ số 3 G4 số 3 và chữ số 2 G4 số 4; trăm lấy cuối G4 số 3; chục lấy giữa G6 số 3; đơn vị lấy đầu G5 số 5 của kỳ trước.' },
  { id: 'kb8', name: 'Xoay vòng ĐB', prompt: 'Xoay tail giải đặc biệt của kỳ trước sang trái một chữ số.' },
  { id: 'kb9', name: 'Đuôi giải nhất', prompt: 'Dùng 4 chữ số cuối của giải nhất kỳ trước.' },
  { id: 'kb10', name: 'Tổng mod 10', prompt: 'Lấy tổng chữ số cuối G7, G6 và tổng giá trị số G4, G2 của kỳ trước, mỗi tổng lấy mod 10 theo vị trí.' },
  { id: 'kb11', name: 'Đối chứng lệch ngày', prompt: 'Áp dụng quy tắc Đối chiếu giải hôm trước cho kỳ D-2; chỉ tính khi kỳ D-1 cũng tồn tại.' },
  { id: 'kb12', name: 'Đối chứng ngẫu nhiên', prompt: 'Sinh 4 chữ số giả ngẫu nhiên xác định theo seed ngày đích và kb12.' },
  { id: 'kb13', name: 'Đối chứng lặp hôm qua', prompt: 'Lặp lại tail giải đặc biệt của kỳ trước.' },
] as const

export type FormulaScenarioId = (typeof FORMULA_SCENARIOS)[number]['id']

function dateOffset(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function uniqueDigits(digits: string[]) {
  return digits.filter((digit, index) => /^\d$/.test(digit) && digits.indexOf(digit) === index)
}

function positionsFromYesterday(draw: PositionDraw): PositionCandidates | null {
  const { prizes } = draw
  if (!/^\d{4}$/.test(draw.tail)) return null
  if (!prizes[5]?.[4] || !prizes[6]?.[2] || !prizes[4]?.[2] || !prizes[4]?.[3] || !prizes[2]?.[0] || !prizes[2]?.[1]) return null

  const selectedG2 = Number(draw.date.slice(-2)) % 2 === 1 ? prizes[2][0] : prizes[2][1]
  const thousands = [selectedG2[0], selectedG2.at(-1) ?? '', prizes[4][2][2] ?? '', prizes[4][3][1] ?? '']
  const hundreds = prizes[4][2].at(-1) ?? ''
  const tens = prizes[6][2][1] ?? ''
  const units = prizes[5][4][0] ?? ''
  if (![...thousands, hundreds, tens, units].every((digit) => /^\d$/.test(digit))) return null

  return [uniqueDigits(thousands), [hundreds], [tens], [units]]
}

function seededDigits(seed: string): string[] {
  let state = 2166136261
  for (const character of seed) {
    state ^= character.charCodeAt(0)
    state = Math.imul(state, 16777619)
  }

  return Array.from({ length: 4 }, () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    const random = ((value ^ (value >>> 14)) >>> 0) / 4294967296
    return String(Math.floor(random * 10))
  })
}

export function positionRulePrediction(
  scenarioId: string,
  targetDate: string,
  draws: PositionDraw[],
): PositionRuleResult | null {
  const byDate = new Map(draws.map((draw) => [draw.date, draw]))
  const yesterday = byDate.get(dateOffset(targetDate, -1))
  let candidates: PositionCandidates | null = null

  if (scenarioId === 'kb12') {
    candidates = seededDigits(`${targetDate}|kb12`).map((digit) => [digit]) as PositionCandidates
  } else if (scenarioId === 'kb11') {
    if (!yesterday) return null
    const twoDaysAgo = byDate.get(dateOffset(targetDate, -2))
    if (!twoDaysAgo) return null
    candidates = positionsFromYesterday(twoDaysAgo)
  } else {
    if (!yesterday) return null
    if (scenarioId === 'kb7') candidates = positionsFromYesterday(yesterday)
    if (scenarioId === 'kb8') {
      if (!/^\d{4}$/.test(yesterday.tail)) return null
      const rotated = `${yesterday.tail.slice(1)}${yesterday.tail[0]}`
      candidates = [...rotated].map((digit) => [digit]) as PositionCandidates
    }
    if (scenarioId === 'kb9') {
      const firstPrize = yesterday.prizes[1]?.[0]
      const tail = firstPrize?.slice(-4) ?? ''
      if (!/^\d{4}$/.test(tail)) return null
      candidates = [...tail].map((digit) => [digit]) as PositionCandidates
    }
    if (scenarioId === 'kb10') {
      const { prizes } = yesterday
      if (!prizes[2] || prizes[2].length < 2 || !prizes[3] || prizes[3].length < 6 || !prizes[4] || prizes[4].length < 4 || !prizes[5] || prizes[5].length < 6 || !prizes[6] || prizes[6].length < 3 || !prizes[7] || prizes[7].length < 4) return null
      const sumLastDigits = (values: string[]) => values.reduce((sum, value) => sum + Number(value.at(-1)), 0) % 10
      const sumNumbers = (values: string[]) => values.reduce((sum, value) => sum + Number(value), 0) % 10
      candidates = [
        [String(sumNumbers(prizes[2].slice(0, 2)))],
        [String(sumNumbers(prizes[4].slice(0, 4)))],
        [String(sumLastDigits(prizes[6].slice(0, 3)))],
        [String(sumLastDigits(prizes[7].slice(0, 4)))],
      ]
    }
    if (scenarioId === 'kb13') {
      if (!/^\d{4}$/.test(yesterday.tail)) return null
      candidates = [...yesterday.tail].map((digit) => [digit]) as PositionCandidates
    }
  }

  if (!candidates) return null
  return { candidates, prediction: candidates.map((position) => position[0]).join('') }
}
