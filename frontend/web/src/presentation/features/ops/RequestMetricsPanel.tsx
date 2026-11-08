import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { workspacePageStyles as styles } from '../../shared/workspace/WorkspacePage.styles'
import { EvaluationHelp } from './EvaluationHelp'
import { useMonitoringDemo } from './MonitoringDemoContext'
import { createMonitoringRequest, MonitoringResponseError, monitoringFailureMessage, requireMonitoringResponse } from './monitoringRequest'

const count = z.number().int().nonnegative()
const upper = z.number().finite().nonnegative().nullable()
const featureSchema = z.object({
  feature: z.string().min(1), total: count, success: count, accepted: count, clientErrors: count,
  serverErrors: count, other: count, latencySamples: count, p50UpperMs: upper, p95UpperMs: upper,
}).refine((row) => row.total === row.success + row.accepted + row.clientErrors + row.serverErrors + row.other
  && row.latencySamples <= row.total)
const responseSchema = z.object({ from: z.iso.date(), to: z.iso.date(), scope: z.literal('core-http-requests'), features: z.array(featureSchema) })
type Result = z.infer<typeof responseSchema>
const dailySchema = z.object({ from: z.iso.date(), to: z.iso.date(), scope: z.literal('core-http-requests'), days: z.array(z.object({ date: z.iso.date(), features: z.array(featureSchema) })) })
  .refine((data) => new Set(data.days.map((day) => day.date)).size === data.days.length
    && data.days.every((day) => day.date >= data.from && day.date <= data.to && day.features.length > 0
      && new Set(day.features.map((feature) => feature.feature)).size === day.features.length))
type Daily = z.infer<typeof dailySchema>
export type RequestMetricsSummary =
  | { status: 'loading' | 'error' | 'empty' }
  | { status: 'ready'; total: number; serverErrors: number; from: string; to: string }
const labels: Record<string, string> = {
  AI_SEARCH: '공고 검색', EVIDENCE_QUESTION: '공고 근거 답변', SEARCH_CONVERSATION: '검색 대화',
  ASSISTANT: 'AI 도우미', GOV_AGENT: '관리자 에이전트', APPLICATION_DISCOVERY: '신청 양식 탐색',
  APPLICATION_SECTION: '신청서 문항 작성', APPLICATION_DOCUMENT: '신청 문서 생성', COMBINATION_REVIEW: '중복 지원 검토',
}

function duration(value: number | null, samples: number): string {
  if (!samples) return '미측정'
  return value === null ? '120초 초과' : `${(value / 1000).toLocaleString('ko-KR', { maximumFractionDigits: 3 })}초 이하`
}

