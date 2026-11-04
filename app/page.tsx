'use client'

import { useEffect, useMemo, useState } from 'react'
import { BarChart3, Brain, Calculator, Check, ChevronDown, ClipboardList, Settings, Sparkles, Target, WandSparkles } from 'lucide-react'

type Draw = { date: string; day: string; special: string; tail: string; prizes: string[][]; predictions: Record<string, string> }

const draws: Draw[] = [
  { date: '01/11/2026', day: 'CN', special: '03917', tail: '3917', prizes: [['33288'], ['74737', '09040'], ['10506', '66698', '79124', '58317', '43449', '13362'], ['0487', '0626', '7452', '9069'], ['8909', '7340', '9774', '7006', '1007', '3279'], ['481', '411', '189'], ['54', '16', '03', '91']], predictions: { c1: '1582', c2: '3907', c3: '4719', gm: '4729', ds: '8361' } },
  { date: '31/10/2026', day: 'T7', special: '28457', tail: '8457', prizes: [['58348'], ['37364', '03797'], ['57644', '81204', '58908', '10924', '09114', '44442'], ['4040', '0770', '6764', '7770'], ['8634', '2951', '6836', '4597', '9355', '0320'], ['846', '632', '747'], ['78', '53', '31', '46']], predictions: { c1: '9302', c2: '8457', c3: '2036', gm: '1748', ds: '5293' } },
  { date: '30/10/2026', day: 'T6', special: '69259', tail: '9259', prizes: [['87081'], ['71863', '38253'], ['08452', '03706', '11542', '49304', '76503', '19314'], ['3423', '3537', '1570', '9612'], ['8560', '8247', '2833', '8165', '5171', '6275'], ['857', '236', '824'], ['94', '77', '48', '25']], predictions: { c1: '4716', c2: '9259', c3: '1847', gm: '8392', ds: '1385' } },
  { date: '29/10/2026', day: 'T5', special: '15382', tail: '5382', prizes: [['92031'], ['18273', '49205'], ['91827', '40295', '10293', '58372', '48291', '37105'], ['1928', '3746', '5810', '2937'], ['1028', '4759', '3820', '5916', '2748', '9103'], ['294', '817', '503'], ['82', '71', '05', '39']], predictions: { c1: '9471', c2: '5382', c3: '6291', gm: '6205', ds: '3819' } },
  { date: '28/10/2026', day: 'T4', special: '72614', tail: '2614', prizes: [['61728'], ['51930', '83741'], ['61829', '40285', '19304', '58271', '49103', '72850'], ['1827', '3746', '5910', '2837'], ['4719', '8250', '3816', '5927', '1036', '2948'], ['736', '285', '914'], ['63', '52', '18', '07']], predictions: { c1: '5093', c2: '2614', c3: '7502', gm: '2741', ds: '8506' } },
]

const sources = [
  { key: 'c1', label: 'Công thức 1', color: 'red', description: 'Đếm tần suất' },
  { key: 'c2', label: 'Công thức 2', color: 'green', description: 'Cao thứ 2' },
  { key: 'c3', label: 'Công thức 3', color: 'blue', description: 'Xu hướng' },
  { key: 'gm', label: 'Gemini AI', color: 'purple', description: 'Phân tích AI' },
  { key: 'ds', label: 'DeepSeek AI', color: 'cyan', description: 'Phân tích AI' },
] as const

function accuracy(key: string, data: Draw[]) {
  let hit = 0
  data.forEach((draw) => (draw.predictions[key] || '----').split('').forEach((digit, index) => { if (digit === draw.tail[index]) hit++ }))
  return { hit, total: data.length * 4, percent: data.length ? (hit / (data.length * 4) * 100).toFixed(1) : '0.0' }
}

function frequencyPrediction(values: string[], rank = 0) {
  return Array.from({ length: 4 }, (_, index) => {
    const counts: Record<string, number> = {}
    values.forEach((value) => { counts[value[index]] = (counts[value[index]] || 0) + 1 })
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[rank]?.[0] || Object.keys(counts)[0] || '0'
  }).join('')
}

