import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { getBudgetReservations, getRunBudget, OpsApiError, type BudgetBreakdown, type BudgetPage, type RunBudget } from '../../../data/ops/opsApi'
import { workspacePageStyles as styles } from '../../shared/workspace/WorkspacePage.styles'
import { UnaccountedRunsPanel } from './UnaccountedRunsPanel'
import { BudgetLimitsForm } from './BudgetLimitsForm'
import { DailyBudgetPanel } from './DailyBudgetPanel'
import { DailyBudgetLimitsForm } from './DailyBudgetLimitsForm'
import { displayBudgetChangeReason } from './budgetChangeReason'
import { EvaluationHelp } from './EvaluationHelp'

const date = (value: string) => new Date(value).toLocaleString('ko-KR')
const count = (value: number) => value.toLocaleString('ko-KR')
const inputCount = (value: number | null | undefined) => value == null ? '미확인·미설정' : `${count(value)}토큰`
const message = (error: unknown) => error instanceof Error ? error.message : '예산 장부를 불러오지 못했습니다.'

function RunUsageHelp({ label, text }: { label: string; text: string }) {
  return <details className="relative shrink-0 text-sm">
    <summary aria-label={`${label} 도움말`} className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary [&::-webkit-details-marker]:hidden"><span aria-hidden="true" className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-brand-primary text-sm font-semibold text-brand-primary">?</span></summary>
    <p className="absolute right-0 top-11 z-20 w-64 max-w-[calc(100vw-5rem)] rounded-xl border border-line bg-white p-4 text-sm leading-6 text-ink shadow-lg [overflow-wrap:anywhere]">{text}</p>
  </details>
}

function Breakdown({ value }: { value: BudgetBreakdown }) {
  const boundedCalls = value.unbounded_input_calls === 0
  const boundedReservations = value.unbounded_input_reservations === 0
  const rows = [
    { label: '확인된 사용량', description: '응답 기록에서 확인한 양이에요.', calls: value.settled_calls, input: value.confirmed_input_tokens, output: value.confirmed_output_tokens },
    ...(value.legacy_calls || value.legacy_input_tokens || value.legacy_output_tokens ? [{ label: '이전 기록에서 확인한 사용량', description: '과거에 저장한 답변에서 확인한 양이에요.', calls: value.legacy_calls!, input: value.legacy_input_tokens, output: value.legacy_output_tokens! }] : []),
    { label: '사용량 확인이 필요한 요청', description: '요청의 전송 여부나 사용량을 확인하지 못해 최대량을 남겨뒀어요.', help: '요청 승인이 실제 전송이나 사용을 뜻하지는 않아요. 확인되지 않은 요청의 출력 최대량은 정리 후에도 남고, 입력 한도가 있으면 입력 최대량도 남아요.', calls: value.unknown_calls, input: boundedCalls ? value.unknown_input_tokens : null, output: value.unknown_output_tokens },
    { label: '아직 요청하지 않은 양', description: '아직 승인하지 않은 AI 요청을 위해 확보한 양이에요.', calls: value.unapproved_calls, input: boundedReservations ? value.unapproved_input_tokens : null, output: value.unapproved_output_tokens },
    { label: '정리 후 돌려놓을 양', description: '사용량 확인 후 남아 한도 정리 때 돌려놓을 양이에요.', calls: null, input: boundedReservations ? value.pending_release_input_tokens : null, output: value.pending_release_output_tokens },
    { label: '한도에 반영된 전체', description: '확인된 사용량과 아직 정리되지 않은 양을 합쳤어요.', calls: value.allocated_calls, input: boundedCalls && boundedReservations ? value.allocated_input_tokens : null, output: value.allocated_output_tokens },
  ]
  return <div className="divide-y divide-line">{rows.map((row) => <section key={row.label} aria-label={row.label} className="min-w-0 py-4 text-sm first:pt-0 last:pb-0">
    <div className="flex min-w-0 items-center justify-between gap-2"><h4 className="font-semibold">{row.label}</h4>{row.help && <RunUsageHelp label={row.label} text={row.help} />}</div>
    <p className="mt-1 leading-6 text-ink-muted">{row.description}</p>
    <dl className="mt-3 grid grid-cols-3 gap-2">{[
      ['AI 요청', row.calls === null ? '해당 없음' : `${count(row.calls)}회`],
      ['AI에 보내는 양', row.input == null ? '확인할 수 없음' : inputCount(row.input)], ['AI가 만드는 양', `${count(row.output)}토큰`],
    ].map(([label, amount]) => <div key={label} className="min-w-0"><dt className="text-xs text-ink-muted">{label}</dt><dd className="mt-1 font-semibold [overflow-wrap:anywhere]">{amount}</dd></div>)}</dl>
  </section>)}</div>
}

