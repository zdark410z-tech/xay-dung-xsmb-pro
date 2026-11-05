'use client'

import { useState, type FormEvent } from 'react'
import { Plus, Save, Trash2 } from 'lucide-react'
import type { Scenario } from '@/lib/xsmb-types'

type Draft = {
  name: string
  prompt: string
  provider: 'gemini' | 'deepseek'
}

type Props = {
  scenarios: Scenario[]
  loading: boolean
  loadError?: string
  onChanged: () => Promise<void>
}

async function sendScenarioRequest(method: 'POST' | 'PATCH' | 'DELETE', body: Record<string, string>) {
  const response = await fetch('/api/scenarios', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error ?? 'Không thể lưu kịch bản.')
  return payload
}

function providerName(provider: string) {
  if (provider === 'gemini') return 'Gemini'
  if (provider === 'deepseek') return 'DeepSeek'
  return 'Công thức'
}

export function ScenarioPanel({ scenarios, loading, loadError, onChanged }: Props) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [newScenario, setNewScenario] = useState<Draft>({ name: '', prompt: '', provider: 'gemini' })
  const [savingId, setSavingId] = useState<string | null>(null)
  const [savingNew, setSavingNew] = useState(false)
  const [message, setMessage] = useState('')

  function getDraft(scenario: Scenario): Draft {
    return drafts[scenario.id] ?? {
      name: scenario.name,
      prompt: scenario.prompt,
      provider: scenario.provider === 'deepseek' ? 'deepseek' : 'gemini',
    }
  }

  function updateDraft(id: string, field: keyof Draft, value: string) {
    const scenario = scenarios.find((item) => item.id === id)
    if (!scenario) return
    setDrafts((current) => ({
      ...current,
      [id]: { ...getDraft(scenario), [field]: value } as Draft,
    }))
  }

  async function saveScenario(scenario: Scenario) {
    const draft = getDraft(scenario)
    setSavingId(scenario.id)
    setMessage('')
    try {
      await sendScenarioRequest('PATCH', { id: scenario.id, ...draft })
      await onChanged()
      setDrafts((current) => {
        const next = { ...current }
        delete next[scenario.id]
        return next
      })
      setMessage(`Đã lưu kịch bản “${draft.name}”.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể lưu kịch bản.')
    } finally {
      setSavingId(null)
    }
  }

  async function addScenario(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSavingNew(true)
    setMessage('')
    try {
      await sendScenarioRequest('POST', newScenario)
      setNewScenario({ name: '', prompt: '', provider: 'gemini' })
      await onChanged()
      setMessage('Đã thêm kịch bản mới. Kịch bản sẽ xuất hiện trong phần dự đoán và lịch sử đối chiếu.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể thêm kịch bản.')
    } finally {
      setSavingNew(false)
    }
  }

  async function removeScenario(scenario: Scenario) {
    if (savingId) return
    setSavingId(scenario.id)
    setMessage('')
    try {
      await sendScenarioRequest('DELETE', { id: scenario.id })
      await onChanged()
      setMessage(`Đã ẩn kịch bản “${scenario.name}”. Lịch sử dự đoán cũ vẫn được giữ.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể xóa kịch bản.')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <section className="content config" aria-labelledby="scenario-title">
      <div className="hero-line">
        <div>
          <p className="eyebrow">CẤU HÌNH HỆ THỐNG</p>
          <h2 id="scenario-title">Kịch bản & API</h2>
          <p className="section-intro">Thêm nhiều cách phân tích; mỗi kịch bản có thể chạy bằng Gemini hoặc DeepSeek.</p>
        </div>
      </div>

      <div className="config-panel">
        <div className="config-note" role="note">
          <span className="gateway-indicator" aria-hidden="true" />
          <div>
            <strong>Gemini và DeepSeek chạy phía máy chủ bằng khóa API riêng.</strong>
            <p>Thêm khóa trong Vars bảo mật của project; không dán khóa vào trang này, chat, hoặc mã nguồn.</p>
          </div>
        </div>

        <div className="config-note schedule-note" role="note">
          <span className="gateway-indicator" aria-hidden="true" />
          <div>
            <strong>Lịch dự kiến: 10:00 mỗi ngày, giờ Việt Nam.</strong>
            <p>Khi có đúng 6 kịch bản tùy chỉnh và CRON_SECRET, mỗi kịch bản sẽ được phân tích riêng bởi cả Gemini lẫn DeepSeek; 12 kết quả sẽ lưu vào lịch sử. Đây là suy luận hằng ngày, không phải huấn luyện lại mô hình.</p>
          </div>
        </div>

        <div className="scenario-section-heading">
          <div>
            <h3>Kịch bản đang dùng</h3>
            <p>Chỉnh lời nhắc AI, đổi mô hình hoặc ẩn kịch bản tự thêm.</p>
          </div>
          <span>{scenarios.length} kịch bản</span>
        </div>

        {loadError && <p className="inline-error" role="alert">{loadError}</p>}
        {loading && scenarios.length === 0 && <p className="empty-state" role="status">Đang tải kịch bản…</p>}
        {!loading && scenarios.length === 0 && !loadError && <p className="empty-state">Chưa có kịch bản nào.</p>}

        <div className="scenario-list">
          {scenarios.map((scenario) => {
            const draft = getDraft(scenario)
            const fixedFormula = scenario.provider === 'formula'
            const changed = draft.name !== scenario.name || draft.prompt !== scenario.prompt || draft.provider !== scenario.provider
            return (
              <article className="scenario-editor" key={scenario.id}>
                <div className="scenario-editor-heading">
                  <div className="scenario-number">{String(scenario.sortOrder + 1).padStart(2, '0')}</div>
                  <div>
                    <h4>{scenario.name}</h4>
                    <span className={`provider-badge ${scenario.provider}`}>{providerName(scenario.provider)}</span>
                  </div>
                  {scenario.isBuiltin && <span className="builtin-label">Mặc định</span>}
                </div>

                <div className="scenario-fields">
                  <label>
                    Tên kịch bản
                    <input
                      value={draft.name}
                      disabled={fixedFormula || savingId === scenario.id}
                      maxLength={80}
                      onChange={(event) => updateDraft(scenario.id, 'name', event.target.value)}
                    />
                  </label>
                  {fixedFormula ? (
                    <div className="scenario-static-field">
                      <span>Phương pháp</span>
                      <strong>Công thức nội bộ</strong>
                    </div>
                  ) : (
                    <label>
                      Mô hình AI
                      <select
                        value={draft.provider}
                        disabled={savingId === scenario.id}
                        onChange={(event) => updateDraft(scenario.id, 'provider', event.target.value)}
                      >
                        <option value="gemini">Gemini</option>
                        <option value="deepseek">DeepSeek</option>
                      </select>
                    </label>
                  )}
                  <label className="scenario-prompt-field">
                    {fixedFormula ? 'Quy tắc công thức' : 'Kịch bản phân tích'}
                    <textarea
                      value={draft.prompt}
                      disabled={fixedFormula || savingId === scenario.id}
                      maxLength={3000}
                      onChange={(event) => updateDraft(scenario.id, 'prompt', event.target.value)}
                    />
                  </label>
                </div>

                {fixedFormula ? (
                  <p className="scenario-footnote">Công thức mặc định được tính trực tiếp từ dữ liệu 10 kỳ gần nhất.</p>
                ) : (
                  <div className="scenario-actions">
                    <button className="save" onClick={() => saveScenario(scenario)} disabled={!changed || savingId === scenario.id}>
                      <Save aria-hidden="true" size={15} /> {savingId === scenario.id ? 'Đang lưu…' : 'Lưu kịch bản'}
                    </button>
                    {!scenario.isBuiltin && (
                      <button className="delete-scenario" onClick={() => removeScenario(scenario)} disabled={savingId === scenario.id}>
                        <Trash2 aria-hidden="true" size={15} /> Ẩn kịch bản
                      </button>
                    )}
                  </div>
                )}
              </article>
            )
          })}
        </div>

        <div className="scenario-section-heading add-heading">
          <div>
            <h3>Thêm kịch bản mới</h3>
            <p>Kịch bản mới sẽ có nút chạy riêng và một dòng đối chiếu trong lịch sử.</p>
          </div>
          <Plus aria-hidden="true" size={18} />
        </div>

        <form className="scenario-editor add-scenario-form" onSubmit={addScenario}>
          <div className="scenario-fields">
            <label>
              Tên kịch bản
              <input
                value={newScenario.name}
                maxLength={80}
                minLength={2}
                required
                placeholder="Ví dụ: Phân tích cặp số đảo"
                onChange={(event) => setNewScenario((current) => ({ ...current, name: event.target.value }))}
              />
            </label>
            <label>
              Mô hình AI
              <select
                value={newScenario.provider}
                onChange={(event) => setNewScenario((current) => ({ ...current, provider: event.target.value as Draft['provider'] }))}
              >
                <option value="gemini">Gemini</option>
                <option value="deepseek">DeepSeek</option>
              </select>
            </label>
            <label className="scenario-prompt-field">
              Nội dung kịch bản
              <textarea
                value={newScenario.prompt}
                maxLength={3000}
                minLength={8}
                required
                placeholder="Mô tả dữ liệu cần xem xét, quy tắc phân tích và định dạng đầu ra mong muốn…"
                onChange={(event) => setNewScenario((current) => ({ ...current, prompt: event.target.value }))}
              />
            </label>
          </div>
          <button className="save" type="submit" disabled={savingNew}>
            <Plus aria-hidden="true" size={15} /> {savingNew ? 'Đang thêm…' : 'Thêm kịch bản'}
          </button>
        </form>

        <p className="scenario-message" role="status" aria-live="polite">{message}</p>
      </div>
    </section>
  )
}