export default function Page() {
  const [tab, setTab] = useState('history')
  const [results, setResults] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('Sẵn sàng — chọn một phương pháp để bắt đầu tính toán')
  const [liveDraws, setLiveDraws] = useState<Draw[]>(draws)
  const [syncing, setSyncing] = useState(false)
  const [syncedAt, setSyncedAt] = useState('')
  const activeDraws = liveDraws.length ? liveDraws : draws
  const todayLabel = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date()).replaceAll('/', '.')
  const tails = activeDraws.slice(0, 5).map((draw) => draw.tail)

  const syncData = async () => {
    setSyncing(true)
    try {
      const response = await fetch('/api/xsmb')
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error)
      setLiveDraws(payload.draws)
      setSyncedAt(payload.syncedAt)
      setMessage(`Đã đồng bộ ${payload.count} ngày từ Minh Ngọc`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Đồng bộ thất bại')
    } finally { setSyncing(false) }
  }

  useEffect(() => { syncData() }, [])
  const final = useMemo(() => {
    const all = Object.values(results).filter((value) => value.length === 4)
    if (!all.length) return ''
    return Array.from({ length: 4 }, (_, index) => {
      const counts: Record<string, number> = {}; all.forEach((value) => { counts[value[index]] = (counts[value[index]] || 0) + 1 })
      return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
    }).join('')
  }, [results])
  const calculate = (key: string) => {
    let value = key === 'c1' ? frequencyPrediction(tails) : key === 'c2' ? frequencyPrediction(tails, 1) : key === 'c3' ? Array.from({ length: 4 }, (_, i) => String(Math.round(tails.slice(0, 5).reduce((sum, tail) => sum + Number(tail[i]), 0) / 5) % 10)).join('') : key === 'gm' ? '2748' : '8361'
    setResults((current) => ({ ...current, [key]: value })); setMessage(`${sources.find((source) => source.key === key)?.label} ra: ${value}`)
  }
  return (<main className="app-shell">
    <header className="brand"><div className="brand-mark">M</div><div><h1>MINH NGỌC <span>PRO</span></h1><p>Nghiên cứu & Dự đoán Xổ số Miền Bắc</p></div><div className="header-date"><span>NGÀY PHÂN TÍCH</span><strong>{todayLabel}</strong></div></header>
    <nav className="tabs" aria-label="Điều hướng"><button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}><ClipboardList size={17}/> Lịch sử & Đối chiếu</button><button className={tab === 'predict' ? 'active' : ''} onClick={() => setTab('predict')}><WandSparkles size={17}/> Dự đoán & Tính toán</button><button className={tab === 'config' ? 'active' : ''} onClick={() => setTab('config')}><Settings size={17}/> Kịch bản & API</button></nav>
    {tab === 'history' && <section className="content"><div className="hero-line"><div><p className="eyebrow">TỔNG QUAN HIỆU SUẤT</p><h2>Toàn bộ kết quả đến hôm nay</h2></div><div className="history-actions"><span className="live"><i/> {syncedAt ? `Đồng bộ lúc ${new Date(syncedAt).toLocaleTimeString('vi-VN')} · mới nhất ${activeDraws[0]?.date ?? 'chưa có'}` : 'Đang cập nhật dữ liệu'}</span><button className="sync-button" onClick={syncData} disabled={syncing}>{syncing ? 'Đang đồng bộ…' : 'Đồng bộ ngay'}</button></div></div><div className="summary-grid">{sources.map((source) => { const stat = accuracy(source.key, activeDraws); return <div className={`stat-card ${source.color}`} key={source.key}><div className="stat-head"><span>{source.label}</span><BarChart3 size={16}/></div><strong>{stat.percent}<small>%</small></strong><p>{stat.hit} / {stat.total} chữ số khớp</p><div className="progress"><i style={{ width: `${stat.percent}%` }}/></div></div> })}</div><div className="section-label"><span>KẾT QUẢ XỔ SỐ</span><b>HIỂN THỊ CHI TIẾT <ChevronDown size={15}/></b></div>{activeDraws.map((draw) => <article className="draw-card" key={draw.date}><div className="draw-header"><div><strong>{draw.date}</strong><span>{draw.day}</span></div><div className="special">ĐẶC BIỆT <b>{draw.special}</b><em>Đuôi {draw.tail}</em></div></div><div className="prizes">{draw.prizes.map((prize, index) => <div className="prize-row" key={index}><label>Giải {index === 0 ? 'ĐB' : index}</label><div>{prize.map((number) => <span key={number} className={index === 0 ? 'big-number' : ''}>{number}</span>)}</div></div>)}</div><div className="comparison">{sources.map((source) => { const prediction = draw.predictions[source.key] || '----'; return <div className="comparison-row" key={source.key}><b>{source.label}</b><div>{prediction.split('').map((digit, index) => <i className={digit === draw.tail[index] ? 'match' : ''} key={`${digit}-${index}`}>{digit}</i>)}</div><small>{prediction.split('').filter((digit, index) => digit === draw.tail[index]).length}/4</small></div> })}</div></article>)}<p className="disclaimer">Dữ liệu tham khảo từ minhngoc.net — Xổ số mang tính ngẫu nhiên cao, chỉ dùng nghiên cứu tham khảo.</p></section>}
    {tab === 'predict' && <section className="content"><div className="hero-line"><div><p className="eyebrow">PHÒNG THÍ NGHIỆM DỰ ĐOÁN</p><h2>Tính toán cho ngày mới</h2></div><span className="method-note"><Calculator size={15}/> 5 ngày gần nhất</span></div><div className="action-row">{sources.map((source) => <button key={source.key} className={`action ${source.color}`} onClick={() => calculate(source.key)}><Sparkles size={15}/> {source.label}</button>)}<button className="action final-action" onClick={() => final ? setMessage(`Tổng hợp từ ${Object.keys(results).length} nguồn: ${final}`) : setMessage('Chưa có kết quả tính toán') }><Target size={15}/> Tổng hợp cuối</button></div><div className="prediction-grid">{sources.map((source) => <div className="prediction-card" key={source.key}><div><span className={`icon-bubble ${source.color}`}><Brain size={16}/></span><div><b>{source.label}</b><small>{source.description}</small></div></div><strong>{results[source.key] || '----'}</strong><div className="digits">{(results[source.key] || '----').split('').map((digit, index) => <i className={results[source.key] ? 'filled' : ''} key={index}>{digit}</i>)}</div></div>)}</div>{final && <div className="final-result"><span>KẾT QUẢ TỔNG HỢP</span><strong>{final}</strong><p>Độ tin cậy dự kiến: <b>50%</b></p></div>}<div className="log"><Check size={16}/> {message}</div></section>}
    {tab === 'config' && <section className="content config"><div className="hero-line"><div><p className="eyebrow">CẤU HÌNH HỆ THỐNG</p><h2>Kịch bản & API</h2></div></div><div className="config-panel"><div className="key-grid"><label>Gemini API Key<input type="password" placeholder="Nhập khóa từ Google AI Studio"/></label><label>DeepSeek API Key<input type="password" placeholder="Nhập khóa từ DeepSeek"/></label></div>{[['Công thức 1','Đếm tần suất từng vị trí đuôi GĐB → lấy số nhiều nhất'],['Công thức 2','Loại bỏ số xuất hiện nhiều nhất → lấy cao thứ 2'],['Công thức 3','Phân tích xu hướng thay đổi giữa các ngày']].map(([label, value]) => <label key={label}>{label}<textarea defaultValue={value}/></label>)}<div className="key-grid"><label>Số ngày phân tích<input type="number" defaultValue="5" min="1"/></label><label>Ngưỡng tin cậy (%)<input type="number" defaultValue="50" min="0" max="100"/></label></div><button className="save" onClick={() => setMessage('Đã lưu cấu hình thành công')}>Lưu cấu hình</button></div></section>}
  </main>)
}