function OverviewBreakdown({ value }: { value: BudgetBreakdown }) {
  const boundedCalls = value.unbounded_input_calls === 0
  const boundedReservations = value.unbounded_input_reservations === 0
  const tokens = (amount: number | null | undefined) => amount == null ? '확인할 수 없음' : `${count(amount)}토큰`
  const rows = [
    { label: '확정 사용량', help: '응답 기록에서 확인한 사용량입니다. 실제 청구 금액과는 다를 수 있습니다.', calls: `${count(value.settled_calls)}회`, input: tokens(value.confirmed_input_tokens), output: tokens(value.confirmed_output_tokens) },
    ...(value.legacy_calls ? [{ label: '과거 저장 응답 반영', help: '과거 평가의 저장된 응답에서 확인해 한도에 반영한 사용량입니다.', calls: `${count(value.legacy_calls)}회`, input: tokens(value.legacy_input_tokens), output: tokens(value.legacy_output_tokens) }] : []),
    { label: '승인 후 사용량 미확인', help: 'AI 요청은 승인됐지만 전송 여부나 사용량을 확인하지 못해 예약을 유지한 양입니다.', calls: `${count(value.unknown_calls)}회`, input: tokens(boundedCalls ? value.unknown_input_tokens : null), output: tokens(value.unknown_output_tokens) },
    { label: '아직 승인하지 않은 예약', help: '평가를 위해 확보했지만 개별 AI 요청은 아직 승인되지 않은 양입니다.', calls: `${count(value.unapproved_calls)}회`, input: tokens(boundedReservations ? value.unapproved_input_tokens : null), output: tokens(value.unapproved_output_tokens) },
    { label: '종료 전 반환 대기', help: '응답 정산 후 남은 양으로, 평가 예약을 닫을 때까지 한도에 포함됩니다.', calls: null, input: tokens(boundedReservations ? value.pending_release_input_tokens : null), output: tokens(value.pending_release_output_tokens) },
  ]
  return <div className="grid gap-2">{rows.map((row) => <section key={row.label} className="rounded-lg bg-white p-4">
    <div className="flex flex-wrap items-center gap-x-2">
      <h5 className="font-semibold text-ink">{row.label}</h5>
      <details className="relative text-xs text-ink-muted">
        <summary aria-label={`${row.label} 설명`} className="min-h-8 cursor-pointer py-2 font-medium focus-visible:outline-2 focus-visible:outline-brand-primary">도움말</summary>
        <p className="pb-2 leading-5">{row.help}</p>
      </details>
    </div>
    <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">{[
      ...(row.calls === null ? [] : [['AI 요청', row.calls]]),
      ['AI에 보내는 내용', row.input],
      ['AI 답변', row.output],
    ].map(([label, amount]) => <div key={label} className="min-w-0"><dt className="text-xs text-ink-muted">{label}</dt><dd className="mt-1 break-words font-semibold text-ink">{amount}</dd></div>)}</dl>
  </section>)}</div>
}

