'use client'

import { useState } from 'react'
import { Brain, Calculator, Sparkles, Target } from 'lucide-react'
import type { Scenario, XsmbDraw } from '@/lib/xsmb-types'

type Props = {
  scenarios: Scenario[]
  draws: XsmbDraw[]
  targetDate: string
  todayDate: string
  results: Record<string, string>
  runningId: string | null
  message: string
  onTargetDateChange: (date: string) => void
  onRun: (scenario: Scenario) => void
}

function formatDate(date: string) {
  const [year, month, day] = date.split('-')
  return year && month && day ? `${day}/${month}/${year}` : date
}

function colorFor(scenario: Scenario) {
  if (scenario.provider === 'formula') {
    return scenario.id === 'c2' ? 'green' : scenario.id === 'c3' ? 'blue' : 'red'
  }
  if (scenario.provider === 'groq') return 'green'
  return scenario.provider === 'deepseek' ? 'cyan' : 'purple'
}

function modelLabel(scenario: Scenario) {
  if (scenario.provider === 'gemini') return 'Gemini API · server-side'
  if (scenario.provider === 'deepseek') return 'DeepSeek API · server-side'
  if (scenario.provider === 'groq') return 'Groq API · server-side'
  return 'Công thức nội bộ'
}

export function PredictionPanel({
  scenarios,
  draws,
  targetDate,
  todayDate,
  results,
  runningId,
  message,
  onTargetDateChange,
  onRun,
}: Props) {
  const [showFinal, setShowFinal] = useState(false)
  const recentCount = draws.filter((draw) => /^\d{4}$/.test(draw.tail)).length
  const values = Object.values(results).filter((value) => /^\d{4}$/.test(value))
  const finalPrediction = values.length
    ? Array.from({ length: 4 }, (_, index) => {
        const counts: Record<string, number> = {}
        values.forEach((value) => { counts[value[index]] = (counts[value[index]] || 0) + 1 })
        return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '0'
      }).join('')
    : ''

  return (
    <section className="content" aria-labelledby="prediction-title">
      <div className="hero-line">
        <div>
          <p className="eyebrow">PHÒNG THÍ NGHIỆM DỰ ĐOÁN</p>
          <h2 id="prediction-title">Tính toán cho ngày mới</h2>
        </div>
        <span className="method-note"><Calculator aria-hidden="true" size={15} /> {Math.min(recentCount, 10)} kỳ gần nhất</span>
      </div>

      <div className="prediction-controls">
        <label htmlFor="target-date">Ngày xổ số mục tiêu</label>
        <input
          id="target-date"
          type="date"
          value={targetDate}
          min={todayDate}
          onChange={(event) => onTargetDateChange(event.target.value)}
        />
        <p>Ngày dự đoán: {formatDate(targetDate)}. Mỗi kịch bản chỉ lưu dự đoán đầu tiên trong ngày để giữ lịch sử đối chiếu chính xác.</p>
      </div>

      <div className="action-row">
        {scenarios.map((scenario) => {
          const saved = Boolean(results[scenario.id])
          const running = runningId === scenario.id
          return (
            <button
              key={scenario.id}
              className={`action ${colorFor(scenario)}`}
              onClick={() => onRun(scenario)}
              disabled={Boolean(runningId) || saved || recentCount === 0}
              aria-label={`${saved ? 'Đã lưu' : running ? 'Đang phân tích' : 'Chạy'} ${scenario.name} cho ${formatDate(targetDate)}`}
            >
              <Sparkles aria-hidden="true" size={15} />
              {running ? 'Đang phân tích…' : saved ? `${scenario.name} · Đã lưu` : scenario.name}
            </button>
          )
        })}
        <button
          className="action final-action"
          onClick={() => setShowFinal((current) => !current)}
          disabled={values.length === 0}
        >
          <Target aria-hidden="true" size={15} /> Tổng hợp cuối
        </button>
      </div>

      {scenarios.length === 0 && <p className="empty-state">Chưa có kịch bản hoạt động. Thêm kịch bản trong mục Kịch bản & API.</p>}
      {recentCount === 0 && <p className="empty-state">Cần đồng bộ dữ liệu kết quả trước khi tính toán.</p>}

      <div className="prediction-grid">
        {scenarios.map((scenario) => {
          const color = colorFor(scenario)
          const prediction = results[scenario.id] ?? ''
          return (
            <article className="prediction-card" key={scenario.id}>
              <div>
                <span className={`icon-bubble ${color}`}><Brain aria-hidden="true" size={16} /></span>
                <div>
                  <b>{scenario.name}</b>
                  <small>{modelLabel(scenario)}</small>
                </div>
              </div>
              <strong>{prediction || '----'}</strong>
              <div className="digits" aria-label={prediction ? `Kết quả ${prediction}` : 'Chưa có dự đoán'}>
                {[...(prediction || '----')].map((digit, index) => (
                  <i className={prediction ? 'filled' : ''} key={`${scenario.id}-${index}`}>
                    {prediction ? digit : '—'}
                  </i>
                ))}
              </div>
            </article>
          )
        })}
      </div>

      {showFinal && finalPrediction && (
        <div className="final-result" role="status">
          <span>KẾT QUẢ TỔNG HỢP</span>
          <strong>{finalPrediction}</strong>
          <p>Được tổng hợp từ {values.length} dự đoán đã lưu cho ngày {formatDate(targetDate)}.</p>
        </div>
      )}

      <div className="log" role="status">
        <Sparkles aria-hidden="true" size={16} /> {message}
      </div>
      <p className="disclaimer">Dự đoán chỉ mang tính tham khảo; không có mô hình nào đảm bảo kết quả xổ số.</p>
    </section>
  )
}
