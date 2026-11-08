import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { Link } from 'react-router'
import { z } from 'zod'
import { appContainer } from '../../../app/appContainer'
import { defaultAdminAiCostPeriod, formatAiCostUsd, type AdminAiCostSummary } from '../../../domain/entities/AdminAiCost'
import { adminAccessFailure } from '../admin/viewmodel/adminAccountAccess'
import { EvaluationHelp } from './EvaluationHelp'
import { exampleCostUseCases, useMonitoringDemo } from './MonitoringDemoContext'
import { createMonitoringRequest, requireMonitoringResponse } from './monitoringRequest'

const count = z.number().int().nonnegative()
const requestRow = z.object({ feature: z.string().min(1), total: count, success: count, accepted: count,
  clientErrors: count, serverErrors: count, other: count, latencySamples: count })
  .refine((row) => row.total === row.success + row.accepted + row.clientErrors + row.serverErrors + row.other
    && row.latencySamples <= row.total)
const requestSchema = z.object({ from: z.iso.date(), to: z.iso.date(), scope: z.literal('core-http-requests'), features: z.array(requestRow) })
  .refine((value) => new Set(value.features.map((row) => row.feature)).size === value.features.length)
const dailySchema = z.object({
  from: z.iso.date(), to: z.iso.date(), scope: z.literal('core-http-requests'),
  days: z.array(z.object({ date: z.iso.date(), features: z.array(requestRow).min(1) })),
}).refine((value) => new Set(value.days.map((day) => day.date)).size === value.days.length
  && value.days.every((day) => day.date >= value.from && day.date <= value.to
    && new Set(day.features.map((row) => row.feature)).size === day.features.length))
const jobRow = z.object({ feature: z.enum(['APPLICATION_DISCOVERY', 'APPLICATION_DOCUMENT', 'COMBINATION_REVIEW']),
  total: count, queued: count, running: count, succeeded: count, failed: count, interrupted: count, unknown: count,
}).refine((row) => row.total === row.queued + row.running + row.succeeded + row.failed + row.interrupted + row.unknown)
const jobSchema = z.object({ from: z.iso.date(), to: z.iso.date(), scope: z.literal('stored-ai-jobs'), features: z.array(jobRow) })
  .refine((value) => new Set(value.features.map((row) => row.feature)).size === value.features.length)
const modelRow = z.object({ feature: z.enum(['search.ranking.model', 'evidence.model', 'assistant.model']), model: z.string().nullable(),
  observed: count, completed: count, errors: count, warnings: count, timeouts: count, timeout_unknown: count, in_progress: count,
}).refine((row) => row.observed === row.completed + row.in_progress && row.errors + row.warnings <= row.completed
  && row.timeouts + row.timeout_unknown <= row.errors)
const modelSchema = z.object({ from_time: z.iso.datetime({ offset: true }), to_time: z.iso.datetime({ offset: true }),
  scope: z.literal('observed-model-generations'), environment: z.enum(['all', 'production', 'development', 'unknown', 'other']), results: z.array(modelRow) })
  .refine((value) => new Set(value.results.map((row) => JSON.stringify([row.feature, row.model]))).size === value.results.length)

type Loadable<T> = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: T; fetchedAt: number; refreshing: boolean; stale: boolean }
type Requests = z.infer<typeof requestSchema>
type Daily = z.infer<typeof dailySchema>
type Jobs = z.infer<typeof jobSchema>
type Models = z.infer<typeof modelSchema>
type Cost = Loadable<AdminAiCostSummary> | { status: 'forbidden' }
const loading = { status: 'loading' } as const
const cardClass = 'group flex min-w-0 flex-col rounded-xl border border-line bg-white p-5 text-ink no-underline hover:border-brand-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary'

function startRefresh<T>(previous: Loadable<T>): Loadable<T> {
  return previous.status === 'ready' ? { ...previous, refreshing: true } : loading
}

function failedRefresh<T>(previous: Loadable<T>): Loadable<T> {
  return previous.status === 'ready' ? { ...previous, refreshing: false, stale: true } : { status: 'error' }
}

