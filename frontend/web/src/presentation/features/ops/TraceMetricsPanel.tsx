import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { workspacePageStyles as styles } from '../../shared/workspace/WorkspacePage.styles'
import { EvaluationHelp } from './EvaluationHelp'
import { useMonitoringDemo } from './MonitoringDemoContext'
import { createMonitoringRequest, MonitoringResponseError, monitoringFailureMessage, requireMonitoringResponse } from './monitoringRequest'

const count = z.number().int().nonnegative()
const seconds = z.number().finite().nonnegative().nullable()
const metricsSchema = z.object({
  from_time: z.iso.datetime({ offset: true }), to_time: z.iso.datetime({ offset: true }),
  scope: z.literal('observed-root-traces'),
  environment: z.enum(['all', 'production', 'development', 'unknown', 'other']),
  results: z.array(z.object({
    name: z.enum(['search.total', 'evidence.total', 'assistant.total']),
    observed: count, completed: count, in_progress: count, errors: count, warnings: count,
    latency_samples: count, missing_latency: count, p50_seconds: seconds, p95_seconds: seconds,
  })),
})
type Metrics = z.infer<typeof metricsSchema>
const labels: Record<string, string> = { 'search.total': '공고 검색', 'evidence.total': '공고 근거 답변', 'assistant.total': 'AI 도우미' }
const environments: Record<string, string> = { production: '운영', development: '개발', unknown: '환경 미기록', other: '그 외 환경', all: '전체 환경' }
const duration = (value: number | null) => value === null ? '기록 없음' : `${value.toLocaleString('ko-KR', { maximumFractionDigits: 3 })}초`
const seoulTime = (value: string) => new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(new Date(value))

