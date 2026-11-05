import { BarChart3, ChevronDown } from 'lucide-react'
import type { Scenario, XsmbDraw } from '@/lib/xsmb-types'

type Props = {
  draws: XsmbDraw[]
  scenarios: Scenario[]
  loading: boolean
  syncing: boolean
  syncedAt: string | null
  syncError: string | null
  loadError?: string
  onSync: () => void
}

function formatDate(date: string) {
  const [year, month, day] = date.split('-')
  return year && month && day ? `${day}/${month}/${year}` : date
}

function accuracy(scenarioId: string, draws: XsmbDraw[]) {
  const comparable = draws.filter(
    (draw) => /^\d{4}$/.test(draw.tail) && /^\d{4}$/.test(draw.predictions[scenarioId] ?? ''),
  )
  const hit = comparable.reduce((total, draw) => {
    return total + [...draw.predictions[scenarioId]].filter((digit, index) => digit === draw.tail[index]).length
  }, 0)
  const total = comparable.length * 4
  return { hit, total, percent: total ? ((hit / total) * 100).toFixed(1) : '—' }
}

function providerLabel(scenario: Scenario) {
  if (scenario.provider === 'gemini') return 'Gemini'
  if (scenario.provider === 'deepseek') return 'DeepSeek'
  return 'Công thức'
}

export function HistoryPanel({
  draws,
  scenarios,
  loading,
  syncing,
  syncedAt,
  syncError,
  loadError,
  onSync,
}: Props) {
  const actualDraws = draws.filter((draw) => /^\d{4}$/.test(draw.tail))
  const status = loadError
    ? loadError
    : syncError
      ? `Chưa đồng bộ được dữ liệu mới; đang hiển thị bản đã lưu (${syncError})`
      : syncedAt
        ? `Cập nhật lúc ${new Date(syncedAt).toLocaleTimeString('vi-VN')} · ${draws[0] ? formatDate(draws[0].date) : 'chưa có kết quả mới'}`
        : 'Đang tải dữ liệu lịch sử'

  return (
    <section className="content" aria-labelledby="history-title">
      <div className="hero-line">
        <div>
          <p className="eyebrow">TỔNG QUAN HIỆU SUẤT</p>
          <h2 id="history-title">Lịch sử & đối chiếu</h2>
          <p className="section-intro">Dự đoán được lưu theo ngày; kết quả sẽ tự đối chiếu khi có kỳ xổ số.</p>
        </div>
        <div className="history-actions">
          <span className={`live ${syncError || loadError ? 'sync-error' : ''}`} role="status">
            <i aria-hidden="true" /> {status}
          </span>
          <button className="sync-button" onClick={onSync} disabled={syncing}>
            {syncing ? 'Đang đồng bộ…' : 'Đồng bộ ngay'}
          </button>
        </div>
      </div>

      {scenarios.length > 0 && (
        <div className="summary-grid" aria-label="Hiệu suất theo kịch bản">
          {scenarios.map((scenario) => {
            const stat = accuracy(scenario.id, draws)
            const color = scenario.provider === 'formula'
              ? scenario.id === 'c2' ? 'green' : scenario.id === 'c3' ? 'blue' : 'red'
              : scenario.provider === 'deepseek' ? 'cyan' : 'purple'

            return (
              <article className={`stat-card ${color}`} key={scenario.id}>
                <div className="stat-head">
                  <span>{scenario.name}</span>
                  <BarChart3 aria-hidden="true" size={16} />
                </div>
                <strong>{stat.percent}<small>{stat.percent === '—' ? '' : '%'}</small></strong>
                <p>{stat.hit} / {stat.total} chữ số khớp</p>
                <div
                  className="progress"
                  role="progressbar"
                  aria-label={`Tỷ lệ khớp ${stat.percent}${stat.percent === '—' ? '' : '%'}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={stat.total ? Number(stat.percent) : 0}
                >
                  <i style={{ width: `${stat.total ? stat.percent : 0}%` }} />
                </div>
              </article>
            )
          })}
        </div>
      )}

      <div className="section-label">
        <span>KẾT QUẢ & DỰ ĐOÁN</span>
        <b>HIỂN THỊ CHI TIẾT <ChevronDown aria-hidden="true" size={15} /></b>
      </div>

      {loading && draws.length === 0 && <p className="empty-state" role="status">Đang tải lịch sử…</p>}
      {!loading && draws.length === 0 && (
        <p className="empty-state" role="status">
          {loadError ?? 'Chưa có dữ liệu. Hãy đồng bộ kết quả hoặc tạo dự đoán cho ngày sắp tới.'}
        </p>
      )}

      {draws.map((draw) => {
        const hasResult = /^\d{4}$/.test(draw.tail)
        return (
          <article className="draw-card" key={draw.date}>
            <div className="draw-header">
              <div>
                <strong>{formatDate(draw.date)}</strong>
                {draw.day && <span>{draw.day}</span>}
                {!hasResult && <span className="waiting-badge">CHỜ KẾT QUẢ</span>}
              </div>
              <div className="special">
                {hasResult ? (
                  <>
                    GIẢI ĐẶC BIỆT <b>{draw.special}</b><em>Đuôi {draw.tail}</em>
                  </>
                ) : (
                  <span className="target-date-label">Ngày dự đoán</span>
                )}
              </div>
            </div>

            {hasResult && draw.prizes.length > 0 && (
              <div className="prizes">
                {draw.prizes.map((prize, index) => (
                  <div className="prize-row" key={`${draw.date}-${index}`}>
                    <label>Giải {index === 0 ? 'ĐB' : index}</label>
                    <div>
                      {prize.map((number, numberIndex) => (
                        <span key={`${number}-${numberIndex}`} className={index === 0 ? 'big-number' : ''}>
                          {number}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="comparison" aria-label={`Dự đoán ngày ${formatDate(draw.date)}`}>
              {scenarios.map((scenario) => {
                const prediction = draw.predictions[scenario.id] ?? ''
                const digits = prediction || '----'
                const matches = hasResult && prediction
                  ? [...prediction].filter((digit, index) => digit === draw.tail[index]).length
                  : null

                return (
                  <div className="comparison-row" key={`${draw.date}-${scenario.id}`}>
                    <b>
                      {scenario.name}
                      <small>{providerLabel(scenario)}</small>
                    </b>
                    <div aria-label={`${scenario.name}: ${prediction || 'chưa có dự đoán'}`}>
                      {[...digits].map((digit, index) => {
                        const matched = hasResult && Boolean(prediction) && digit === draw.tail[index]
                        return (
                          <i className={matched ? 'match' : ''} key={`${scenario.id}-${index}`}>
                            {prediction ? digit : '—'}
                          </i>
                        )
                      })}
                    </div>
                    <small>{matches === null ? 'Chưa có' : `${matches}/4 khớp`}</small>
                  </div>
                )
              })}
              {scenarios.length === 0 && <p className="no-scenarios">Chưa có kịch bản để đối chiếu.</p>}
            </div>
          </article>
        )
      })}

      <p className="disclaimer">
        Dữ liệu tham khảo từ minhngoc.net. Xổ số mang tính ngẫu nhiên; các dự đoán chỉ phục vụ nghiên cứu, không đảm bảo kết quả.
        {actualDraws.length > 0 && ` Đang lưu ${actualDraws.length} ngày có kết quả.`}
      </p>
    </section>
  )
}
