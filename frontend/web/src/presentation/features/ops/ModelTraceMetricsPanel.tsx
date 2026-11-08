import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { workspacePageStyles as styles } from '../../shared/workspace/WorkspacePage.styles'
import { EvaluationHelp } from './EvaluationHelp'
import { useMonitoringDemo } from './MonitoringDemoContext'
import { createMonitoringRequest, MonitoringResponseError, monitoringFailureMessage, requireMonitoringResponse } from './monitoringRequest'

const count = z.number().int().nonnegative()
const duration = z.number().finite().nonnegative().nullable()
const rowSchema = z.object({
  feature: z.enum(['search.ranking.model', 'evidence.model', 'assistant.model']),
  model: z.string().nullable(), observed: count, completed: count, errors: count, warnings: count, timeouts: count, timeout_unknown: count,
  in_progress: count, latency_samples: count, missing_latency: count, p50_seconds: duration, p95_seconds: duration,
}).refine((row) => row.observed === row.completed + row.in_progress
  && row.timeouts + row.timeout_unknown <= row.errors && row.errors + row.warnings <= row.completed
  && row.latency_samples + row.missing_latency === row.completed
  && (row.latency_samples > 0 ? row.p50_seconds !== null && row.p95_seconds !== null : row.p50_seconds === null && row.p95_seconds === null))
const resultSchema = z.object({
  from_time: z.iso.datetime({ offset: true }), to_time: z.iso.datetime({ offset: true }),
  scope: z.literal('observed-model-generations'),
  environment: z.enum(['all', 'production', 'development', 'unknown', 'other']), results: z.array(rowSchema),
})
type Result = z.infer<typeof resultSchema>
const features: Record<string, string> = { 'search.ranking.model': '공고 검색 순위', 'evidence.model': '공고 근거 답변', 'assistant.model': 'AI 도우미' }
const environments: Record<string, string> = { all: '전체 환경', production: '운영', development: '개발', unknown: '환경 미기록', other: '그 외 환경' }
const seconds = (value: number | null) => value === null ? '측정 없음' : `${value.toLocaleString('ko-KR', { maximumFractionDigits: 3 })}초`
const seoulTime = (value: string) => new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(new Date(value))

