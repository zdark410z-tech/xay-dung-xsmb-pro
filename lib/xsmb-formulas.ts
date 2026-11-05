export function frequencyPrediction(values: string[], rank = 0) {
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

export function formulaPrediction(scenarioId: string, tails: string[]) {
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
