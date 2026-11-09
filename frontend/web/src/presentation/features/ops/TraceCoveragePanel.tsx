import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { workspacePageStyles as styles } from '../../shared/workspace/WorkspacePage.styles'
import { MonitoringHelp } from './MonitoringHelp'
import { useMonitoringDemo } from './MonitoringDemoContext'
import { createMonitoringRequest, MonitoringResponseError, monitoringFailureMessage, requireMonitoringResponse } from './monitoringRequest'

const count = z.number().int().nonnegative()
const rowSchema = z.object({ feature: z.string().nullish(), calls: count, linkedCalls: count })
  .refine((row) => row.linkedCalls <= row.calls)
const coverageSchema = z.object({ from: z.iso.date(), to: z.iso.date(), features: z.array(rowSchema) })
type Coverage = z.infer<typeof coverageSchema>
const names: Record<string, string> = {
  AI_SEARCH: '공고 검색', EVIDENCE_QUESTION: '공고 근거 답변', APPLICATION_DRAFT: '신청서 초안',
  COMBINATION_REVIEW: '중복 지원 검토', ASSISTANT: 'AI 도우미', DAILY_REPORT: '일일 리포트',
  SAVED_PROGRAM_PREFETCH: '관심 공고 준비', GOV_AGENT: '관리자 에이전트',
}

