import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { workspacePageStyles as styles } from '../../shared/workspace/WorkspacePage.styles'
import { EvaluationHelp } from './EvaluationHelp'
import { useMonitoringDemo } from './MonitoringDemoContext'
import { createMonitoringRequest, MonitoringResponseError, monitoringFailureMessage, requireMonitoringResponse } from './monitoringRequest'

const count = z.number().int().nonnegative()
const jobSchema = z.object({
  feature: z.enum(['APPLICATION_DISCOVERY', 'APPLICATION_DOCUMENT', 'COMBINATION_REVIEW']),
  total: count, queued: count, running: count, succeeded: count, failed: count,
  interrupted: count, unknown: count, durationSamples: count,
  averageDurationMs: z.number().finite().nonnegative().nullable(),
}).refine((row) => row.total === row.queued + row.running + row.succeeded + row.failed + row.interrupted + row.unknown
  && row.durationSamples <= row.total && (row.durationSamples > 0 || row.averageDurationMs === null))
const responseSchema = z.object({
  from: z.iso.date(), to: z.iso.date(), scope: z.literal('stored-ai-jobs'), features: z.array(jobSchema),
}).refine((value) => new Set(value.features.map((row) => row.feature)).size === value.features.length)
type Result = z.infer<typeof responseSchema>
export type JobMetricsSummary =
  | { status: 'loading' | 'error' | 'empty' }
  | { status: 'ready'; succeeded: number; failed: number; from: string; to: string }

const labels: Record<Result['features'][number]['feature'], string> = {
  APPLICATION_DISCOVERY: '신청 양식 찾기',
  APPLICATION_DOCUMENT: '신청 문서 만들기',
  COMBINATION_REVIEW: '중복 지원 검토',
}
const duration = (ms: number | null) => ms === null ? '기록 없음' : `${(ms / 1000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}초`