export function BudgetOverview({ onExpired, refreshKey, operatorId, onBudgetChanged }: {
  onExpired: () => void; refreshKey: number; operatorId?: string; onBudgetChanged?: () => void
}) {
  const [page, setPage] = useState(1)
  const [data, setData] = useState<BudgetPage | null>(null)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [showUnaccounted, setShowUnaccounted] = useState(false)
  const [showUsageDetails, setShowUsageDetails] = useState(false)
  const [saved, setSaved] = useState('')
  const expiry = useRef(onExpired); expiry.current = onExpired
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    setData(null); setError('')
    const read = async () => {
      let keepPolling = true
      try {
        const result = await getBudgetReservations(page, controller.signal)
        if (!controller.signal.aborted) { setData(result); setError('') }
      } catch (reason) {
        if (controller.signal.aborted) return
        if (reason instanceof OpsApiError && [401, 403].includes(reason.status)) {
          keepPolling = false; setData(null); expiry.current()
        } else setError(message(reason))
      } finally {
        if (!controller.signal.aborted && keepPolling) timer = setTimeout(() => void read(), 15_000)
      }
    }
    void read()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [page, refresh, refreshKey])
  const summary = data?.summary
  return <section id="evaluation-budget" tabIndex={-1} className={styles.card} aria-label="평가 예산">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="sr-only">평가 예산</h2><button type="button" className={styles.cardTextLink} onClick={() => setRefresh((value) => value + 1)}>예산 새로고침</button></div>
    <section aria-label="예산 설정 순서" className="rounded-2xl bg-brand-soft p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <h3 className="text-base font-bold text-ink">AI 평가 사용 한도</h3>
        <details className="relative">
          <summary aria-label="AI 평가 사용 한도 도움말" className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-line bg-white text-xs font-bold text-ink focus-visible:outline-2 focus-visible:outline-brand-primary">?</summary>
          <p className="absolute left-0 top-9 z-10 w-72 max-w-[calc(100vw-4rem)] rounded-xl border border-line bg-white p-4 text-sm leading-6 text-ink-muted shadow-lg">전체 한도는 날짜가 바뀌어도 유지됩니다. 하루 한도를 사용하면 전체와 하루 한도를 모두 충족해야 평가할 수 있습니다. 정기 평가에는 전체 입력 한도와 하루 한도가 모두 필요합니다. 금액 한도는 아닙니다. 남은 한도에서는 진행 중인 평가의 예약량을 제외하며, 미완료 예약은 다음 날로 이월될 수 있습니다.</p>
        </details>
      </div>
      {(!operatorId || error || !data || summary?.state === 'inconsistent' || !summary?.limits_revision) && <p className="mt-4 text-sm font-semibold text-brand-primary">{!operatorId ? '관리자에게 설정을 요청하세요.' : error ? '현재 상태를 확인하지 못했습니다. 예산을 새로고침해 주세요.' : !data ? '현재 상태를 확인하고 있습니다.' : summary?.state === 'inconsistent' ? '사용 기록이 맞지 않아 설정을 변경할 수 없습니다.' : '현재 서버에서 설정을 변경할 수 없습니다. 관리자에게 확인해 주세요.'}</p>}
      {data && summary && <div className="mt-4 grid gap-4">
        <section className="space-y-4 rounded-xl border border-line bg-white p-4 sm:p-5" aria-label="전체 사용 한도">
          <h3 className="text-base font-bold text-ink">전체 사용 한도</h3>
          {summary.state === 'inconsistent' && <p role="alert" className="text-sm leading-6 text-red-700">저장된 할당량과 상세 장부가 일치하지 않습니다. 잔여 한도를 확정할 수 없어 표시하지 않습니다.</p>}
          {summary.state === 'unconfigured' && <p role="status" className="text-sm font-semibold text-ink">아직 사용 한도를 설정하지 않았습니다.</p>}
          {summary.state !== 'unconfigured' && summary.input_state === 'unconfigured' && <p className="text-sm leading-6 text-amber-800">입력 한도가 설정되지 않았습니다. 검색·RAG 평가를 하려면 입력 한도도 설정해야 합니다.</p>}
          {summary.limits && summary.state === 'consistent' && summary.remaining && <>
            <section aria-label="남은 사용량" className="space-y-3">
              <h4 className="text-sm font-bold text-ink">지금 남은 한도</h4>
              <dl className="grid gap-2 sm:grid-cols-3">
                <div className="min-w-0 rounded-lg bg-brand-soft px-3 py-3"><dt className="text-xs text-ink-muted">AI 요청</dt><dd className="mt-1 break-words text-base font-bold text-ink">{count(summary.remaining.calls)}회</dd></div>
                <div className="min-w-0 rounded-lg bg-brand-soft px-3 py-3"><dt className="text-xs text-ink-muted">AI에 보내는 내용</dt><dd className="mt-1 break-words text-base font-bold text-ink">{summary.limits.input_tokens == null ? '설정되지 않음' : summary.remaining.input_tokens == null ? '확인할 수 없음' : inputCount(summary.remaining.input_tokens)}</dd></div>
                <div className="min-w-0 rounded-lg bg-brand-soft px-3 py-3"><dt className="text-xs text-ink-muted">AI 답변</dt><dd className="mt-1 break-words text-base font-bold text-ink">{count(summary.remaining.output_tokens)}토큰</dd></div>
              </dl>
              {summary.legacy_live_run_count > 0 && <p className="text-xs text-amber-800">확인되지 않은 이전 평가 사용량은 포함되지 않았습니다.</p>}
            </section>
            <section aria-label="설정된 전체 한도" className="space-y-3">
              <h4 className="text-sm font-semibold text-ink">설정된 전체 한도</h4>
              <dl className="grid gap-2 sm:grid-cols-3">
                <div className="min-w-0 rounded-lg bg-surface-muted px-3 py-3"><dt className="text-xs text-ink-muted">AI 요청</dt><dd className="mt-1 break-words text-sm font-semibold text-ink">{count(summary.limits.calls)}회</dd></div>
                <div className="min-w-0 rounded-lg bg-surface-muted px-3 py-3"><dt className="text-xs text-ink-muted">AI에 보내는 내용</dt><dd className="mt-1 break-words text-sm font-semibold text-ink">{summary.limits.input_tokens == null ? '미설정' : inputCount(summary.limits.input_tokens)}</dd></div>
                <div className="min-w-0 rounded-lg bg-surface-muted px-3 py-3"><dt className="text-xs text-ink-muted">AI 답변</dt><dd className="mt-1 break-words text-sm font-semibold text-ink">{count(summary.limits.output_tokens)}토큰</dd></div>
              </dl>
            </section>
          </>}
          {operatorId && <BudgetLimitsForm summary={summary} owner={operatorId} onExpired={onExpired} onSaved={() => { setSaved('누적 한도 변경 이력을 저장했습니다.'); setRefresh((value) => value + 1); onBudgetChanged?.() }} />}
        </section>
        <section aria-label="하루 예산 요약" className="space-y-4 rounded-xl border border-line bg-white p-4 sm:p-5">
          <EvaluationHelp label="하루 평가 한도" title={<h3 className="text-base font-bold text-ink">하루 평가 한도</h3>}><p>서울 시간 자정부터 다음 날 자정까지 적용됩니다. 정리되지 않은 이전 예약은 다음 날 한도에 포함될 수 있습니다.</p></EvaluationHelp>
          {!summary.daily ? <p className="text-sm">일별 예산 정보를 확인할 수 없습니다.</p>
            : summary.daily.state === 'disabled' ? <p className="text-sm">하루 한도 미설정 · 정기 평가에 필요</p>
            : summary.daily.state === 'unknown' ? <p role="alert" className="text-sm text-red-700">일별 사용량 미확인 · 신규 예약이 차단됩니다.</p>
            : summary.daily.state === 'exceeded' ? <p role="alert" className="text-sm text-red-700">일별 한도 초과 · 신규 예약이 차단됩니다.</p>
            : <p className="text-sm text-ink-muted">평가하려면 전체와 하루 한도가 모두 남아 있어야 합니다.</p>}
          {summary.daily?.state !== 'disabled' && summary.daily?.limits && <section aria-label="하루 남은 사용량" className="space-y-3">
            <h4 className="text-sm font-bold text-ink">남은 한도</h4>
            <dl className="grid gap-2 sm:grid-cols-3">{([
              ['AI 요청', summary.daily.state === 'enforced' ? summary.daily.remaining?.calls : null, summary.daily.limits.calls, '회'],
              ['AI에 보내는 내용', summary.daily.state === 'enforced' ? summary.daily.remaining?.input_tokens : null, summary.daily.limits.input_tokens, '토큰'],
              ['AI 답변', summary.daily.state === 'enforced' ? summary.daily.remaining?.output_tokens : null, summary.daily.limits.output_tokens, '토큰'],
            ] as const).map(([label, remaining, limit, unit]) => <div key={label} className="min-w-0 rounded-lg bg-surface-muted px-3 py-3"><dt className="text-xs text-ink-muted">{label}</dt><dd className="mt-1 break-words text-base font-bold text-ink">{remaining == null ? '확인할 수 없음' : `${count(remaining)}${unit}`}</dd><dd className="mt-1 text-xs text-ink-muted">한도 {count(limit)}{unit}</dd></div>)}</dl>
          </section>}
          {operatorId && !summary.limits && <p className="text-sm text-ink-muted">하루 한도를 설정하려면 먼저 전체 한도를 설정해 주세요.</p>}
          {operatorId && summary.limits && <DailyBudgetLimitsForm daily={summary.daily} owner={operatorId} onExpired={onExpired} onSaved={() => { setSaved('일별 정책 변경 이력을 저장했습니다.'); setRefresh((value) => value + 1); onBudgetChanged?.() }} />}
          {summary.daily && (summary.daily.state !== 'disabled' || summary.daily.recent_changes.length > 0) && <details><summary className="min-h-10 cursor-pointer py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-brand-primary">일별 예산 상세 보기</summary><DailyBudgetPanel value={summary.daily} hideSummary /></details>}
        </section>
        <section aria-label="사용·변경 내역" className="space-y-4 rounded-xl border border-line bg-white p-4 sm:p-5">
          <h3 className="text-base font-bold text-ink">사용·변경 내역</h3>
          <details open={showUsageDetails} className="rounded-xl bg-surface-muted px-4 text-sm">
            <summary onClick={(event) => { event.preventDefault(); setShowUsageDetails((value) => !value) }} className="min-h-11 cursor-pointer py-3 font-semibold focus-visible:outline-2 focus-visible:outline-brand-primary">사용·예약 내역</summary>
            <div className="grid gap-4 pb-4">
              <div>
                <p className="font-semibold">사용·예약 합계</p>
                <p className="mt-1 text-xs text-ink-muted">확인된 사용량과 아직 정리되지 않은 예약을 합친 값입니다. 실제 청구 금액은 아닙니다.</p>
                {summary.allocated && summary.state !== 'inconsistent' ? <dl className="mt-3 grid gap-2 sm:grid-cols-3">{[
                  ['AI 요청', `${count(summary.allocated.calls)}회`],
                  ['AI에 보내는 내용', inputCount(summary.allocated.input_tokens)],
                  ['AI 답변', `${count(summary.allocated.output_tokens)}토큰`],
                ].map(([label, amount]) => <div key={label} className="rounded-lg bg-white p-3"><dt className="text-xs text-ink-muted">{label}</dt><dd className="mt-1 break-words font-semibold">{amount}</dd></div>)}</dl> : <p role="alert" className="mt-2 text-amber-800">사용·예약 합계를 확인할 수 없습니다.</p>}
                {Boolean(summary.breakdown?.unknown_calls) && <p role="alert" className="mt-2 text-amber-800">사용량을 확인하지 못한 호출이 {count(summary.breakdown!.unknown_calls)}회 있습니다. 확인될 때까지 해당 예약량이 한도에 포함됩니다.</p>}
              </div>
              {Boolean(summary.legacy_accounted_run_count) && <details><summary className="min-h-10 cursor-pointer py-2 font-semibold focus-visible:outline-2 focus-visible:outline-brand-primary">이전 평가 {count(summary.legacy_accounted_run_count!)}건의 사용량 반영</summary><p className="pb-2 text-xs leading-5 text-ink-muted">과거에 실행했지만 예산에 기록되지 않았던 평가입니다. 저장된 답변에서 확인한 사용량을 현재 한도에 합산했습니다. AI를 다시 호출하거나 실제 청구 금액을 확인한 것은 아닙니다.</p></details>}
              {summary.breakdown && <details><summary className="min-h-11 cursor-pointer py-3 font-semibold focus-visible:outline-2 focus-visible:outline-brand-primary">누적 예산 상세 내역</summary><div className="pb-2"><OverviewBreakdown value={summary.breakdown} /></div></details>}
              <section aria-label="평가별 내역">
                <h4 className="text-sm font-semibold">평가별 내역 · {count(data.count)}건</h4>
                {!data.results.length ? <p className="py-3 text-sm">예약 기록이 없습니다.</p> : <div className="overflow-x-auto"><table className="mt-3 w-full text-left text-sm">
                  <thead><tr><th>기록 시각</th><th>예약 상태</th><th>사용·예약</th><th>미확인 호출</th></tr></thead>
                  <tbody>{data.results.map((row) => {
                    const createdAt = Number.isNaN(Date.parse(row.created_at)) ? '시각 확인 불가' : date(row.created_at)
                    return <tr key={row.run_id} className="border-t border-line"><td className="py-3 pr-3"><p>{createdAt}</p><Link className="text-brand-primary underline" to={`/ops/evaluations/${row.run_id}`} aria-label={`평가 상세 보기 · ${createdAt} · ${row.run_id.slice(0, 8)}`} title={row.dataset_id}>평가 상세 보기</Link></td><td>{row.closed_at ? '예약 종료' : '예약 유지 중'}</td><td>{count(row.breakdown.allocated_calls)}회 · {count(row.breakdown.allocated_output_tokens)}토큰</td><td>{count(row.breakdown.unknown_calls)}회</td></tr>
                  })}</tbody>
                </table></div>}
                {(data.count > 25 || page > 1) && <nav aria-label="예산 예약 페이지" className="mt-3 flex flex-wrap items-center justify-end gap-3 text-sm"><button type="button" className={styles.secondaryButton} disabled={page === 1} onClick={() => setPage((value) => value - 1)}>예약 이전</button><span>{page}페이지</span><button type="button" className={styles.secondaryButton} disabled={!data.next} onClick={() => setPage((value) => value + 1)}>예약 다음</button></nav>}
              </section>
            </div>
          </details>
          <details className="rounded-xl bg-surface-muted px-4 text-sm"><summary className="min-h-11 cursor-pointer py-3 font-semibold focus-visible:outline-2 focus-visible:outline-brand-primary">한도 변경 이력 · 최근 {summary.recent_changes.length} / 전체 {summary.change_count}건</summary>
            {!summary.recent_changes.length ? <p className="text-sm">기록된 한도 변경 이력이 없습니다.</p> : <ol className="space-y-3 text-sm">{summary.recent_changes.map((change) => {
              const amounts = [
                ['AI 요청', change.previous_limits?.calls ?? null, change.limits.calls, '회'],
                ['AI에 보내는 내용', change.previous_limits?.input_tokens ?? null, change.limits.input_tokens ?? null, '토큰'],
                ['AI 답변', change.previous_limits?.output_tokens ?? null, change.limits.output_tokens, '토큰'],
              ] as const
              const changed = amounts.filter(([, before, after]) => before !== after)
              const amount = (value: number | null, unit: '회' | '토큰', label: string) => value === null ? (label === 'AI에 보내는 내용' ? '미확인·미설정' : '미설정') : `${count(value)}${unit}`
              return <li key={change.request_id} className="space-y-2 rounded-lg bg-surface-muted p-4">
                <div><p className="font-semibold">{date(change.created_at)} · {change.actor}</p><p className="mt-1 text-xs text-ink-muted">{change.source === 'CLI' ? '운영자 직접 입력' : '관리자 로그인'}</p></div>
                {changed.length ? <dl className="grid gap-2 sm:grid-cols-3">{changed.map(([label, before, after, unit]) => <div key={label}><dt className="text-xs text-ink-muted">{label}</dt><dd className="mt-1 break-words">{amount(before, unit, label)} → {amount(after, unit, label)}</dd></div>)}</dl> : <p>한도 값 변경 없음</p>}
                <details><summary className="min-h-10 cursor-pointer py-2 font-semibold focus-visible:outline-2 focus-visible:outline-brand-primary">변경 상세 보기</summary>
                  <div className="space-y-2 pb-2 text-xs text-ink-muted">
                    <dl className="grid gap-2 sm:grid-cols-3">{amounts.map(([label, before, after, unit]) => <div key={label}><dt>{label}</dt><dd className="mt-1 break-words">{amount(before, unit, label)} → {amount(after, unit, label)}</dd></div>)}</dl>
                    <p className="break-words">{displayBudgetChangeReason(change.reason, change.source)}</p><p className="break-all">요청 ID: {change.request_id}</p><p>원본 출처: {change.source}</p><p>{change.source === 'CLI' ? 'CLI 변경자는 운영자가 직접 입력했으며 관리자 로그인으로 인증된 신원이 아닙니다.' : '기존 프로젝트의 관리자 세션을 확인한 기록입니다.'}</p>
                  </div>
                </details>
              </li>
            })}</ol>}
            <p className="mt-3 pb-4 text-xs text-ink-muted">기존 한도의 과거 변경 기록은 소급 생성하지 않습니다.</p>
          </details>
        </section>
      </div>}
    </section>
    {error && <p role="alert" className="text-sm text-red-700">{error} 표시된 값이 있으면 마지막 조회 기록입니다.</p>}
    {saved && <p role="status">{saved}</p>}
    {!data && !error && <p role="status">예산 장부를 불러오고 있습니다.</p>}
    {data && summary && <>
      {(summary.input_state === 'legacy_unknown' || summary.legacy_live_run_count > 0 || showUnaccounted) && <section aria-label="이전 평가 확인" className="grid gap-3 rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-800">
        <div><h3 className="font-bold">이전 평가의 사용량을 확인해 주세요</h3>
          {summary.legacy_live_run_count > 0 && <p className="mt-1">이전 평가 {count(summary.legacy_live_run_count)}건의 사용량을 확인할 수 없습니다.</p>}
          {summary.input_state === 'legacy_unknown' && <p className="mt-1">사용량을 확인하기 전에는 검색·RAG 평가와 정기 평가에 필요한 입력 한도를 설정할 수 없습니다. {summary.legacy_live_run_count === 0 && '관리자에게 사용 기록 확인을 요청하세요.'}</p>}
          {summary.legacy_live_run_count > 0 && <p className="mt-1">아래에서 기록을 확인해 주세요. 필요한 정보가 없으면 자동으로 반영할 수 없습니다.</p>}
        </div>
        {(summary.legacy_live_run_count > 0 || showUnaccounted) && <button type="button" id="budget-unaccounted" className={`${styles.secondaryButton} justify-self-start`} aria-expanded={showUnaccounted} onClick={() => setShowUnaccounted((value) => !value)}>{showUnaccounted ? '이전 평가 기록 닫기' : '이전 평가 기록 확인하기'}</button>}
        {showUnaccounted && <UnaccountedRunsPanel onExpired={onExpired} refreshKey={refreshKey + refresh} operatorId={operatorId} onApplied={() => { setSaved('검토한 과거 사용량을 장부에 반영했습니다.'); setRefresh((value) => value + 1); onBudgetChanged?.() }} />}
      </section>}
    </>}
  </section>
}