export function RequestMetricsPanel({ onExpired, onSummaryChange, detailPage = false }: { onExpired: () => void; onSummaryChange?: (summary: RequestMetricsSummary) => void; detailPage?: boolean }) {
  const { isExample, monitoringFetch } = useMonitoringDemo()
  const [days, setDays] = useState('7')
  const [range, setRange] = useState('7')
  const [asOf, setAsOf] = useState(() => new Date())
  const [data, setData] = useState<Result | null>(null)
  const [error, setError] = useState('')
  const [daily, setDaily] = useState<Daily | null>(null)
  const [dailyError, setDailyError] = useState('')
  const [dailyOpen, setDailyOpen] = useState(detailPage)
  const [featureOpen, setFeatureOpen] = useState(detailPage)
  const [dailyRevision, setDailyRevision] = useState(0)
  const expiry = useRef(onExpired); expiry.current = onExpired
  const report = useRef(onSummaryChange); report.current = onSummaryChange
  const totals = data?.features.reduce((acc, row) => ({
    requests: acc.requests + row.total,
    serverErrors: acc.serverErrors + row.serverErrors,
    accepted: acc.accepted + row.accepted,
  }), { requests: 0, serverErrors: 0, accepted: 0 })
  useEffect(() => {
    const request = createMonitoringRequest()
    const today = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate())
    const from = new Date(today - (Number(range) - 1) * 86_400_000).toISOString().slice(0, 10)
    const to = new Date(today).toISOString().slice(0, 10)
    const query = new URLSearchParams({ from, to })
    setData(null); setError(''); report.current?.({ status: 'loading' })
    monitoringFetch(`/api/v1/admin/ai-request-metrics?${query}`, { credentials: 'same-origin', cache: 'no-store', signal: request.signal })
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) { expiry.current(); return }
        requireMonitoringResponse(response)
        const parsed = responseSchema.safeParse(await response.json().catch(() => { throw new MonitoringResponseError('invalid') }))
        if (!parsed.success || parsed.data.from !== from || parsed.data.to !== to) throw new MonitoringResponseError('invalid')
        if (request.isActive()) {
          setData(parsed.data)
          const total = parsed.data.features.reduce((sum, row) => sum + row.total, 0)
          const serverErrors = parsed.data.features.reduce((sum, row) => sum + row.serverErrors, 0)
          report.current?.(total ? { status: 'ready', total, serverErrors, from, to } : { status: 'empty' })
        }
      }).catch((reason: unknown) => { if (request.isActive()) { setError(monitoringFailureMessage(reason, '요청 현황을')); report.current?.({ status: 'error' }) } }).finally(request.finish)
    return request.cancel
  }, [range, asOf, monitoringFetch])
  useEffect(() => {
    if (!dailyOpen) return
    const request = createMonitoringRequest()
    const today = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate())
    const from = new Date(today - (Number(range) - 1) * 86_400_000).toISOString().slice(0, 10)
    const to = new Date(today).toISOString().slice(0, 10)
    const query = new URLSearchParams({ from, to })
    setDaily(null); setDailyError('')
    monitoringFetch(`/api/v1/admin/ai-request-metrics/daily?${query}`, { credentials: 'same-origin', cache: 'no-store', signal: request.signal })
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) { expiry.current(); return }
        requireMonitoringResponse(response)
        const parsed = dailySchema.safeParse(await response.json().catch(() => { throw new MonitoringResponseError('invalid') }))
        if (!parsed.success || parsed.data.from !== from || parsed.data.to !== to) throw new MonitoringResponseError('invalid')
        if (request.isActive()) setDaily(parsed.data)
      }).catch((reason: unknown) => { if (request.isActive()) setDailyError(monitoringFailureMessage(reason, '날짜별 기록을')) }).finally(request.finish)
    return request.cancel
  }, [range, asOf, dailyOpen, dailyRevision, monitoringFetch])
  return <section className={`${styles.card} min-w-0`} aria-label="AI 기능 HTTP 요청 집계">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-2xl">
        <EvaluationHelp label="요청 현황" title={<h2 className="m-0 text-lg font-bold tracking-tight text-ink">요청 현황</h2>}>
          Core에서 기록한 HTTP 응답을 UTC 날짜로 집계합니다. 저장 실패·프로세스 종료나 Core 도착 전의 실패는 빠질 수 있으며 평가 요청이 포함될 수 있습니다. 최근 요청은 잠시 후 반영될 수 있습니다. 요청 오류는 입력·로그인 오류 등을, 서버 오류는 서비스 처리 실패를 포함합니다. 기록이 AI 모델 호출을 뜻하지는 않습니다.
        </EvaluationHelp>
        {isExample && <p className="mt-2 mb-0 text-xs font-bold text-warning">예시 데이터 · 실제 기록 아님</p>}
      </div>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); setRange(days); setAsOf(new Date()) }}>
        <label className="grid gap-1 text-xs font-semibold text-ink-muted">확인 기간<select value={days} onChange={(event) => setDays(event.target.value)} className="min-h-11 rounded-xl border border-line bg-white px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-brand-primary">
          <option value="1">오늘 (UTC)</option><option value="7">최근 7일 (UTC)</option><option value="30">최근 30일 (UTC)</option>
        </select></label>
        <button className={styles.secondaryButton}>요청 현황 보기</button>
      </form>
    </div>
    {error ? <div className="rounded-xl border border-[#f0c7cb] bg-danger-soft p-4 text-sm text-danger" role="alert"><p className="m-0">{error}</p><button className="mt-2 min-h-10 font-bold underline focus-visible:outline-2 focus-visible:outline-danger" type="button" onClick={() => setAsOf(new Date())}>다시 조회</button></div> : !data ? <p className="text-sm text-ink-muted" role="status">요청 현황을 불러오고 있습니다.</p> : <>
      <p className="m-0 text-xs leading-5 text-ink-muted">{data.from} ~ {data.to} (UTC) · 저장된 요청 기준입니다. 일부 요청은 빠지거나 평가 요청이 포함될 수 있습니다.</p>
      {!data.features.length ? <div className="rounded-xl border border-dashed border-[#bed4c4] bg-[#f6faf7] p-5"><p className="m-0 text-sm font-bold text-ink">이 기간에 저장된 요청 기록이 없습니다.</p><p className="mt-1 mb-0 text-sm leading-6 text-ink-muted">AI 기능을 사용한 요청이 없었거나 기록되지 않았을 수 있어요. 다른 기간도 확인해 보세요.</p></div> : <>
        <dl className="grid grid-cols-1 gap-4 border-y border-line py-4 sm:grid-cols-3" aria-label="요청 요약">
          <SummaryMetric label="기록된 요청" value={`${totals!.requests.toLocaleString('ko-KR')}건`} note="서비스가 기록한 응답" />
          <SummaryMetric label="서버 오류" value={`${totals!.serverErrors.toLocaleString('ko-KR')}건`} note={totals!.requests ? `기록된 요청의 ${(totals!.serverErrors * 100 / totals!.requests).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}%` : '분모가 없어 비율을 계산할 수 없습니다'} attention={totals!.serverErrors > 0} />
          <SummaryMetric label="작업 접수" value={`${totals!.accepted.toLocaleString('ko-KR')}건`} note="완료 여부는 작업 결과에서 확인" />
        </dl>
        <p className="m-0 text-xs leading-5 text-ink-muted">접수(202)는 작업 완료가 아닙니다.</p>
        <details open={featureOpen} onToggle={(event) => setFeatureOpen(event.currentTarget.open)} className="border-t border-line pt-3">
          <summary className="min-h-11 cursor-pointer content-center text-sm font-bold text-brand-primary focus-visible:outline-2 focus-visible:outline-brand-primary">기능별 요청과 응답 시간 보기</summary>
          <div className="divide-y divide-line border-y border-line">
          {data.features.map((row) => <article key={row.feature} className="min-w-0 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="m-0 text-base font-bold text-ink">{labels[row.feature] ?? row.feature}</h3><p className="m-0 text-sm text-ink-muted">기록된 요청 {row.total.toLocaleString('ko-KR')}건</p></div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
              <Metric label="정상 응답" value={`${row.success.toLocaleString('ko-KR')}건`} />
              <Metric label="접수" value={`${row.accepted.toLocaleString('ko-KR')}건`} />
              <Metric label="요청 오류 (4xx)" value={`${row.clientErrors.toLocaleString('ko-KR')}건`} />
              <Metric label="서버 오류 (5xx)" value={`${row.serverErrors.toLocaleString('ko-KR')}건`} attention={row.serverErrors > 0} />
            </dl>
            <div className="mt-4 rounded-xl bg-surface-muted p-3">
              <div className="grid gap-3 text-sm leading-6 sm:grid-cols-3">
                <p className="m-0 text-ink-muted">서버 오류 비율 <strong className={`block text-lg tabular-nums ${row.serverErrors > 0 ? 'text-danger' : 'text-ink'}`}>{row.total ? `전체 기록 중 ${(row.serverErrors * 100 / row.total).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}%` : '오류 비율 미측정'}</strong></p>
                <p className="m-0 text-ink-muted">절반의 요청 <strong className="block text-lg tabular-nums text-ink">{duration(row.p50UpperMs, row.latencySamples)}</strong></p>
                <p className="m-0 text-ink-muted">대부분의 요청 <strong className="block text-lg tabular-nums text-ink">{duration(row.p95UpperMs, row.latencySamples)}</strong></p>
              </div>
              <p className="mt-2 mb-0 text-xs leading-5 text-ink-muted">시간 기록 {row.latencySamples.toLocaleString('ko-KR')}건 · 50%, 95% 구간 상한 근삿값</p>
              {row.other > 0 && <p className="mt-1 mb-0 text-xs text-ink-muted">그 밖의 응답 {row.other.toLocaleString('ko-KR')}건</p>}
            </div>
          </article>)}
          </div>
        </details>
      </>}
    </>}
    <details open={dailyOpen} className="border-t border-line pt-3" onToggle={(event) => setDailyOpen(event.currentTarget.open)}>
      <summary className="min-h-10 cursor-pointer content-center text-sm font-bold text-brand-primary focus-visible:outline-2 focus-visible:outline-brand-primary">날짜별 요청 기록 보기</summary>
      <p className="mt-1 text-sm leading-6 text-ink-muted">UTC 기준 · 기록 없음은 요청이 없었다는 뜻이 아닙니다.</p>
      {dailyError ? <div role="alert" className="mt-3 text-sm text-danger"><p>{dailyError}</p><button type="button" className="min-h-10 font-bold underline" onClick={() => setDailyRevision((value) => value + 1)}>날짜별 기록 다시 조회</button></div> : !daily ? <p role="status" className="mt-3 text-sm">날짜별 기록을 불러오고 있습니다.</p> : <DailyTable data={daily} />}
    </details>
  </section>
}