/** 접수 응답과 실제 작업 결과를 구분해 보여줍니다. */
export function JobMetricsPanel({ onExpired, onSummaryChange, detailPage = false }: { onExpired: () => void; onSummaryChange?: (summary: JobMetricsSummary) => void; detailPage?: boolean }) {
  const { isExample, monitoringFetch } = useMonitoringDemo()
  const [detailOpen, setDetailOpen] = useState(detailPage)
  const [days, setDays] = useState('7')
  const [revision, setRevision] = useState(0)
  const [data, setData] = useState<Result | null>(null)
  const [error, setError] = useState('')
  const expiry = useRef(onExpired); expiry.current = onExpired
  const report = useRef(onSummaryChange); report.current = onSummaryChange
  const totals = data?.features.reduce((acc, row) => ({
    total: acc.total + row.total,
    succeeded: acc.succeeded + row.succeeded,
    active: acc.active + row.queued + row.running,
    attention: acc.attention + row.failed + row.interrupted + row.unknown,
  }), { total: 0, succeeded: 0, active: 0, attention: 0 })

  useEffect(() => {
    const request = createMonitoringRequest()
    const now = new Date()
    const utcToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    const to = new Date(utcToday).toISOString().slice(0, 10)
    const from = new Date(utcToday - (Number(days) - 1) * 86_400_000).toISOString().slice(0, 10)
    const query = new URLSearchParams({ from, to })
    setData(null); setError(''); report.current?.({ status: 'loading' })
    monitoringFetch(`/api/v1/admin/ai-request-metrics/jobs?${query}`, {
      credentials: 'same-origin', cache: 'no-store', signal: request.signal,
    }).then(async (response) => {
      if (response.status === 401 || response.status === 403) { expiry.current(); return }
      requireMonitoringResponse(response)
      const parsed = responseSchema.safeParse(await response.json().catch(() => { throw new MonitoringResponseError('invalid') }))
      if (!parsed.success || parsed.data.from !== from || parsed.data.to !== to) throw new MonitoringResponseError('invalid')
      if (request.isActive()) {
        setData(parsed.data)
        const total = parsed.data.features.reduce((sum, row) => sum + row.total, 0)
        const succeeded = parsed.data.features.reduce((sum, row) => sum + row.succeeded, 0)
        const failed = parsed.data.features.reduce((sum, row) => sum + row.failed, 0)
        report.current?.(total ? { status: 'ready', succeeded, failed, from, to } : { status: 'empty' })
      }
    }).catch((reason: unknown) => { if (request.isActive()) { setError(monitoringFailureMessage(reason, '작업 결과를')); report.current?.({ status: 'error' }) } }).finally(request.finish)
    return request.cancel
  }, [days, revision, monitoringFetch])

  return <section className={`${styles.card} min-w-0`} aria-label="작업 결과">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><EvaluationHelp label="작업 결과" title={<h2 className="m-0 text-lg font-bold tracking-tight text-ink">작업 결과</h2>}>신청 양식 찾기, 문서 만들기, 중복 지원 검토의 저장된 작업을 보여줍니다. 같은 작업을 다시 접수해도 한 건으로 세며 삭제된 작업은 포함되지 않습니다.</EvaluationHelp>{isExample && <p className="mt-2 mb-0 text-xs font-bold text-warning">예시 데이터 · 실제 기록 아님</p>}</div>
      <label className="grid gap-1 text-xs font-semibold text-ink-muted">접수 기간 (UTC)<select value={days} onChange={(event) => setDays(event.target.value)} className="min-h-11 rounded-xl border border-line bg-white px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-brand-primary"><option value="1">오늘</option><option value="7">최근 7일</option><option value="30">최근 30일</option></select></label>
    </div>
    {error ? <div className="rounded-xl bg-danger-soft p-4 text-sm text-danger" role="alert">{error} <button type="button" className="min-h-10 font-bold underline focus-visible:outline-2 focus-visible:outline-danger" onClick={() => setRevision((value) => value + 1)}>다시 조회</button></div>
      : !data ? <p role="status" className="text-sm text-ink-muted">작업 결과를 불러오고 있습니다.</p>
        : <>
          <p className="m-0 text-xs leading-5 text-ink-muted">{data.from} ~ {data.to} UTC에 접수된 저장 작업 기준입니다.</p>
          {!totals?.total ? <div className="rounded-xl border border-dashed border-[#bed4c4] bg-[#f6faf7] p-5"><p className="m-0 text-sm font-bold text-ink">이 기간에 저장된 작업이 없습니다.</p><p className="mt-1 mb-0 text-sm leading-6 text-ink-muted">신청 양식 찾기, 문서 만들기, 중복 지원 검토의 저장된 작업을 보여줘요. 다른 기간도 확인해 보세요.</p></div> : <>
          <dl className="grid grid-cols-2 gap-4 border-y border-line py-4 lg:grid-cols-4" aria-label="작업 요약">
            <JobTotal label="저장된 작업" value={totals.total} />
            <JobTotal label="성공" value={totals.succeeded} />
            <JobTotal label="대기·진행" value={totals.active} />
            <JobTotal label="확인 필요" value={totals.attention} note="실패·중단·결과 불명" attention={totals.attention > 0} />
          </dl>
          <details open={detailOpen} onToggle={(event) => setDetailOpen(event.currentTarget.open)} className="border-t border-line pt-3">
            <summary className="min-h-11 cursor-pointer content-center text-sm font-bold text-brand-primary focus-visible:outline-2 focus-visible:outline-brand-primary">작업 종류별 결과와 소요 시간 보기</summary>
            <div className="grid gap-3 lg:grid-cols-3">
            {data.features.map((row) => <article key={row.feature} className="min-w-0 rounded-2xl border border-line bg-[#fafbfa] p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="m-0 text-sm font-bold text-ink">{labels[row.feature]}</h3><span className="text-xs text-ink-muted">총 {row.total.toLocaleString('ko-KR')}건</span></div>
              {row.total === 0 ? <p className="mt-4 mb-1 text-sm text-ink-muted">이 기간에 저장된 작업이 없습니다.</p> : <>
                <p className="mt-3 mb-0 text-2xl font-bold tabular-nums tracking-tight text-ink">{row.succeeded.toLocaleString('ko-KR')}<span className="ml-1 text-sm font-normal text-ink-muted">건 성공</span></p>
                <p className="mt-2 mb-0 text-sm text-ink-muted">대기 {row.queued.toLocaleString('ko-KR')}건 · 진행 {row.running.toLocaleString('ko-KR')}건 · <span className={row.failed ? 'font-bold text-danger' : ''}>실패 {row.failed.toLocaleString('ko-KR')}건</span></p>
                {(row.interrupted > 0 || row.unknown > 0) && <p className="mt-1 mb-0 text-sm text-ink-muted">중단 {row.interrupted.toLocaleString('ko-KR')}건 · 확인 필요 {row.unknown.toLocaleString('ko-KR')}건</p>}
                <p className="mt-3 mb-0 border-t border-line pt-3 text-xs text-ink-muted">평균 소요 {duration(row.averageDurationMs)} · 시간 기록 {row.durationSamples.toLocaleString('ko-KR')}건</p>
              </>}
            </article>)}
            </div>
            <p className="mt-3 mb-0 text-xs leading-5 text-ink-muted">종료된 작업(성공·실패 등)의 접수부터 종료까지 평균입니다. 시간 기록이 없는 작업은 평균에서 빠집니다.</p>
          </details>
          </>}
        </>}
  </section>
}

function JobTotal({ label, value, note, attention = false }: { label: string; value: number; note?: string; attention?: boolean }) {
  return <div><dt className="text-xs font-semibold text-ink-muted">{label}</dt><dd className={`mt-1 text-2xl font-bold tabular-nums tracking-tight ${attention ? 'text-danger' : 'text-ink'}`}>{value.toLocaleString('ko-KR')}건</dd>{note && <dd className="mt-1 text-xs leading-5 text-ink-muted">{note}</dd>}</div>
}