export function RunBudgetPanel({ runId, onExpired, refreshKey }: { runId: string; onExpired: () => void; refreshKey: number }) {
  const [data, setData] = useState<RunBudget | null>(null)
  const [error, setError] = useState('')
  const expiry = useRef(onExpired); expiry.current = onExpired
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    setData(null); setError('')
    const read = async () => {
      let keepPolling = true
      try {
        const result = await getRunBudget(runId, controller.signal)
        if (!controller.signal.aborted) { setData(result); setError('') }
      } catch (reason) {
        if (controller.signal.aborted) return
        if (reason instanceof OpsApiError && [401, 403].includes(reason.status)) {
          keepPolling = false; setData(null); expiry.current()
        } else setError(message(reason))
      } finally {
        if (!controller.signal.aborted && keepPolling) timer = setTimeout(() => void read(), 15_000)
      }
    }
    void read()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [runId, refreshKey])
  const detailClass = 'group/run-usage min-w-0 rounded-xl border border-line bg-white'
  const summaryClass = 'flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary [&::-webkit-details-marker]:hidden'
  const disclosureState = <span aria-hidden="true" className="shrink-0 text-xs text-brand-primary"><span className="group-open/run-usage:hidden">펼치기 +</span><span className="hidden group-open/run-usage:inline">접기 −</span></span>
  return <section className="grid min-w-0 gap-3" aria-label="실행 예산 장부">
    {error && <p role="alert" className="text-sm text-red-700">{error} 표시된 값이 있으면 마지막 조회 기록입니다.</p>}
    {!data && !error && <p role="status">사용량을 불러오고 있어요.</p>}
    {data && <>
      <p className="text-xs text-ink-muted">조회 시각: {date(data.as_of)}</p>
      {data.state === 'missing' && <p className="text-sm text-amber-800">사용량 기록을 찾지 못했어요. 사용량이 없다는 뜻은 아니에요.</p>}
      {data.state === 'not_applicable' && <p className="text-sm">이번 실행은 AI를 새로 호출하지 않았어요. 이전 실행의 사용량은 원본 기록에서 확인해 주세요.</p>}
      {data.legacy_usage && <p className="text-sm">이전에 저장한 답변에 기록된 AI 호출: <strong>{count(data.legacy_usage.usage.calls)}회</strong></p>}
      {data.legacy_usage && <details className={detailClass}><summary className={summaryClass}><span>이전에 기록한 사용량</span>{disclosureState}</summary><section aria-label="과거 사용량 반영 이력" className="space-y-2 border-t border-line p-4 text-sm">
        <h3 className="font-semibold">과거 사용량 반영 이력</h3>
        <p>{date(data.legacy_usage.created_at)} · {data.legacy_usage.actor} · {data.legacy_usage.actor_source ?? 'CLI'}</p>
        <p>사유: {data.legacy_usage.reason}</p>
        <p>저장 응답 사용량: {count(data.legacy_usage.usage.calls)}회 · 입력 {count(data.legacy_usage.usage.input_tokens)} / 출력 {count(data.legacy_usage.usage.output_tokens)}토큰</p>
        <p>전체 할당량: {count(data.legacy_usage.before.calls)} → {count(data.legacy_usage.after.calls)}회 · 입력 {count(data.legacy_usage.before.input_tokens)} → {count(data.legacy_usage.after.input_tokens)}토큰 · 출력 {count(data.legacy_usage.before.output_tokens)} → {count(data.legacy_usage.after.output_tokens)}토큰</p>
        <p className="break-all text-xs text-ink-muted">원본 SHA-256: {data.legacy_usage.capture_sha256}</p>
        <p className="break-all text-xs text-ink-muted">검토 증거 SHA-256: {data.legacy_usage.evidence_sha256} · 요청: {data.legacy_usage.request_id}</p>
        <p>저장 응답을 검토한 기록이며 당시 예약·서명 영수증·제공자 청구 확인이 아닙니다. 답변 품질 승인과도 별개입니다.</p>
        <p className="text-xs text-ink-muted">{data.legacy_usage.actor_source === 'CORE_ADMIN' ? '기존 프로젝트의 관리자 세션을 확인해 기록한 검토자입니다.' : '검토자는 CLI 운영자가 입력한 값이며 Core 로그인으로 인증한 신원은 아닙니다.'}</p>
      </section></details>}
      {data.reservation && <>
        <div className="grid gap-2 rounded-xl bg-surface-muted p-4 text-sm">
          <div className="flex min-w-0 items-center justify-between gap-2"><h3 className="text-base font-bold text-ink">확인된 AI 사용량</h3><RunUsageHelp label="확인된 AI 사용량" text="기록에서 확인한 사용량이에요. 토큰은 AI가 처리한 양을 세는 단위이며, 실제 청구 금액은 별도로 확인해야 해요." /></div>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">{([
            ['확인된 AI 호출', `${count(data.reservation.breakdown.settled_calls)}회`],
            ['AI에 보낸 양', inputCount(data.reservation.breakdown.confirmed_input_tokens)],
            ['AI가 출력한 양', `${count(data.reservation.breakdown.confirmed_output_tokens)}토큰`],
          ] as [string, string][]).map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-ink-muted">{label}</dt><dd className="mt-1 text-base font-semibold text-ink [overflow-wrap:anywhere]">{value}</dd></div>)}</dl>
          {(data.reservation.breakdown.legacy_calls ?? 0) > 0 && <p className="text-xs text-ink-muted">이전 기록에서 반영한 호출: {count(data.reservation.breakdown.legacy_calls ?? 0)}회</p>}
          {data.reservation.breakdown.unknown_calls > 0 && <p className="text-sm text-amber-800">사용량을 확인하지 못한 호출이 {count(data.reservation.breakdown.unknown_calls)}회 있어요. 확인될 때까지 해당 예산은 유지됩니다.</p>}
          <details className={detailClass}><summary className={summaryClass}><span>요청별 사용량 보기 · {data.calls.length}건</span>{disclosureState}</summary>
            <div className="space-y-3 border-t border-line p-4 text-sm">
              {data.reservation.breakdown.unknown_calls > 0 && <p className="leading-6 text-ink-muted">미확인 요청은 실제 전송 여부를 알 수 없어요.</p>}
              {data.calls.length === 0 ? <p>아직 승인된 요청 기록이 없어요.</p> : <ul className="space-y-3">{data.calls.map((call) => {
                const correction = data.corrections?.find((record) => record.sequence === call.sequence)
                const input = call.settled_at ? call.input_tokens : correction?.input_tokens
                const output = call.settled_at ? call.output_tokens : correction?.output_tokens
                const task = call.operation_id?.startsWith('document_embedding:') ? '문서 검색 준비' : call.operation_id?.startsWith('query_embedding:') ? '질문 검색 준비' : call.operation_id?.startsWith('answer:') ? '답변 생성' : '작업 종류 기록 없음'
                return <li key={call.sequence} className="rounded-xl border border-line p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">요청 {call.sequence + 1} · {task}</h4><span className={input == null || output == null ? 'text-amber-800' : 'text-ink-muted'}>{call.settled_at ? '사용량 확인됨' : correction ? '보정 기록으로 확인됨' : '사용량 미확인'}</span></div>
                  <dl className="mt-3 grid grid-cols-2 gap-3">{[['입력', input], ['출력', output]].map(([label, amount]) => <div key={label}><dt className="text-xs text-ink-muted">{label}</dt><dd className="mt-1 font-semibold">{typeof amount === 'number' ? `${count(amount)}토큰` : '확인할 수 없음'}</dd></div>)}</dl>
                  {correction && !call.settled_at && <p className="mt-2 text-xs text-ink-muted">원본 정산은 받지 못했으며 확인된 보정 기록을 표시해요. 자세한 내용은 사용량 수정 기록에서 확인하세요.</p>}
                  <details className="mt-3 border-t border-line pt-2"><summary className="min-h-11 cursor-pointer py-3 font-semibold focus-visible:outline-2 focus-visible:outline-brand-primary">요청 {call.sequence + 1} 상세 정보</summary><div className="grid gap-1 leading-6 text-ink-muted">
                    <p>요청 승인 시각: {date(call.authorized_at)}{call.settled_at ? ` · 사용량 확인 시각: ${date(call.settled_at)}` : ''}</p>
                    <p>한 번의 요청에 허용한 최대량: 입력 {inputCount(call.max_input_tokens)} / 출력 {inputCount(call.max_output_tokens)}</p>
                    <p>전송 전 계산한 입력: {inputCount(call.counted_input_tokens)} · 확인된 사용량과 다를 수 있어요.</p>
                    <p>{call.operation_id ? `작업 식별자: ${call.operation_id}` : '작업 식별 기록 없음 · 과거 승인'}</p>
                  </div></details>
                </li>
              })}</ul>}
            </div>
          </details>
        </div>
        <details className={detailClass}><summary className={summaryClass}><span>이번 평가의 한도 내역</span>{disclosureState}</summary><div className="grid gap-4 border-t border-line p-4">
          <p className="text-sm leading-6">사용량은 기록에서 확인한 양이에요. 확보한 양은 이 평가를 위해 한도에서 미리 잡아 둔 양이에요. 토큰은 AI가 처리한 내용의 양을 나타내는 단위예요.</p>
          <p className="text-sm leading-6">한도에 반영된 전체는 실제 사용량이나 전체에서 남은 한도, 청구 금액을 뜻하지 않아요.</p>
          <section aria-label="처음 확보한 최대량" className="grid gap-3 rounded-lg bg-surface-muted p-3 text-sm">
            <h4 className="font-semibold">처음 확보한 최대량</h4>
            <dl className="grid grid-cols-3 gap-2">{([
              ['AI 요청', `${count(data.reservation.max_calls)}회`],
              ['AI에 보내는 양', data.reservation.reserved_input_tokens == null ? '기록 없음' : inputCount(data.reservation.reserved_input_tokens)],
              ['AI가 만드는 양', data.reservation.reserved_output_tokens == null ? '기록 없음' : `${count(data.reservation.reserved_output_tokens)}토큰`],
            ] as [string, string][]).map(([label, amount]) => <div key={label} className="min-w-0"><dt className="text-xs text-ink-muted">{label}</dt><dd className="mt-1 font-semibold [overflow-wrap:anywhere]">{amount}</dd></div>)}</dl>
          </section>
          <p className="text-sm">한도 정리: {data.reservation.closed_at ? `완료 · ${date(data.reservation.closed_at)}` : '아직 정리 전'} · 평가 종료 여부와는 별개예요.</p>
          <details className="text-sm"><summary className="cursor-pointer font-semibold">한 번에 보내는 양의 한도 보기</summary><p className="mt-2">요청별로 정한 입력 한도 중 가장 큰 값: {data.reservation.max_input_tokens == null ? '기록 없음' : inputCount(data.reservation.max_input_tokens)}</p></details>
          <div className="grid gap-3 border-t border-line pt-4"><h4 className="text-sm font-bold">지금 한도에 반영된 내역</h4><Breakdown value={data.reservation.breakdown} /></div>
        </div></details>
        {data.cleanup && <details className={detailClass}><summary className={summaryClass}><span>종료 후 예산 정리 기록</span>{disclosureState}</summary><section aria-label="종료 예약 정리 이력" className="space-y-2 border-t border-line p-4 text-sm">
          <h3 className="font-semibold">종료 예약 정리 이력</h3>
          <p>{date(data.cleanup.created_at)} · {data.cleanup.actor} · CLI</p>
          <p>사유: {data.cleanup.reason}</p>
          <p>반환: {count(data.cleanup.before.reservation_calls - data.cleanup.after.reservation_calls)}회 · {count(data.cleanup.before.reservation_output_tokens - data.cleanup.after.reservation_output_tokens)}출력 토큰</p>
          <p>입력 할당 기록: {inputCount(data.reservation.max_input_tokens == null ? null : data.cleanup.before.reservation_input_tokens)} → {inputCount(data.reservation.max_input_tokens == null && data.cleanup.after.unknown_calls > 0 ? null : data.cleanup.after.reservation_input_tokens)}</p>
          <p>유지된 미확인 몫: {count(data.cleanup.after.unknown_calls)}회 · {count(data.cleanup.after.unknown_output_tokens)}출력 토큰</p>
          <p>종료 근거: Prefect {data.cleanup.evidence.state_type} · 확인 {date(data.cleanup.evidence.observed_at)}</p>
          <p className="break-all text-xs text-ink-muted">정리 요청: {data.cleanup.request_id} · 종료 상태 ID: {data.cleanup.evidence.state_id}</p>
          <p className="text-xs text-ink-muted">변경자는 CLI 운영자가 입력한 값입니다. 실제 결제 환불이나 미확인 사용량 보정이 아니며 새 모델 실행을 시작하지 않습니다.</p>
        </section></details>}
        {Boolean(data.corrections?.length) && <details className={detailClass}><summary className={summaryClass}><span>사용량 수정 기록</span>{disclosureState}</summary><section aria-label="사용량 보정 이력" className="space-y-3 border-t border-line p-4 text-sm">
          <h3 className="font-semibold">사용량 보정 이력</h3>
          <p>서명을 검증한 실행기 응답 기록으로 미확인 사용량을 확인했습니다. 원래 호출 기록은 보존하며 확정 합계에는 보정값을 포함합니다.</p>
          {data.corrections!.map((record) => <article key={record.request_id} className="space-y-1 border-t pt-3">
            <p>호출 {record.sequence + 1} · {date(record.created_at)} · {record.actor} · CLI</p>
            <p>사유: {record.reason}</p>
            <p>확인 사용량: 입력 {count(record.input_tokens)} / 출력 {count(record.output_tokens)}토큰</p>
            <p>입력 할당 기록: {inputCount(data.reservation?.max_input_tokens == null ? null : record.before.reservation_input_tokens)} → {inputCount(data.reservation?.max_input_tokens == null && record.after.unknown_calls > 0 ? null : record.after.reservation_input_tokens)} · 과거 미확인 입력은 보정 후 합산됩니다.</p>
            {record.source === 'WORKER_EMBEDDING_RESPONSE' && <p>입력 차액 반환: {count(record.before.reservation_input_tokens! - record.after.reservation_input_tokens!)}토큰</p>}
            <p>예약 차액 반환: {count(record.before.reservation_output_tokens - record.after.reservation_output_tokens)}출력 토큰 · 호출 횟수 유지</p>
            <p className="break-all text-xs text-ink-muted">{record.source === 'WORKER_EMBEDDING_RESPONSE' ? `임베딩 요청: ${record.provider_request_id}` : `응답: ${record.response_id}`} · 증거 SHA-256: {record.evidence_sha256}</p>
            <p className="break-all text-xs text-ink-muted">보정 요청: {record.request_id}</p>
          </article>)}
          <p className="text-xs text-ink-muted">변경자는 CLI 운영자가 입력한 값입니다. 실행기가 보관한 사용량이며 제공자의 청구 확정이나 실제 결제 환불을 뜻하지 않습니다.</p>
        </section></details>}

      </>}
    </>}
  </section>
}