function SourceTime<T>({ state }: { state: Loadable<T> | { status: 'forbidden' } }) {
  if (state.status !== 'ready') return null
  const time = new Date(state.fetchedAt).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
  return <span className={`mt-1 text-xs leading-5 ${state.stale ? 'font-semibold text-danger' : 'text-ink-muted'}`}>
    {state.refreshing ? '갱신 중 · 이전 조회' : state.stale ? '갱신 실패 · 이전 조회' : '조회 완료'} {time} (한국 시간)
  </span>
}

/** 운영 요약만 표시하며 각 수치의 상세 조사는 별도 페이지에서 합니다. */
export function MonitoringOverview({ onExpired }: { onExpired: () => void }) {
  const { isExample, monitoringFetch } = useMonitoringDemo()
  const expiry = useRef(onExpired); expiry.current = onExpired
  const [requests, setRequests] = useState<Loadable<Requests>>(loading)
  const [jobs, setJobs] = useState<Loadable<Jobs>>(loading)
  const [daily, setDaily] = useState<Loadable<Daily>>(loading)
  const [models, setModels] = useState<Loadable<Models>>(loading)
  const [costs, setCosts] = useState<Cost>(loading)
  const [revision, setRevision] = useState(0)
  const [costRevision, setCostRevision] = useState(0)
  const costRequestedAt = useRef(0)
  const suffix = isExample ? '?example=1' : ''
  const detail = (section: string) => `/ops/usage/${section}${suffix}`

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') {
        setRevision((value) => value + 1)
        if (Date.now() - costRequestedAt.current >= 300_000) setCostRevision((value) => value + 1)
      }
    }, 60_000)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') { setRevision((value) => value + 1); setCostRevision((value) => value + 1) }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisibilityChange) }
  }, [])

  useEffect(() => {
    const now = new Date()
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    const from = new Date(today - 6 * 86_400_000).toISOString().slice(0, 10)
    const to = new Date(today).toISOString().slice(0, 10)
    const query = new URLSearchParams({ from, to })
    const todayQuery = new URLSearchParams({ from: to, to })
    const environment = import.meta.env.DEV && import.meta.env.MODE === 'development' ? 'development' : 'production'
    const fromTime = new Date(now.getTime() - 86_400_000).toISOString()
    const toTime = now.toISOString()
    const modelQuery = new URLSearchParams({ from_time: fromTime, to_time: toTime, environment })
    setRequests(startRefresh); setJobs(startRefresh); setDaily(startRefresh); setModels(startRefresh)
    const calls = [createMonitoringRequest(), createMonitoringRequest(), createMonitoringRequest(), createMonitoringRequest()]

    function read<T>(index: number, path: string, schema: z.ZodType<T>, matches: (data: T) => boolean, update: Dispatch<SetStateAction<Loadable<T>>>) {
      const request = calls[index]
      request.signal.addEventListener('abort', () => { if (request.isActive()) update(failedRefresh) }, { once: true })
      monitoringFetch(path, { credentials: 'same-origin', cache: 'no-store', signal: request.signal })
        .then(async (response) => {
          if (request.signal.aborted) throw new Error('monitoring request timed out')
          if (response.status === 401 || response.status === 403) { if (request.isActive()) expiry.current(); return }
          requireMonitoringResponse(response)
          const parsed = schema.safeParse(await response.json())
          if (request.signal.aborted) throw new Error('monitoring request timed out')
          if (!parsed.success || !matches(parsed.data)) throw new Error('invalid monitoring response')
          if (request.isActive()) update({ status: 'ready', data: parsed.data, fetchedAt: Date.now(), refreshing: false, stale: false })
        })
        .catch(() => { if (request.isActive()) update(failedRefresh) })
        .finally(request.finish)
    }

    read(0, `/api/v1/admin/ai-request-metrics?${query}`, requestSchema, (data) => data.from === from && data.to === to, setRequests)
    read(1, `/api/v1/admin/ai-request-metrics/jobs?${todayQuery}`, jobSchema, (data) => data.from === to && data.to === to, setJobs)
    read(2, `/api/v1/admin/ai-request-metrics/daily?${query}`, dailySchema, (data) => data.from === from && data.to === to, setDaily)
    read(3, `/api/v1/ops/model-trace-metrics?${modelQuery}`, modelSchema,
      (data) => data.environment === environment && Date.parse(data.from_time) === Date.parse(fromTime) && Date.parse(data.to_time) === Date.parse(toTime), setModels)
    return () => { calls.forEach((call) => call.cancel()) }
  }, [monitoringFetch, revision])

  useEffect(() => {
    const request = createMonitoringRequest()
    const now = Date.now()
    costRequestedAt.current = now
    setCosts((previous) => previous.status === 'forbidden' ? loading : startRefresh(previous))
    request.signal.addEventListener('abort', () => {
      if (request.isActive()) setCosts((previous) => previous.status === 'ready' ? failedRefresh(previous) : { status: 'error' })
    }, { once: true })
    const costPeriod = defaultAdminAiCostPeriod(now)
    const costUseCase = isExample ? exampleCostUseCases.getSummary : appContainer.resolve('getAdminAiCostSummaryUseCase')
    costUseCase.execute(costPeriod.from, costPeriod.to, request.signal)
      .then((data) => {
        if (request.signal.aborted) throw new Error('cost request timed out')
        if (data.from !== costPeriod.from || data.to !== costPeriod.to) throw new Error('invalid cost period')
        if (request.isActive()) setCosts({ status: 'ready', data, fetchedAt: Date.now(), refreshing: false, stale: false })
      })
      .catch((error: unknown) => {
        if (!request.isActive()) return
        if (request.signal.aborted) { setCosts((previous) => previous.status === 'ready' ? failedRefresh(previous) : { status: 'error' }); return }
        const access = adminAccessFailure(error)
        if (access === 'signed-out') { expiry.current(); return }
        if (access === 'forbidden') { setCosts({ status: 'forbidden' }); return }
        setCosts((previous) => previous.status === 'ready' ? failedRefresh(previous) : { status: 'error' })
      })
      .finally(request.finish)
    return request.cancel
  }, [isExample, costRevision])

  const requestTotals = requests.status === 'ready' ? requests.data.features.reduce((total, row) => ({ requests: total.requests + row.total, errors: total.errors + row.serverErrors }), { requests: 0, errors: 0 }) : null
  const jobTotals = jobs.status === 'ready' ? jobs.data.features.reduce((total, row) => ({ total: total.total + row.total, succeeded: total.succeeded + row.succeeded, failed: total.failed + row.failed, active: total.active + row.queued + row.running }), { total: 0, succeeded: 0, failed: 0, active: 0 }) : null
  const modelTotals = models.status === 'ready' ? models.data.results.reduce((total, row) => ({ observed: total.observed + row.observed, completed: total.completed + row.completed, errors: total.errors + row.errors }), { observed: 0, completed: 0, errors: 0 }) : null
  const requestValue = requests.status === 'loading' ? '불러오는 중…' : requests.status === 'error' ? '조회 실패' : !requestTotals?.requests ? '기록 없음' : `${requestTotals.errors.toLocaleString('ko-KR')}건`
  const modelValue = models.status === 'loading' ? '불러오는 중…' : models.status === 'error' ? '조회 실패' : !modelTotals?.observed ? '기록 없음' : `${modelTotals.errors.toLocaleString('ko-KR')}건`
  const jobValue = jobs.status === 'loading' ? '불러오는 중…' : jobs.status === 'error' ? '조회 실패' : !jobTotals?.total ? '기록 없음' : `${jobTotals.succeeded.toLocaleString('ko-KR')}건`
  const costTotals = costs.status === 'ready' ? costs.data.totals : null
  const costValue = costs.status === 'loading' ? '불러오는 중…' : costs.status === 'forbidden' ? '권한 없음' : costs.status === 'error' ? '조회 실패'
    : costTotals?.calls === 0 ? '기록 없음'
      : costTotals && (costTotals.unpricedCalls === costTotals.calls || costTotals.incompleteUsageCalls === costTotals.calls) ? '미확정'
      : costTotals ? formatAiCostUsd(costTotals.estimatedUsd, costs.data.krwPerUsd) : '미확인'
  const containsTestData = !isExample && costs.status === 'ready' && costs.data.byModel.some((row) => row.key?.startsWith('demo-local-'))
  const costNote = costTotals && (costTotals.unpricedCalls > 0 || costTotals.incompleteUsageCalls > 0)
    ? `비용 미확정 ${costTotals.unpricedCalls.toLocaleString('ko-KR')}회 · 사용량 미확인 ${costTotals.incompleteUsageCalls.toLocaleString('ko-KR')}회`
    : null
  const today = new Date().toISOString().slice(0, 10)
  const todayInRange = daily.status === 'ready' && daily.data.from <= today && daily.data.to >= today
  const todayRows = todayInRange && daily.status === 'ready' ? daily.data.days.find((day) => day.date === today)?.features : undefined
  const todayTotals = todayRows?.reduce((total, row) => ({ requests: total.requests + row.total, errors: total.errors + row.serverErrors }), { requests: 0, errors: 0 })

  return <>
    <section aria-label="오늘의 요청 현황" className="rounded-xl border border-brand-primary/20 bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><EvaluationHelp label="오늘의 요청" title={<h2 className="m-0 text-xl font-bold text-ink">오늘의 요청과 서버 오류</h2>}><p className="m-0">Core에 기록된 HTTP 응답을 UTC 날짜 기준으로 집계합니다. 서버 오류는 5xx 응답이며 기록되지 않은 요청은 포함되지 않습니다.</p></EvaluationHelp><p className="mt-1 mb-0 text-sm text-ink-muted">{today} · UTC · 기록된 HTTP 응답</p></div>
        <Link to={detail('requests')} className="min-h-11 content-center text-sm font-semibold text-brand-primary underline underline-offset-4">요청 상세 보기</Link>
      </div>
      {daily.status === 'loading' ? <p role="status" className="mt-5 text-sm text-ink-muted">오늘 기록을 불러오는 중…</p>
        : daily.status === 'error' ? <p role="alert" className="mt-5 text-sm font-semibold text-danger">오늘 기록 조회 실패</p>
          : !todayInRange ? <p className="mt-5 text-sm font-semibold text-danger">오늘 기록 확인 불가 · 이전 기간의 기록입니다.</p>
            : !todayTotals ? <p className="mt-5 text-base font-semibold text-ink-muted">오늘 기록 없음</p>
              : <div className="mt-5 grid gap-3 sm:grid-cols-2"><div className="rounded-lg bg-surface-muted p-4"><p className="m-0 text-sm font-semibold text-ink-muted">오늘 요청</p><p className="mt-2 mb-0 text-3xl font-bold tabular-nums text-ink">{todayTotals.requests.toLocaleString('ko-KR')}<span className="ml-1 text-base">건</span></p></div><div className="rounded-lg bg-surface-muted p-4"><p className="m-0 text-sm font-semibold text-ink-muted">서버 오류</p><p className={`mt-2 mb-0 text-3xl font-bold tabular-nums ${todayTotals.errors ? 'text-danger' : 'text-ink'}`}>{todayTotals.errors.toLocaleString('ko-KR')}<span className="ml-1 text-base">건</span></p><p className="mt-1 mb-0 text-xs text-ink-muted">{todayTotals.requests ? `요청 중 ${(todayTotals.errors * 100 / todayTotals.requests).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}%` : '기록된 요청 없음'}</p></div></div>}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1"><SourceTime state={daily} /><p className="m-0 text-xs leading-5 text-ink-muted">기록 반영 지연 가능</p></div>
    </section>
    <section aria-label="주요 모니터링 수치">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0"><EvaluationHelp label="주요 현황" title={<h2 className="m-0 text-xl font-bold tracking-tight text-ink">기간별 주요 현황</h2>}><p className="m-0">표시된 기간과 집계 기준은 지표마다 다릅니다. 기록되지 않은 요청은 집계되지 않으며, 모델 실행 오류가 반드시 제공자 장애를 뜻하지는 않습니다. 정상 종료가 답변 품질을 보장하지는 않습니다. 비용은 앱에 기록된 사용량을 바탕으로 계산한 추정치입니다.</p></EvaluationHelp><p className="mt-1 mb-0 text-xs leading-5 text-ink-muted">화면 표시 중 자동 조회 · 요청·작업·모델 1분 · 비용 5분</p></div>
        <button type="button" onClick={() => { setRevision((value) => value + 1); setCostRevision((value) => value + 1) }} className="min-h-11 rounded-lg border border-line bg-white px-4 text-sm font-semibold text-ink hover:border-brand-primary focus-visible:outline-2 focus-visible:outline-brand-primary">현황 새로고침</button>
      </div>
      {isExample && <p role="status" className="mb-4 rounded-lg bg-amber-50 p-3 text-sm font-bold text-amber-950">예시 데이터 · 실제 운영 현황이 아닙니다.</p>}
      <nav aria-label="상세 현황으로 이동" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Link className={cardClass} to={detail('requests')}><span className="text-sm font-semibold text-ink-muted">서버 오류 응답</span><strong className={`mt-3 text-3xl font-bold tabular-nums ${requests.status === 'error' || (requestTotals?.errors ?? 0) > 0 ? 'text-danger' : 'text-ink'}`}>{requestValue}</strong><span className="mt-2 text-sm leading-6 text-ink-muted">{requestTotals?.requests ? `기록된 요청 ${requestTotals.requests.toLocaleString('ko-KR')}건 중 ${(requestTotals.errors * 100 / requestTotals.requests).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}%` : '기록된 HTTP 응답 기준'}</span><span className="mt-1 text-xs leading-5 text-ink-muted">{requests.status === 'ready' ? `${requests.data.from} ~ ${requests.data.to} UTC` : '최근 7일 · UTC'}</span><SourceTime state={requests} /><span className="mt-4 text-sm font-semibold text-brand-primary">요청 상세 보기 →</span></Link>
        <Link className={cardClass} to={detail('models')}><span className="text-sm font-semibold text-ink-muted">수집된 모델 실행 오류</span><strong className={`mt-3 text-3xl font-bold tabular-nums ${models.status === 'error' || (modelTotals?.errors ?? 0) > 0 ? 'text-danger' : 'text-ink'}`}>{modelValue}</strong><span className="mt-2 text-sm leading-6 text-ink-muted">{modelTotals?.observed ? `수집 ${modelTotals.observed.toLocaleString('ko-KR')}건 · 종료 ${modelTotals.completed.toLocaleString('ko-KR')}건 중` : '추적 서버에 수집된 실행만'}</span><span className="mt-1 text-xs leading-5 text-ink-muted">최근 24시간 · {import.meta.env.DEV && import.meta.env.MODE === 'development' ? '개발' : '운영'} 환경</span><SourceTime state={models} /><span className="mt-4 text-sm font-semibold text-brand-primary">모델 상세 보기 →</span></Link>
        <Link className={cardClass} to={detail('jobs')}><span className="text-sm font-semibold text-ink-muted">완료된 작업</span><strong className={`mt-3 text-3xl font-bold tabular-nums ${jobs.status === 'error' ? 'text-danger' : 'text-ink'}`}>{jobValue}</strong><span className="mt-2 text-sm leading-6 text-ink-muted">{jobTotals?.total ? `실패 ${jobTotals.failed.toLocaleString('ko-KR')}건 · 대기·진행 ${jobTotals.active.toLocaleString('ko-KR')}건` : '접수 후 성공적으로 끝난 작업'}</span><span className="mt-1 text-xs leading-5 text-ink-muted">{jobs.status === 'ready' ? `접수일 ${jobs.data.from} · UTC` : '오늘 접수 · UTC'}</span><SourceTime state={jobs} /><span className="mt-4 text-sm font-semibold text-brand-primary">작업 상세 보기 →</span></Link>
        <Link className={cardClass} to={detail('costs')}><span className="text-sm font-semibold text-ink-muted">앱 기록 추정 비용</span><strong className={`mt-3 break-all text-3xl font-bold tabular-nums ${costs.status === 'error' || costs.status === 'forbidden' ? 'text-danger' : 'text-ink'}`}>{costValue}</strong>{(containsTestData || costNote) && <span className="mt-2 text-sm leading-6 text-ink-muted">{[containsTestData && '테스트 기록 포함', costNote].filter(Boolean).join(' · ')}</span>}<span className="mt-1 text-xs leading-5 text-ink-muted">{costs.status === 'ready' ? `${costs.data.from} ~ ${costs.data.to} UTC` : '이번 달 · UTC'}</span><SourceTime state={costs} /><span className="mt-4 text-sm font-semibold text-brand-primary">비용 상세 보기 →</span></Link>
      </nav>
    </section>

    <section aria-label="날짜별 요청 추세" className="rounded-xl border border-line bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><EvaluationHelp label="요청 추세" title={<h2 className="m-0 text-lg font-bold text-ink">최근 요청 추세</h2>}><p className="m-0">막대는 기록된 요청 수와 그중 서버 오류를 보여줍니다. 최신 날짜부터 정렬하며, 기록이 없는 날짜를 0건으로 계산하지 않습니다.</p></EvaluationHelp><p className="mt-1 mb-0 text-sm leading-6 text-ink-muted">최근 7일 · UTC</p></div><Link to={detail('requests')} className="min-h-11 content-center text-sm font-semibold text-brand-primary underline underline-offset-4">요청 상세 보기</Link></div>
      {daily.status === 'loading' ? <p role="status" className="mt-4 text-sm text-ink-muted">날짜별 기록을 불러오는 중…</p>
        : daily.status === 'error' ? <p role="alert" className="mt-4 text-sm text-danger">날짜별 기록을 불러오지 못했습니다. <button type="button" onClick={() => setRevision((value) => value + 1)} className="font-bold underline">다시 조회</button></p>
          : <DailyTrend data={daily.data} />}
    </section>

    <section aria-label="다른 확인 방법" className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line bg-white p-5">
      <h2 className="m-0 text-base font-bold text-ink">실행 확인</h2>
      <div className="flex flex-wrap gap-4 text-sm font-semibold"><Link to={detail('traces')} className="min-h-11 content-center text-brand-primary underline underline-offset-4">추적 연결 현황</Link>{!isExample && <Link to="/ops/traces" className="min-h-11 content-center text-brand-primary underline underline-offset-4">개별 실행 조사</Link>}</div>
    </section>
  </>
}