/** 앱 사용량에 추적 식별자가 기록된 범위만 확인합니다. */
export function TraceCoveragePanel({ onExpired }: { onExpired: () => void }) {
  const { isExample, monitoringFetch } = useMonitoringDemo()
  const [days, setDays] = useState('7')
  const [revision, setRevision] = useState(0)
  const [data, setData] = useState<Coverage | null>(null)
  const [error, setError] = useState('')
  const expiry = useRef(onExpired); expiry.current = onExpired

  useEffect(() => {
    const request = createMonitoringRequest()
    const now = new Date()
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    const from = new Date(today - (Number(days) - 1) * 86_400_000).toISOString().slice(0, 10)
    const to = new Date(today).toISOString().slice(0, 10)
    const query = new URLSearchParams({ from, to })
    setData(null); setError('')
    monitoringFetch(`/api/v1/admin/ai-costs/trace-coverage?${query}`, {
      credentials: 'same-origin', cache: 'no-store', signal: request.signal,
    }).then(async (response) => {
      if (response.status === 401 || response.status === 403) { expiry.current(); return }
      requireMonitoringResponse(response)
      const parsed = coverageSchema.safeParse(await response.json().catch(() => { throw new MonitoringResponseError('invalid') }))
      if (!parsed.success || parsed.data.from !== from || parsed.data.to !== to) throw new MonitoringResponseError('invalid')
      if (request.isActive()) setData(parsed.data)
    }).catch((reason: unknown) => { if (request.isActive()) setError(monitoringFailureMessage(reason, '추적 연결 현황을')) }).finally(request.finish)
    return request.cancel
  }, [days, revision, monitoringFetch])

  const recorded = data?.features.reduce((total, row) => total + row.calls, 0) ?? 0
  const linked = data?.features.reduce((total, row) => total + row.linkedCalls, 0) ?? 0
  const withoutTraceId = recorded - linked

  return <section className={`${styles.card} min-w-0`} aria-label="추적 연결 현황">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <MonitoringHelp label="추적 번호 저장 현황" title={<h3 className="m-0 text-base font-bold text-ink">추적 번호 저장 현황</h3>}>앱에 기록된 AI 호출 중 추적 번호가 저장된 건수와 기록되지 않은 건수를 비교합니다. 번호가 없는 이유는 이 화면에서 구분할 수 없습니다.</MonitoringHelp>
      <label className="grid gap-1 text-xs font-semibold text-ink-muted">연결 현황 기간 (UTC)<select value={days} onChange={(event) => setDays(event.target.value)} className="min-h-11 rounded-xl border border-line bg-white px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-brand-primary"><option value="1">오늘</option><option value="7">최근 7일</option><option value="30">최근 30일</option></select></label>
    </div>
    {isExample && <p role="status" className="m-0 rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-950">예시 데이터 · 실제 추적 연결 현황이 아닙니다.</p>}
    <p className="m-0 text-xs leading-5 text-ink-muted">추적 번호가 저장돼도 추적 서버에 도착했는지는 별도입니다. 앱에 기록되지 않은 호출과 사용자 요청 전체는 이 숫자에 포함되지 않습니다.</p>
    {error ? <p className="text-sm text-danger" role="alert">{error} <button type="button" className="font-bold underline" onClick={() => setRevision((value) => value + 1)}>다시 조회</button></p>
      : !data ? <p role="status" className="text-sm text-ink-muted">연결 현황을 불러오고 있습니다.</p>
        : data.features.length === 0 ? <div className="rounded-xl border border-dashed border-line bg-surface-muted p-4"><p className="m-0 text-sm font-semibold text-ink">선택한 기간에 기록된 앱 호출이 없습니다.</p><p className="mt-1 mb-0 text-sm leading-6 text-ink-muted">실제 호출이 없었다는 뜻은 아닙니다. 기간을 바꿔 다시 확인해 보세요.</p></div>
          : <>
            <div className="rounded-xl bg-surface-muted p-4">
              <p className="m-0 text-xs text-ink-muted">{data.from} ~ {data.to} UTC · 앱 기록 기준</p>
              <dl className="mt-3 mb-0 grid grid-cols-1 gap-4 sm:grid-cols-3" aria-label="추적 번호 저장 요약">
                <div><dt className="text-sm text-ink-muted">기록된 AI 호출</dt><dd className="mt-1 mb-0 text-xl font-bold tabular-nums text-ink">{recorded.toLocaleString('ko-KR')}건</dd></div>
                <div><dt className="text-sm text-ink-muted">추적 번호 저장</dt><dd className="mt-1 mb-0 text-xl font-bold tabular-nums text-ink">{linked.toLocaleString('ko-KR')}건</dd></div>
                <div><dt className="text-sm text-ink-muted">추적 번호 미기록</dt><dd className="mt-1 mb-0 text-xl font-bold tabular-nums text-ink">{withoutTraceId.toLocaleString('ko-KR')}건</dd></div>
              </dl>
              {withoutTraceId > 0 && <p className="mt-2 mb-0 text-xs leading-5 text-ink-muted">미기록 원인은 확인할 수 없습니다. 기능별 추적 지원과 수집 설정을 확인하세요.</p>}
            </div>
            <div className="overflow-x-auto" role="region" aria-label="기능별 추적 번호 기록 표" tabIndex={0}><table className="w-full min-w-[520px] text-left text-sm">
              <caption className="sr-only">기능별 기록된 호출과 추적 번호가 저장되거나 기록되지 않은 호출</caption>
              <thead><tr className="border-b border-line text-xs text-ink-muted"><th scope="col" className="py-2 pr-4">기능</th><th scope="col" className="py-2 pr-4">앱에 기록된 호출</th><th scope="col" className="py-2 pr-4">추적 번호 저장</th><th scope="col" className="py-2">번호 미기록</th></tr></thead>
              <tbody>{data.features.map((row) => <tr key={row.feature ?? 'unattributed'} className="border-b border-line"><th scope="row" className="py-3 pr-4 font-medium text-ink">{row.feature ? names[row.feature] ?? row.feature : '기능 미기록'}</th><td className="py-3 pr-4 tabular-nums">{row.calls.toLocaleString('ko-KR')}건</td><td className="py-3 pr-4 tabular-nums">{row.linkedCalls.toLocaleString('ko-KR')}건</td><td className="py-3 tabular-nums">{(row.calls - row.linkedCalls).toLocaleString('ko-KR')}건</td></tr>)}</tbody>
            </table></div>
          </>}
  </section>
}
