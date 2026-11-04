import { NextResponse } from 'next/server'

type Draw = { date: string; day: string; special: string; tail: string; prizes: string[][]; predictions: Record<string, string> }

const SOURCE_URL = 'https://www.minhngoc.net.vn/ket-qua-xo-so/mien-bac.html'
const DAYS: Record<string, string> = { 'Chủ nhật': 'CN', 'Thứ hai': 'T2', 'Thứ ba': 'T3', 'Thứ tư': 'T4', 'Thứ năm': 'T5', 'Thứ sáu': 'T6', 'Thứ bảy': 'T7' }

function clean(value: string) {
  return value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
}

function parseSource(html: string): Draw[] {
  const draws: Draw[] = []
  const sections = html.split(/KẾT QUẢ XỔ SỐ\s+Miền Bắc\s*-\s*/i).slice(1)
  for (const section of sections) {
    const dateMatch = section.match(/(\d{2}\/\d{2}\/\d{4})/)
    if (!dateMatch) continue
    const date = dateMatch[1]
    const header = clean(section.slice(0, section.indexOf('</table>') > -1 ? section.indexOf('</table>') : 300))
    const day = Object.entries(DAYS).find(([name]) => header.includes(name))?.[1] ?? ''
    const table = section.match(/<table[\s\S]*?<\/table>/i)?.[0] ?? section.slice(0, 6000)
    const prizes: string[][] = []
    for (const row of table.matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
      const cells = [...row[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => clean(cell[1]))
      if (cells.length < 2) continue
      const numbers = cells.slice(1).join(' ').match(/\b\d{2,5}\b/g) ?? []
      if (numbers.length) prizes.push(numbers)
    }
    if (prizes.length < 8) continue
    const special = prizes[0][0]
    draws.push({ date, day, special, tail: special.slice(-4), prizes: prizes.slice(0, 8), predictions: {} })
  }
  return draws.filter((draw, index, list) => list.findIndex((item) => item.date === draw.date) === index)
}

export async function GET() {
  try {
    const response = await fetch(SOURCE_URL, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; XSMB research sync)' }, next: { revalidate: 3600 } })
    if (!response.ok) throw new Error(`Minh Ngọc trả về ${response.status}`)
    const draws = parseSource(await response.text())
    return NextResponse.json({ source: SOURCE_URL, syncedAt: new Date().toISOString(), count: draws.length, draws })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Không thể đồng bộ dữ liệu Minh Ngọc' }, { status: 502 })
  }
}