function DailyTrend({ data }: { data: Daily }) {
  const byDay = new Map(data.days.map((day) => [day.date, day.features.reduce((sum, row) => ({ requests: sum.requests + row.total, errors: sum.errors + row.serverErrors }), { requests: 0, errors: 0 })]))
  const dates: string[] = []
  for (let day = Date.parse(`${data.from}T00:00:00Z`); day <= Date.parse(`${data.to}T00:00:00Z`); day += 86_400_000) dates.push(new Date(day).toISOString().slice(0, 10))
  const largest = Math.max(1, ...Array.from(byDay.values(), (row) => row.requests))
  return <div className="mt-5"><div className="flex flex-wrap gap-4 text-xs text-ink-muted" aria-label="차트 범례"><span><span aria-hidden="true" className="mr-1 inline-block h-2 w-2 rounded-full bg-[#9ac7a7]" />요청</span><span><span aria-hidden="true" className="mr-1 inline-block h-2 w-2 rounded-full bg-danger" />서버 오류</span></div><ol className="mt-4 grid list-none gap-3 p-0">{dates.reverse().map((date) => {
    const total = byDay.get(date)
    return <li key={date} className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 text-sm sm:grid-cols-[6.5rem_minmax(0,1fr)_12rem]"><time dateTime={date} className="text-xs font-semibold tabular-nums text-ink-muted">{date}</time>{total ? <><div className="h-3 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true"><div className="flex h-full justify-end rounded-full bg-[#9ac7a7]" style={{ width: `${total.requests / largest * 100}%` }}>{total.requests > 0 && <span className="h-full bg-danger" style={{ width: `${total.errors / total.requests * 100}%` }} />}</div></div><span className="col-span-2 text-xs text-ink-muted sm:col-span-1">요청 <strong className="tabular-nums text-ink">{total.requests.toLocaleString('ko-KR')}건</strong> · 오류 <strong className={total.errors ? 'tabular-nums text-danger' : 'tabular-nums text-ink'}>{total.errors.toLocaleString('ko-KR')}건</strong></span></> : <span className="text-xs text-ink-muted sm:col-span-2">기록 없음</span>}</li>
  })}</ol></div>
}