export function TraceMetricsPanel({ onExpired }: { onExpired: () => void }) {
  const { isExample, monitoringFetch } = useMonitoringDemo()
  // 로컬 개발 서버는 development 추적을 사용한다. 연결 모드와 배포 빌드는 운영 기준을 유지한다.
  const initialEnvironment = import.meta.env.DEV && import.meta.env.MODE === 'development' ? 'development' : 'production'
  const [days, setDays] = useState('7')
  const [range, setRange] = useState('7')
  const [environment, setEnvironment] = useState(initialEnvironment)
  const [selectedEnvironment, setSelectedEnvironment] = useState(initialEnvironment)
  const [revision, setRevision] = useState(0)
  const [data, setData] = useState<Metrics | null>(null)
  const [error, setError] = useState('')
  const expiry = useRef(onExpired); expiry.current = onExpired
  useEffect(() => {
    const request = createMonitoringRequest()
    const end = new Date()
    const query = new URLSearchParams({ from_time: new Date(end.getTime() - Number(range) * 86_400_000).toISOString(), to_time: end.toISOString(), environment: selectedEnvironment })
    setData(null); setError('')
    monitoringFetch(`/api/v1/ops/trace-metrics?${query}`, { credentials: 'same-origin', cache: 'no-store', signal: request.signal })
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) { expiry.current(); return }
        requireMonitoringResponse(response)
        const parsed = metricsSchema.safeParse(await response.json().catch(() => { throw new MonitoringResponseError('invalid') }))
        if (!parsed.success || parsed.data.environment !== selectedEnvironment) throw new MonitoringResponseError('invalid')
        if (request.isActive()) setData(parsed.data)
      }).catch((reason: unknown) => { if (request.isActive()) setError(monitoringFailureMessage(reason, '실행 기록을')) }).finally(request.finish)
    return request.cancel
  }, [range, selectedEnvironment, revision, monitoringFetch])
  return <section className={styles.card} aria-label="추적된 실행 집계">
    <EvaluationHelp label="기록된 실행" title={<h2 className={styles.cardTitle}>기록된 실행 살펴보기</h2>}>
      검색·근거 답변·도우미의 시작 단계를 집계합니다. 환경이 기록되지 않은 실행은 전체 환경 또는 환경 미기록을 선택하면 볼 수 있습니다. 오류·주의는 종료된 실행의 기록 수준 기준이며 시간은 측정된 실행만 사용합니다.
    </EvaluationHelp>
    {isExample && <p className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-950">예시 데이터 · 실제 실행 기록이 아닙니다.</p>}
    <p className="m-0 text-sm leading-6 text-ink-muted">수집된 실행만 포함하므로 전체 사용자 요청의 실패율이 아닙니다.</p>
    <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); setRange(days); setSelectedEnvironment(environment); setRevision((value) => value + 1) }}>
      <label className="grid gap-1 text-sm">집계 기간<select value={days} onChange={(event) => setDays(event.target.value)} className="min-h-11 rounded-xl border border-line bg-white px-3 text-ink focus-visible:outline-2 focus-visible:outline-brand-primary">
        <option value="1">최근 24시간</option><option value="7">최근 7일</option><option value="30">최근 30일</option>
      </select></label>
      <label className="grid gap-1 text-sm">실행 환경<select value={environment} onChange={(event) => setEnvironment(event.target.value)} className="min-h-11 rounded-xl border border-line bg-white px-3 text-ink focus-visible:outline-2 focus-visible:outline-brand-primary">
        <option value="production">운영</option><option value="development">개발</option><option value="unknown">환경 미기록</option><option value="other">그 외 환경</option><option value="all">전체 환경</option>
      </select></label>
      <button className={styles.secondaryButton}>집계 조회</button>
    </form>
    {(days !== range || environment !== selectedEnvironment) && <p role="status" className="m-0 text-xs text-ink-muted">조회 조건을 바꿨습니다. ‘집계 조회’를 누르면 적용됩니다.</p>}
    {error ? <div role="alert" className="rounded-xl bg-danger-soft p-4 text-sm text-danger"><p className="m-0">{error}</p><button type="button" className="mt-2 min-h-10 font-bold underline" onClick={() => setRevision((value) => value + 1)}>실행 기록 다시 조회</button></div> : !data ? <p role="status">실행 집계를 불러오고 있습니다.</p> : <>
      <p className="m-0 text-xs leading-5 text-ink-muted">조회 환경: {environments[selectedEnvironment]} · {seoulTime(data.from_time)} ~ {seoulTime(data.to_time)} (한국 시간). 최신 기록은 반영이 지연될 수 있습니다.</p>
      {data.results.every((item) => item.observed === 0) ? <div className="rounded-xl border border-dashed border-line bg-surface-muted p-4"><p className="m-0 text-sm font-bold text-ink">선택한 기간과 환경에 기록된 실행이 없습니다.</p><p className="mt-1 mb-0 text-sm leading-6 text-ink-muted">기간을 늘리거나 실행 환경을 ‘전체 환경’으로 바꿔 확인해 보세요. 기록이 없으면 오류 비율과 걸린 시간을 계산할 수 없습니다.</p></div> : <>
        <p className="m-0 text-xs leading-5 text-ink-muted">시간은 측정된 실행만 사용하며 미기록은 0초로 계산하지 않습니다.</p>
        <div className="divide-y divide-line border-y border-line">{data.results.map((item) => <article key={item.name} className="grid gap-3 py-4 sm:grid-cols-[minmax(9rem,1fr)_2fr]">
          <div><h3 className="m-0 text-sm font-bold text-ink">{labels[item.name]}</h3><p className="mt-1 mb-0 text-sm text-ink-muted">기록된 실행 <strong className="font-bold text-ink tabular-nums">{item.observed.toLocaleString('ko-KR')}건</strong></p></div>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4"><div><span className="block text-xs text-ink-muted">종료 / 진행 중</span><strong className="mt-1 block tabular-nums">{item.completed.toLocaleString('ko-KR')}건 / {item.in_progress.toLocaleString('ko-KR')}건</strong></div><div><span className="block text-xs text-ink-muted">종료 중 오류</span><strong className="mt-1 block tabular-nums">{item.errors.toLocaleString('ko-KR')}건{item.completed > 0 && ` (${(item.errors * 100 / item.completed).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}%)`}</strong></div><div><span className="block text-xs text-ink-muted">절반이 끝난 시간 (p50)</span><strong className="mt-1 block tabular-nums">{duration(item.p50_seconds)}</strong></div><div><span className="block text-xs text-ink-muted">95%가 끝난 시간 (p95)</span><strong className="mt-1 block tabular-nums">{duration(item.p95_seconds)}</strong></div></div>
          <details className="sm:col-span-2 text-xs leading-5 text-ink-muted"><summary className="min-h-10 cursor-pointer content-center font-semibold text-brand-primary focus-visible:outline-2 focus-visible:outline-brand-primary">측정 정보 더 보기</summary><p className="m-0">주의 {item.warnings.toLocaleString('ko-KR')}건 · 시간 기록 {item.latency_samples.toLocaleString('ko-KR')}건 · 시간 미기록 {item.missing_latency.toLocaleString('ko-KR')}건</p><p className="mt-1 mb-0">실행의 95%가 끝난 시간: {duration(item.p95_seconds)}</p><p className="mt-1 mb-0">시간 기록이 있는 실행만으로 계산하며, 오류 비율은 종료된 실행을 기준으로 합니다.</p></details>
        </article>)}</div>
      </>}
    </>}
  </section>
}
