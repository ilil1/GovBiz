import { useEffect, useRef, useState } from 'react'
import { getEvaluationLogs, OpsApiError, type EvaluationLogs } from '../../../data/ops/opsApi'
import { workspacePageStyles as styles } from '../../shared/workspace/WorkspacePage.styles'

const levelName = (level: number) => level >= 40 ? '오류' : level >= 30 ? '주의' : '진행'

export function EvaluationLogsPanel({ runId, flowId, onExpired }: { runId: string; flowId: string; onExpired: () => void }) {
  const [query, setQuery] = useState<{ offset: number } | null>(null)
  const [data, setData] = useState<EvaluationLogs | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const expiry = useRef(onExpired); expiry.current = onExpired
  useEffect(() => {
    if (!query) return
    const controller = new AbortController()
    setBusy(true); setData(null); setError('')
    void getEvaluationLogs(runId, flowId, query.offset, controller.signal).then((value) => {
      if (!controller.signal.aborted) setData(value)
    }).catch((reason: unknown) => {
      if (controller.signal.aborted) return
      if (reason instanceof OpsApiError && (reason.status === 401 || reason.status === 403)) expiry.current()
      else setError(reason instanceof Error ? reason.message : '기록을 가져오지 못했습니다.')
    }).finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => controller.abort()
  }, [runId, flowId, query])

  return <section className="grid min-w-0 gap-3" aria-label="실행 기록">
    <h3 className="text-sm font-semibold">실행 기록</h3>
    <button type="button" className={`${styles.secondaryButton} min-h-11 !text-sm self-start`} disabled={busy} onClick={() => setQuery({ offset: 0 })}>
      {query ? '기록 새로고침' : '기록 불러오기'}
    </button>
    {busy && <p role="status" className="text-sm text-ink-muted">기록을 불러오고 있습니다.</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {data && <>
      {data.results.length === 0 ? <p role="status" className="text-sm text-ink-muted">저장된 기록이 없습니다.</p>
        : <><p className="text-sm text-ink-muted">최신 기록부터 보여줘요.</p>
        <ol aria-label="실행 기록 목록" className="max-h-[32rem] space-y-2 overflow-auto text-sm">
          {data.results.map((log) => <li key={log.id}>
            <details className="group/log min-w-0 rounded-xl border border-line bg-white">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary [&::-webkit-details-marker]:hidden">
                <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1"><span className={log.level >= 40 ? 'text-red-700' : log.level >= 30 ? 'text-amber-800' : 'text-ink'}>{levelName(log.level)}</span>
                <time className="font-normal text-ink-muted" dateTime={log.timestamp}>{new Date(log.timestamp).toLocaleString('ko-KR')}</time></span>
                <span aria-hidden="true" className="shrink-0 text-xs text-brand-primary"><span className="group-open/log:hidden">펼치기 +</span><span className="hidden group-open/log:inline">접기 −</span></span>
              </summary>
              <div className="min-w-0 border-t border-line p-4"><pre className="whitespace-pre-wrap break-words font-mono [overflow-wrap:anywhere]">{log.message}</pre><p className="mt-2 break-all text-xs text-ink-muted">기록 출처: {log.name}</p></div>
            </details>
          </li>)}
        </ol></>}
      <div className="flex flex-wrap items-center gap-3">
        {data.offset > 0 && <button type="button" className={`${styles.secondaryButton} min-h-11 !text-sm`} disabled={busy} onClick={() => setQuery({ offset: Math.max(0, data.offset - 100) })}>최신 기록 쪽으로</button>}
        {data.next_offset !== null && <button type="button" className={`${styles.secondaryButton} min-h-11 !text-sm`} disabled={busy} onClick={() => setQuery({ offset: data.next_offset! })}>더 오래된 기록</button>}
      </div>
    </>}
  </section>
}