/** 실제로 수집된 모델 generation만 집계하며, 전체 모델 호출 수나 실패율은 계산하지 않습니다. */
export function ModelTraceMetricsPanel({ onExpired, detailPage = false }: { onExpired: () => void; detailPage?: boolean }) {
  const { isExample, monitoringFetch } = useMonitoringDemo()
  const [filterOpen, setFilterOpen] = useState(detailPage)
  const [detailOpen, setDetailOpen] = useState(detailPage)
  const initialEnvironment = import.meta.env.DEV && import.meta.env.MODE === 'development' ? 'development' : 'production'
  const [days, setDays] = useState('7')
  const [range, setRange] = useState('7')
  const [environment, setEnvironment] = useState(initialEnvironment)
  const [selectedEnvironment, setSelectedEnvironment] = useState(initialEnvironment)
  const [revision, setRevision] = useState(0)
  const [data, setData] = useState<Result | null>(null)
  const [error, setError] = useState('')
  const expiry = useRef(onExpired); expiry.current = onExpired
  const totals = data?.results.reduce((sum, row) => ({
    observed: sum.observed + row.observed,
    completed: sum.completed + row.completed,
    errors: sum.errors + row.errors,
    inProgress: sum.inProgress + row.in_progress,
  }), { observed: 0, completed: 0, errors: 0, inProgress: 0 })

  useEffect(() => {
    const request = createMonitoringRequest()
    const end = new Date()
    const query = new URLSearchParams({ from_time: new Date(end.getTime() - Number(range) * 86_400_000).toISOString(), to_time: end.toISOString(), environment: selectedEnvironment })
    setData(null); setError('')
    monitoringFetch(`/api/v1/ops/model-trace-metrics?${query}`, { credentials: 'same-origin', cache: 'no-store', signal: request.signal })
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) { expiry.current(); return }
        requireMonitoringResponse(response)
        const parsed = resultSchema.safeParse(await response.json().catch(() => { throw new MonitoringResponseError('invalid') }))
        if (!parsed.success || parsed.data.environment !== selectedEnvironment
          || Date.parse(parsed.data.from_time) !== Date.parse(query.get('from_time')!)
          || Date.parse(parsed.data.to_time) !== Date.parse(query.get('to_time')!)) throw new MonitoringResponseError('invalid')
        if (request.isActive()) setData(parsed.data)
      }).catch((reason: unknown) => { if (request.isActive()) setError(monitoringFailureMessage(reason, '모델 실행 현황을')) }).finally(request.finish)
    return request.cancel
  }, [range, selectedEnvironment, revision, monitoringFetch])

  return <section className={styles.card} aria-label="수집된 모델 실행 현황">
    <EvaluationHelp label="모델 실행 현황" title={<h3 className="m-0 text-lg font-bold text-ink">모델 실행 현황</h3>}>검색 순위·근거 답변·도우미에서 수집된 모델 실행을 보여줍니다. 시간 초과는 오류에 포함됩니다.</EvaluationHelp>
    {isExample && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-950">예시 데이터 · 실제 모델 실행 기록이 아닙니다.</p>}
    <p className="m-0 text-sm leading-6 text-ink-muted">수집된 실행만 포함하므로 전체 모델 호출의 실패율이 아닙니다. 오류에는 응답 처리·형식 검사 실패도 포함될 수 있습니다.</p>
    <details open={filterOpen} onToggle={(event) => setFilterOpen(event.currentTarget.open)}>
      <summary className="min-h-11 cursor-pointer content-center text-sm font-bold text-brand-primary focus-visible:outline-2 focus-visible:outline-brand-primary">기간과 실행 환경 바꾸기</summary>
      <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); setRange(days); setSelectedEnvironment(environment); setRevision((value) => value + 1) }}>
      <label className="grid gap-1 text-sm">모델 실행 기간<select value={days} onChange={(event) => setDays(event.target.value)} className="min-h-11 rounded-xl border border-line bg-white px-3 text-ink focus-visible:outline-2 focus-visible:outline-brand-primary"><option value="1">최근 24시간</option><option value="7">최근 7일</option><option value="30">최근 30일</option></select></label>
      <label className="grid gap-1 text-sm">모델 실행 환경<select value={environment} onChange={(event) => setEnvironment(event.target.value)} className="min-h-11 rounded-xl border border-line bg-white px-3 text-ink focus-visible:outline-2 focus-visible:outline-brand-primary"><option value="production">운영</option><option value="development">개발</option><option value="unknown">환경 미기록</option><option value="other">그 외 환경</option><option value="all">전체 환경</option></select></label>
      <button className={styles.secondaryButton}>모델 실행 조회</button>
      </form>
      {(days !== range || environment !== selectedEnvironment) && <p role="status" className="mt-2 mb-0 text-xs text-ink-muted">조회 조건을 바꿨습니다. ‘모델 실행 조회’를 누르면 적용됩니다.</p>}
    </details>
    {error ? <div role="alert" className="rounded-xl bg-danger-soft p-4 text-sm text-danger"><p className="m-0">{error}</p><button type="button" className="mt-2 min-h-10 font-bold underline" onClick={() => setRevision((value) => value + 1)}>모델 실행 다시 조회</button></div> : !data ? <p role="status">모델 실행 현황을 불러오고 있습니다.</p> : <>
      <p className="m-0 text-xs leading-5 text-ink-muted">조회 환경: {environments[selectedEnvironment]} · {seoulTime(data.from_time)} ~ {seoulTime(data.to_time)} (한국 시간). 최신 기록은 반영이 지연될 수 있습니다.</p>
      {data.results.length === 0 ? <div className="rounded-xl border border-dashed border-line bg-surface-muted p-4"><p className="m-0 text-sm font-bold text-ink">수집된 모델 실행이 없습니다.</p><p className="mt-1 mb-0 text-sm leading-6 text-ink-muted">실제 호출이 없었다는 뜻은 아닙니다. 기간과 실행 환경을 바꾸거나 추적 수집 상태를 확인해 주세요.</p></div> : <>
        <dl aria-label="수집된 모델 실행 요약" className="m-0 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
          <div className="bg-surface-muted p-4"><dt className="text-sm text-ink-muted">수집된 모델 실행</dt><dd className="mt-1 mb-0"><span className="block text-2xl font-bold tabular-nums text-ink">{totals!.observed.toLocaleString('ko-KR')}건</span><span className="mt-1 block text-xs text-ink-muted">진행 중 {totals!.inProgress.toLocaleString('ko-KR')}건 포함</span></dd></div>
          <div className="bg-surface-muted p-4"><dt className="text-sm text-ink-muted">종료된 실행</dt><dd className="mt-1 mb-0"><span className="block text-2xl font-bold tabular-nums text-ink">{totals!.completed.toLocaleString('ko-KR')}건</span><span className="mt-1 block text-xs text-ink-muted">오류로 끝난 실행 포함</span></dd></div>
          <div className="bg-surface-muted p-4"><dt className="text-sm text-ink-muted">종료된 실행 중 오류</dt><dd className="mt-1 mb-0"><span className={`block text-2xl font-bold tabular-nums ${totals!.errors > 0 ? 'text-danger' : 'text-ink'}`}>{totals!.errors.toLocaleString('ko-KR')}건</span><span className="mt-1 block text-xs text-ink-muted">시간 초과 포함</span></dd></div>
        </dl>
        <details open={detailOpen} onToggle={(event) => setDetailOpen(event.currentTarget.open)} className="border-t border-line pt-3">
        <summary className="min-h-11 cursor-pointer content-center text-sm font-bold text-brand-primary focus-visible:outline-2 focus-visible:outline-brand-primary">기능과 모델별 자세히 보기</summary>
        <p className="m-0 text-xs leading-5 text-ink-muted">시간은 기록된 실행만으로 계산합니다. 시간 초과 여부 미기록은 시간 초과 건수에서 빠집니다.</p>
        <div className="divide-y divide-line border-y border-line">{data.results.map((item) => <article key={JSON.stringify([item.feature, item.model])} className="grid gap-3 py-4 sm:grid-cols-[minmax(9rem,1fr)_2fr]">
          <div><h4 className="m-0 text-sm font-bold text-ink">{features[item.feature]}</h4><p className="mt-1 mb-0 break-all text-xs text-ink-muted">{item.model || '모델 미기록'}</p><p className="mt-1 mb-0 text-sm text-ink-muted">수집된 실행 <strong className="font-bold tabular-nums text-ink">{item.observed.toLocaleString('ko-KR')}건</strong></p></div>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4"><div><span className="block text-xs text-ink-muted">종료 / 진행 중</span><strong className="mt-1 block tabular-nums">{item.completed.toLocaleString('ko-KR')}건 / {item.in_progress.toLocaleString('ko-KR')}건</strong></div><div><span className="block text-xs text-ink-muted">오류 · 그중 시간 초과</span><strong className="mt-1 block tabular-nums">{item.errors.toLocaleString('ko-KR')}건 · {item.timeouts.toLocaleString('ko-KR')}건</strong></div><div><span className="block text-xs text-ink-muted">절반이 끝난 시간 (p50)</span><strong className="mt-1 block tabular-nums">{seconds(item.p50_seconds)}</strong></div><div><span className="block text-xs text-ink-muted">95%가 끝난 시간 (p95)</span><strong className="mt-1 block tabular-nums">{seconds(item.p95_seconds)}</strong></div></div>
          <p className="m-0 text-xs leading-5 text-ink-muted sm:col-span-2">시간 기록 {item.latency_samples.toLocaleString('ko-KR')}건 기준 · 시간 미기록 {item.missing_latency.toLocaleString('ko-KR')}건 · 주의 {item.warnings.toLocaleString('ko-KR')}건{item.timeout_unknown > 0 && ` · 시간 초과 여부 미기록 ${item.timeout_unknown.toLocaleString('ko-KR')}건`}</p>
        </article>)}</div>
        </details>
      </>}
    </>}
  </section>
}
