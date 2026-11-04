import { NextResponse } from 'next/server'

type Draw = { date: string; day: string; special: string; tail: string; prizes: string[][]; predictions: Record<string, string> }

const SOURCE_URL = 'https://www.minhngoc.net.vn/ket-qua-xo-so/mien-bac.html'
const DAYS: Record<string, string> = { 'Chủ nhật': 'CN', 'Thứ hai': 'T2', 'Thứ ba': 'T3', 'Thứ tư': 'T4', 'Thứ năm': 'T5', 'Thứ sáu': 'T6', 'Thứ bảy': 'T7' }

function clean(value: string) {
  return value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
}

function parseSource(html: string): Draw[] {
  const draws: Draw[] = []
  const headings = [...html.matchAll(/class=["']title["'][^>]*>[\s\S]{0,180}?KẾT QUẢ XỔ SỐ[\s\S]{0,180}?(\d{2}\/\d{2}\/\d{4})/gi)]

  headings.forEach((heading, index) => {
    const date = heading[1]
    const section = html.slice(heading.index ?? 0, headings[index + 1]?.index ?? html.length)
    const header = clean(section.slice(0, 500))
    const day = Object.entries(DAYS).find(([name]) => header.includes(name))?.[1] ?? ''
    const table = section.match(/<table[\s\S]*?<\/table>/i)?.[0] ?? ''
    const prizes: string[][] = []
    for (const row of table.matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
      const rowText = clean(row[0])
      if (!/Giải/i.test(rowText)) continue
      const cells = [...row[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => clean(cell[1]))
      if (cells.length < 2) continue
      const numbers = cells.slice(1).join(' ').match(/\b\d{2,5}\b/g) ?? []
      if (numbers.length) prizes.push(numbers)
    }
    if (prizes.length < 8) return
    const special = prizes[0][0]
    draws.push({ date, day, special, tail: special.slice(-4), prizes: prizes.slice(0, 8), predictions: {} })
  })

  return draws.filter((draw, index, list) => list.findIndex((item) => item.date === draw.date) === index)
}

export async function GET() {
  try {
    const response = await fetch(`${SOURCE_URL}?sync=${Date.now()}`, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; XSMB research sync)' }, cache: 'no-store' })
    if (!response.ok) throw new Error(`Minh Ngọc trả về ${response.status}`)
    const draws = parseSource(await response.text())
    return NextResponse.json({ source: SOURCE_URL, syncedAt: new Date().toISOString(), count: draws.length, draws })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Không thể đồng bộ dữ liệu Minh Ngọc' }, { status: 502 })
  }
}