function SummaryMetric({ label, value, note, attention = false }: { label: string; value: string; note: string; attention?: boolean }) {
  return <div className="min-w-0"><dt className="text-xs font-semibold text-ink-muted">{label}</dt><dd className={`mt-1 text-2xl font-bold tabular-nums tracking-tight ${attention ? 'text-danger' : 'text-ink'}`}>{value}</dd><dd className="mt-1 text-xs leading-5 text-ink-muted">{note}</dd></div>
}

function Metric({ label, value, attention = false }: { label: string; value: string; attention?: boolean }) {
  return <div><dt className="text-xs text-ink-muted">{label}</dt><dd className={`mt-1 text-sm font-bold tabular-nums ${attention ? 'text-danger' : 'text-ink'}`}>{value}</dd></div>
}

function DailyTable({ data }: { data: Daily }) {
  const dates: string[] = []
  for (let day = Date.parse(`${data.from}T00:00:00Z`); day <= Date.parse(`${data.to}T00:00:00Z`); day += 86_400_000) dates.push(new Date(day).toISOString().slice(0, 10))
  const byDay = new Map(data.days.map((day) => [day.date, day.features]))
  const dailyTotals = new Map(data.days.map((day) => [day.date, day.features.reduce((total, row) => ({ requests: total.requests + row.total, errors: total.errors + row.serverErrors }), { requests: 0, errors: 0 })]))
  const largest = Math.max(1, ...Array.from(dailyTotals.values(), (total) => total.requests))
  const orderedDates = dates.toReversed()
  return <>
    <section className="mt-3 rounded-xl border border-line bg-surface-muted p-4" aria-label="날짜별 요청 추세">
      <h3 className="m-0 text-sm font-bold text-ink">날짜별 전체 요청과 서버 오류</h3>
      <p className="mt-1 mb-0 text-xs leading-5 text-ink-muted">전체 요청 막대 안의 빨간 부분은 서버 오류입니다. 막대 길이는 이 기간의 가장 많은 요청 수를 기준으로 합니다.</p>
      <div className="mt-3 max-h-80 overflow-y-auto focus-visible:outline-2 focus-visible:outline-brand-primary" role="region" aria-label="날짜별 요청 추세 스크롤" tabIndex={0}>
        <ol className="m-0 grid list-none gap-2 p-0">{orderedDates.map((date) => {
          const total = dailyTotals.get(date)
          return <li key={date} className="grid grid-cols-[6.5rem_1fr] items-center gap-x-2 gap-y-1 text-xs sm:grid-cols-[6.5rem_minmax(4rem,1fr)_auto]">
            <time dateTime={date} className="font-semibold tabular-nums text-ink">{date}</time>
            {total ? <>
              <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-white"><div className="flex h-full justify-end rounded-full bg-[#b9d6c1]" style={{ width: `${total.requests / largest * 100}%` }}>{total.requests > 0 && <span className="h-full bg-danger" style={{ width: `${total.errors / total.requests * 100}%` }} />}</div></div>
              <span className="col-span-2 text-ink-muted sm:col-span-1">요청 <strong className="tabular-nums text-ink">{total.requests.toLocaleString('ko-KR')}건</strong> · 서버 오류 <strong className={`tabular-nums ${total.errors > 0 ? 'text-danger' : 'text-ink'}`}>{total.errors.toLocaleString('ko-KR')}건</strong></span>
            </> : <span className="text-ink-muted sm:col-span-2">기록 없음</span>}
          </li>
        })}</ol>
      </div>
    </section>
    <div className="mt-3 overflow-x-auto focus-visible:outline-2 focus-visible:outline-brand-primary" role="region" aria-label="날짜별 요청 표 가로 스크롤" tabIndex={0}><table className="w-full min-w-[640px] text-left text-sm tabular-nums">
    <caption className="sr-only">날짜와 기능별 기록된 요청 및 오류</caption>
    <thead><tr className="border-b border-line text-ink-muted"><th className="p-2">날짜 (UTC)</th><th className="p-2">기능</th><th className="p-2">기록된 요청</th><th className="p-2">접수</th><th className="p-2">요청 오류</th><th className="p-2">서버 오류</th><th className="p-2">느린 요청 기준</th></tr></thead>
    <tbody>{orderedDates.flatMap((date) => {
      const features = byDay.get(date)
      if (!features) return [<tr key={date} className="border-b border-line"><th scope="row" className="p-2 font-normal">{date}</th><td colSpan={6} className="p-2 text-ink-muted">기록 없음</td></tr>]
      return features.map((row) => <tr key={`${date}:${row.feature}`} className="border-b border-line"><th scope="row" className="p-2 font-normal">{date}</th><td className="p-2">{labels[row.feature] ?? row.feature}</td><td className="p-2">{row.total.toLocaleString('ko-KR')}건</td><td className="p-2">{row.accepted.toLocaleString('ko-KR')}건</td><td className="p-2">{row.clientErrors.toLocaleString('ko-KR')}건</td><td className="p-2">{row.serverErrors.toLocaleString('ko-KR')}건</td><td className="p-2">{duration(row.p95UpperMs, row.latencySamples)}</td></tr>)
    })}</tbody>
  </table><p className="mt-2 text-xs text-ink-muted">느린 요청 기준은 상위 5%를 제외한 요청이 끝난 시간의 구간 상한입니다. 값은 실제 시간의 근삿값입니다.</p></div>
  </>
}
