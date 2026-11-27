'use client'

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { BarChart3, ClipboardList, Settings, WandSparkles } from 'lucide-react'
import { HistoryPanel } from '@/components/history-panel'
import { PredictionPanel } from '@/components/prediction-panel'
import { ScenarioPanel } from '@/components/scenario-panel'
import type { BacktestResult } from '@/lib/xsmb-backtest'
import type { Scenario, ScenarioProvider, XsmbHistoryResponse } from '@/lib/xsmb-types'

type Props = {
  todayDate: string
  initialTargetDate: string
  aiPredictionsEnabled: boolean
}

type ScenarioResponse = { scenarios: Scenario[] }
type PredictionResponse = { prediction: string; provider?: ScenarioProvider; persisted?: boolean; saved?: boolean; alreadySaved?: boolean }
type Tab = 'history' | 'predict' | 'config'

async function fetcher<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error ?? 'Không thể tải dữ liệu.')
  return payload as T
}

function formatVietnamDate(date: string) {
  const [year, month, day] = date.split('-')
  return year && month && day ? `${day}.${month}.${year}` : date
}

export default function XsmbApp({ todayDate, initialTargetDate, aiPredictionsEnabled }: Props) {
  const [tab, setTab] = useState<Tab>('history')
  const [targetDate, setTargetDate] = useState(initialTargetDate)
  const [syncing, setSyncing] = useState(false)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [message, setMessage] = useState('Chọn ngày mục tiêu và kịch bản để lưu dự đoán vào lịch sử.')
  const [optimisticResults, setOptimisticResults] = useState<Record<string, Record<string, string>>>({})
  const [optimisticProviders, setOptimisticProviders] = useState<Record<string, Record<string, ScenarioProvider>>>({})

  const {
    data: historyData,
    error: historyError,
    isLoading: historyLoading,
    mutate: mutateHistory,
  } = useSWR<XsmbHistoryResponse>('/api/xsmb', fetcher, { revalidateOnFocus: false })
  const {
    data: scenarioData,
    error: scenarioError,
    isLoading: scenariosLoading,
    mutate: mutateScenarios,
  } = useSWR<ScenarioResponse>('/api/scenarios', fetcher, { revalidateOnFocus: false })
  const {
    data: backtestData,
    error: backtestError,
    isLoading: backtestLoading,
  } = useSWR<BacktestResult>(tab === 'history' ? '/api/backtest' : null, fetcher, { revalidateOnFocus: false })

  const draws = historyData?.draws ?? []
  const activeScenarios = scenarioData?.scenarios ?? []
  const predictionScenarios = useMemo(() => {
    if (aiPredictionsEnabled) return activeScenarios
    const visibleFormulaIds = new Set(['c1', 'c2', 'c3', 'kb7', 'kb8', 'kb9', 'kb10', 'kb11', 'kb12', 'kb13'])
    return activeScenarios.filter((scenario) => scenario.provider === 'formula' && visibleFormulaIds.has(scenario.id))
  }, [activeScenarios, aiPredictionsEnabled])
  const historyScenarios = useMemo(() => {
    const sources = new Map<string, Scenario>()
    activeScenarios.forEach((scenario) => sources.set(scenario.id, scenario))

    draws.forEach((draw) => {
      Object.entries(draw.predictionMeta).forEach(([id, meta]) => {
        if (!sources.has(id)) {
          sources.set(id, {
            id,
            name: meta.name,
            provider: meta.provider,
            modelId: null,
            prompt: '',
            sortOrder: Number.MAX_SAFE_INTEGER,
            isBuiltin: false,
            isActive: false,
          })
        }
      })
    })

    return [...sources.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'vi'))
  }, [activeScenarios, draws])

  const historyForTarget = draws.find((draw) => draw.date === targetDate)
  const results = { ...historyForTarget?.predictions, ...optimisticResults[targetDate] }
  const resultProviders = {
    ...Object.fromEntries(Object.entries(historyForTarget?.predictionMeta ?? {}).map(([id, meta]) => [id, meta.provider])),
    ...optimisticProviders[targetDate],
  }

  async function syncHistory() {
    setSyncing(true)
    try {
      await mutateHistory()
    } finally {
      setSyncing(false)
    }
  }

  async function runScenario(scenario: Scenario) {
    if (runningId || results[scenario.id]) return
    setRunningId(scenario.id)
    setMessage(`${scenario.name} đang phân tích dữ liệu…`)

    try {
      const response = await fetch('/api/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId: scenario.id, targetDate }),
        signal: AbortSignal.timeout(43_000),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error ?? 'Không thể tạo dự đoán.')

      const result = payload as PredictionResponse
      if (result.persisted !== true) throw new Error(`${scenario.name}: máy chủ chưa xác nhận dữ liệu đã lưu trong cơ sở dữ liệu.`)
      const actualProvider = result.provider ?? scenario.provider
      const providerNames: Record<ScenarioProvider, string> = {
        formula: 'công thức nội bộ',
        gemini: 'Gemini',
        deepseek: 'DeepSeek',
        groq: 'Groq',
      }
      const providerNote = actualProvider !== scenario.provider
        ? ` (đã chuyển sang ${providerNames[actualProvider]} vì nhà cung cấp chính gặp lỗi)`
        : ` (${providerNames[actualProvider]})`
      setOptimisticResults((current) => ({
        ...current,
        [targetDate]: { ...current[targetDate], [scenario.id]: result.prediction },
      }))
      setOptimisticProviders((current) => ({
        ...current,
        [targetDate]: { ...current[targetDate], [scenario.id]: actualProvider },
      }))
      setMessage(
        result.alreadySaved
          ? `${scenario.name}: đã có dự đoán ${result.prediction} cho ngày ${formatVietnamDate(targetDate)} (${providerNames[actualProvider]}).`
          : `Đã lưu ${scenario.name}: ${result.prediction} cho ngày ${formatVietnamDate(targetDate)}${providerNote}.`,
      )
      void mutateHistory()
    } catch (error) {
      const detail = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
        ? 'AI phản hồi quá lâu. Vui lòng thử lại sau.'
        : error instanceof Error
          ? error.message
          : 'Không thể tạo dự đoán.'
      setMessage(detail.startsWith(`${scenario.name}:`) ? detail : `${scenario.name}: ${detail}`)
    } finally {
      setRunningId(null)
    }
  }

  async function refreshScenarios() {
    await Promise.all([mutateScenarios(), mutateHistory()])
  }

  const syncError = historyData?.syncError ?? null
  const scenarioLoadError = scenarioError instanceof Error ? scenarioError.message : undefined
  const historyLoadError = historyError instanceof Error ? historyError.message : undefined

  return (
    <main className="app-shell">
      <header className="brand">
        <div className="brand-mark" aria-hidden="true">M</div>
        <div>
          <h1>MINH NGỌC <span>PRO</span></h1>
          <p>Nghiên cứu & dự đoán Xổ số Miền Bắc</p>
        </div>
        <div className="header-date">
          <span>NGÀY PHÂN TÍCH</span>
          <strong>{formatVietnamDate(todayDate)}</strong>
        </div>
      </header>

      <nav className="tabs" aria-label="Điều hướng">
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')} aria-current={tab === 'history' ? 'page' : undefined}>
          <ClipboardList aria-hidden="true" size={17} /> Lịch sử & đối chiếu
        </button>
        <button className={tab === 'predict' ? 'active' : ''} onClick={() => { setTab('predict'); void mutateHistory() }} aria-current={tab === 'predict' ? 'page' : undefined}>
          <WandSparkles aria-hidden="true" size={17} /> Dự đoán & tính toán
        </button>
        <button className={tab === 'config' ? 'active' : ''} onClick={() => setTab('config')} aria-current={tab === 'config' ? 'page' : undefined}>
          <Settings aria-hidden="true" size={17} /> Kịch bản & API
        </button>
      </nav>

      {tab === 'history' && (
        <HistoryPanel
          draws={draws}
          scenarios={historyScenarios}
          loading={historyLoading}
          syncing={syncing}
          syncedAt={historyData?.syncedAt ?? null}
          syncError={syncError}
          loadError={historyLoadError}
          backtest={backtestData}
          aiCommentary={historyData?.aiCommentary}
          backtestLoading={backtestLoading}
          backtestError={backtestError instanceof Error ? backtestError.message : undefined}
          onSync={syncHistory}
        />
      )}
      {tab === 'predict' && (
        <PredictionPanel
          scenarios={predictionScenarios}
          draws={draws}
          targetDate={targetDate}
          todayDate={todayDate}
          results={results}
          resultProviders={resultProviders}
          runningId={runningId}
          message={message}
          onTargetDateChange={(date) => {
            setTargetDate(date)
            void mutateHistory()
          }}
          onRun={runScenario}
        />
      )}
      {tab === 'config' && (
        <ScenarioPanel
          scenarios={activeScenarios}
          loading={scenariosLoading}
          loadError={scenarioLoadError}
          onChanged={refreshScenarios}
        />
      )}

      <footer className="app-footer">
        <BarChart3 aria-hidden="true" size={14} />
        Lịch sử lưu trên Neon; khóa AI không được gửi xuống trình duyệt.
      </footer>
    </main>
  )
}
