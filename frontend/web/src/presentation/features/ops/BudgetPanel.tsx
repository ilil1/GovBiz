import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { getBudgetReservations, getRunBudget, OpsApiError, type BudgetBreakdown, type BudgetPage, type RunBudget } from '../../../data/ops/opsApi'
import { workspacePageStyles as styles } from '../../shared/workspace/WorkspacePage.styles'
import { UnaccountedRunsPanel } from './UnaccountedRunsPanel'
import { BudgetLimitsForm } from './BudgetLimitsForm'
import { DailyBudgetPanel } from './DailyBudgetPanel'
import { DailyBudgetLimitsForm } from './DailyBudgetLimitsForm'

const date = (value: string) => new Date(value).toLocaleString('ko-KR')
const count = (value: number) => value.toLocaleString('ko-KR')
const inputCount = (value: number | null | undefined) => value == null ? '미확인·미설정' : `${count(value)}토큰`
const message = (error: unknown) => error instanceof Error ? error.message : '예산 장부를 불러오지 못했습니다.'

function Breakdown({ value }: { value: BudgetBreakdown }) {
  const boundedCalls = value.unbounded_input_calls === 0
  const boundedReservations = value.unbounded_input_reservations === 0
  return <div className="overflow-x-auto"><table className="w-full text-left text-sm">
    <caption className="sr-only">예산 할당량 구성</caption>
    <thead className="border-b border-line text-xs text-ink-muted"><tr><th className="py-3">구분</th><th>호출 수</th><th>출력 토큰</th><th>입력 토큰</th></tr></thead>
    <tbody>{[
      ['확정 사용량', count(value.settled_calls), count(value.confirmed_output_tokens), inputCount(value.confirmed_input_tokens)],
      ...(value.legacy_calls ? [['과거 저장 응답 반영', count(value.legacy_calls), count(value.legacy_output_tokens!), inputCount(value.legacy_input_tokens)]] : []),
      ['승인 후 사용량 미확인', count(value.unknown_calls), count(value.unknown_output_tokens), inputCount(boundedCalls ? value.unknown_input_tokens : null)],
      ['아직 승인하지 않은 예약', count(value.unapproved_calls), count(value.unapproved_output_tokens), inputCount(boundedReservations ? value.unapproved_input_tokens : null)],
      ['종료 전 반환 대기', '—', count(value.pending_release_output_tokens), inputCount(boundedReservations ? value.pending_release_input_tokens : null)],
      ['현재 할당량 합계', count(value.allocated_calls), count(value.allocated_output_tokens), inputCount(boundedCalls && boundedReservations ? value.allocated_input_tokens : null)],
    ].map(([label, calls, output, input]) => <tr key={label} className="border-b border-line last:border-0"><th scope="row" className="py-3 font-medium">{label}</th><td>{calls}</td><td>{output}</td><td>{input}</td></tr>)}</tbody>
  </table><p className="mt-3 text-xs text-ink-muted">입력 상한 기록이 없는 과거 예약의 미확인 몫은 0으로 환산하지 않습니다.</p>
    <details className="mt-3 text-sm">
      <summary className="min-h-11 cursor-pointer py-3 font-semibold focus-visible:outline-2 focus-visible:outline-brand-primary">장부 항목은 무슨 뜻인가요?</summary>
      <dl className="grid gap-3 rounded-xl bg-surface-muted p-4 leading-6 sm:grid-cols-2">{[
        ['확정 사용량', '응답 기록 등으로 사용량을 확인하고 정산한 몫입니다. 실행이 끝나도 누적 장부에 남으며, 제공자의 청구 금액 확정과는 구분합니다.'],
        ['과거 저장 응답 반영', '예약 기록이 없던 과거 실행의 저장 응답을 검토해 추가한 사용량입니다. 제공자의 청구 확인이나 답변 품질 승인을 뜻하지 않습니다.'],
        ['승인 후 사용량 미확인', '호출은 승인했지만 전송 여부나 사용량을 확정하지 못한 몫입니다. 무료로 간주하지 않고 최대 예약량을 유지합니다.'],
        ['아직 승인하지 않은 예약', '접수된 평가를 위해 확보했지만 개별 모델 호출의 전송 승인을 아직 받지 않은 몫입니다. 사람의 답변 검토 승인을 기다린다는 뜻이 아닙니다.'],
        ['종료 전 반환 대기', '정산 후 남은 토큰 차액 중 아직 예약을 닫지 않아 돌려놓지 않은 몫입니다. 실행 종료 확인과 예약 정리가 필요합니다.'],
        ['현재 할당량 합계', '확정·과거 반영 사용량과 미확인·미승인·반환 대기 몫을 합한 양입니다. 잔여 한도를 계산할 때 전체 한도에서 차감합니다.'],
      ].map(([label, explanation]) => <div key={label}><dt className="font-semibold">{label}</dt><dd className="mt-1 text-ink-muted">{explanation}</dd></div>)}</dl>
    </details>
  </div>
}

export function BudgetOverview({ onExpired, refreshKey, operatorId, onBudgetChanged }: {
  onExpired: () => void; refreshKey: number; operatorId?: string; onBudgetChanged?: () => void
}) {
  const [page, setPage] = useState(1)
  const [data, setData] = useState<BudgetPage | null>(null)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [showUnaccounted, setShowUnaccounted] = useState(false)
  const [showReservations, setShowReservations] = useState(false)
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
  return <section id="evaluation-budget" tabIndex={-1} className={styles.card} aria-label="누적 평가 예산">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className={styles.cardTitle}>누적 평가 예산</h2><button type="button" className={styles.cardTextLink} onClick={() => setRefresh((value) => value + 1)}>예산 새로고침</button></div>
    <section aria-label="예산 설정 순서" className="rounded-2xl bg-brand-soft p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <h3 className="text-base font-bold text-ink">AI 평가 사용 한도</h3>
        <details className="relative">
          <summary aria-label="AI 평가 사용 한도 도움말" className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-line bg-white text-xs font-bold text-ink focus-visible:outline-2 focus-visible:outline-brand-primary">?</summary>
          <p className="absolute left-0 top-9 z-10 w-72 max-w-[calc(100vw-4rem)] rounded-xl border border-line bg-white p-4 text-sm leading-6 text-ink-muted shadow-lg">AI 평가에 사용할 요청 횟수와 분량을 정합니다. 모든 평가가 한도를 함께 사용하며, 날짜가 바뀌어도 초기화되지 않습니다. 금액 한도는 아닙니다.</p>
        </details>
      </div>
      {(!operatorId || error || !data || summary?.state === 'inconsistent' || !summary?.limits_revision) && <p className="mt-4 text-sm font-semibold text-brand-primary">{!operatorId ? '관리자에게 설정을 요청하세요.' : error ? '현재 상태를 확인하지 못했습니다. 예산을 새로고침해 주세요.' : !data ? '현재 상태를 확인하고 있습니다.' : summary?.state === 'inconsistent' ? '사용 기록이 맞지 않아 설정을 변경할 수 없습니다.' : '현재 서버에서 설정을 변경할 수 없습니다. 관리자에게 확인해 주세요.'}</p>}
      {data && summary && <div className="mt-4 space-y-4">
        {summary.state === 'inconsistent' && <p role="alert" className="text-sm leading-6 text-red-700">저장된 할당량과 상세 장부가 일치하지 않습니다. 잔여 한도를 확정할 수 없어 표시하지 않습니다.</p>}
        {summary.state === 'unconfigured' && <p role="status" className="text-sm font-semibold text-ink">아직 사용 한도를 설정하지 않았습니다.</p>}
        {summary.state !== 'unconfigured' && summary.input_state === 'enforced' && <p className="text-sm font-medium text-brand-primary">입력 한도 적용 중</p>}
        {summary.state !== 'unconfigured' && summary.input_state === 'unconfigured' && <p className="text-sm leading-6 text-amber-800">입력 한도가 설정되지 않았습니다. 검색·RAG 평가를 하려면 입력 한도도 설정해야 합니다.</p>}
        {summary.limits && summary.state === 'consistent' && summary.remaining && <section aria-label="남은 사용량" className="space-y-3 rounded-xl bg-white/80 p-4">
          <h3 className="text-sm font-bold text-ink">남은 한도</h3>
          <dl className="grid gap-2 sm:grid-cols-3">
            <div className="min-w-0 rounded-lg bg-white px-3 py-2.5"><dt className="text-xs text-ink-muted">AI 요청</dt><dd className="mt-1 break-words text-base font-bold text-ink">{count(summary.remaining.calls)}회</dd></div>
            <div className="min-w-0 rounded-lg bg-white px-3 py-2.5"><dt className="text-xs text-ink-muted">AI에 보내는 내용</dt><dd className="mt-1 break-words text-base font-bold text-ink">{summary.limits.input_tokens == null ? '설정되지 않음' : summary.remaining.input_tokens == null ? '확인할 수 없음' : inputCount(summary.remaining.input_tokens)}</dd></div>
            <div className="min-w-0 rounded-lg bg-white px-3 py-2.5"><dt className="text-xs text-ink-muted">AI 답변</dt><dd className="mt-1 break-words text-base font-bold text-ink">{count(summary.remaining.output_tokens)}토큰</dd></div>
          </dl>
          <p className="text-xs leading-5 text-ink-muted">이미 진행 중인 평가에 확보한 양을 제외한 수치입니다.{summary.legacy_live_run_count > 0 && ' 확인되지 않은 이전 평가 사용량은 포함되지 않았습니다.'}</p>
        </section>}
        {operatorId && <BudgetLimitsForm summary={summary} owner={operatorId} onExpired={onExpired} onSaved={() => { setSaved('누적 한도 변경 이력을 저장했습니다.'); setRefresh((value) => value + 1); onBudgetChanged?.() }} />}
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

      {(summary.daily?.state === 'unknown' || summary.daily?.state === 'exceeded') && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{summary.daily.state === 'unknown' ? '일별 사용량을 확인할 수 없어' : '일별 한도를 초과해'} 새 평가를 예약할 수 없습니다. 아래 ‘하루 평가 한도’에서 확인하세요.</p>}
      <details className="rounded-xl bg-surface-muted px-4 text-sm">
        <summary className="min-h-11 cursor-pointer py-3 font-semibold focus-visible:outline-2 focus-visible:outline-brand-primary">하루 평가 한도</summary>
        <div className="pb-4">
      <section aria-label="하루 예산 요약" className="grid gap-3 rounded-xl bg-[#f3f7f5] p-4 text-sm">
        <h3 className="font-semibold">하루 예산 · 서울 시간</h3>
        <p className="leading-6 text-ink-muted">수동 평가에는 하루 한도가 필수는 아닙니다. 정기 평가에는 누적 입력 한도와 하루 한도가 모두 필요합니다.</p>
        {!summary.daily ? <p>일별 예산 정보를 확인할 수 없습니다.</p>
          : summary.daily.state === 'disabled' ? <p>일별 한도 미적용 · 누적 한도는 별도로 확인합니다. 정기 실행에는 일별 한도가 필요합니다.</p>
          : summary.daily.state === 'unknown' ? <p role="alert" className="text-red-700">일별 사용량 미확인 · 신규 예약이 차단됩니다.</p>
          : summary.daily.state === 'exceeded' ? <p role="alert" className="text-red-700">일별 한도 초과 · 신규 예약이 차단됩니다.</p>
          : <p className="text-brand-primary">일별 한도 적용 중 · 누적 한도도 함께 확인합니다.</p>}
        {summary.daily?.state !== 'disabled' && summary.daily?.limits && <dl className="grid gap-2 sm:grid-cols-2">{[
          ['일별 한도', summary.daily.limits], ['일별 잔여', summary.daily.state === 'enforced' ? summary.daily.remaining : null],
        ].map(([label, amount]) => {
          const value = amount as NonNullable<typeof summary.daily>['limits']
          return <div key={String(label)} className="min-w-0 rounded-lg bg-white p-3"><dt className="text-ink-muted">{String(label)}</dt><dd className="mt-1 break-words font-semibold leading-6">{value ? `${count(value.calls)}회 · 입력 ${count(value.input_tokens)}토큰 · 출력 ${count(value.output_tokens)}토큰` : '확인 불가'}</dd></div>
        })}</dl>}
        {operatorId && !summary.limits && <p className="text-ink-muted">하루 한도를 설정하려면 먼저 위에서 AI 평가 사용량을 설정해 주세요.</p>}
        {operatorId && summary.limits && <DailyBudgetLimitsForm daily={summary.daily} owner={operatorId} onExpired={onExpired} onSaved={() => { setSaved('일별 정책 변경 이력을 저장했습니다.'); setRefresh((value) => value + 1); onBudgetChanged?.() }} />}
        <details><summary className="min-h-10 cursor-pointer py-2 font-semibold focus-visible:outline-2 focus-visible:outline-brand-primary">일별 예산 상세 보기</summary><DailyBudgetPanel value={summary.daily} /></details>
      </section>
        </div>
      </details>
      <details className="rounded-xl bg-surface-muted px-4 text-sm">
      <summary className="min-h-11 cursor-pointer py-3 font-semibold focus-visible:outline-2 focus-visible:outline-brand-primary">평가 사용·변경 기록</summary>
      <div className="grid gap-4 pb-4">
      <p className="text-xs text-ink-muted">조회 시각: {date(data.as_of)} · 15초마다 갱신 · 총계는 전체 예약과 검토 후 반영한 과거 사용량 기준입니다.</p>
      {summary.limits && <details className="rounded-xl bg-white px-4 text-sm"><summary className="min-h-11 cursor-pointer py-3 font-semibold focus-visible:outline-2 focus-visible:outline-brand-primary">전체 한도와 사용량 보기</summary><div className="grid gap-3 pb-4">
        <dl className="grid gap-3 sm:grid-cols-3">{([
          ['전체 한도', summary.limits],
          ['사용·예약', summary.allocated],
          ['남은 한도', summary.state === 'consistent' ? summary.remaining : null],
        ] as const).map(([label, value]) => <div className="min-w-0 rounded-xl bg-[#f3f7f5] p-4" key={label}><dt className="text-ink-muted">{label}</dt><dd className="mt-2 break-words font-semibold leading-6">{value ? `${count(value.calls)}회 · 입력 ${inputCount(value.input_tokens)} · 출력 ${count(value.output_tokens)}토큰` : '확인 불가'}</dd></div>)}</dl>
        <p className="leading-6 text-ink-muted">전체 한도는 지금까지의 사용과 앞으로 사용할 양을 합친 상한입니다. 날짜가 바뀌어도 초기화되지 않으며 모든 평가 자료와 관리자가 공유합니다.</p>
        <p className="leading-6 text-ink-muted">사용·예약에는 확인된 사용량과 아직 정리되지 않은 예약이 함께 포함됩니다. 남은 한도는 전체 한도에서 사용·예약을 뺀 값이며, 일별 제한이 켜져 있으면 일별 잔여도 충분해야 합니다.</p>
      </div></details>}
      {Boolean(summary.legacy_accounted_run_count) && <p className="text-sm">저장 응답을 검토해 과거 실행 {count(summary.legacy_accounted_run_count!)}건의 사용량을 합산했습니다. 당시 예약이나 제공자의 청구 확인을 뜻하지 않습니다.</p>}
      {summary.breakdown && <details className="rounded-xl bg-surface-muted px-4 text-sm"><summary className="min-h-11 cursor-pointer py-3 font-semibold focus-visible:outline-2 focus-visible:outline-brand-primary">누적 예산 상세 내역</summary><div className="pb-4"><Breakdown value={summary.breakdown} /><p className="mt-3 text-xs leading-5 text-ink-muted">응답을 정산해도 실행의 예약을 닫기 전까지 입력·출력 차액은 반환 대기로 남습니다. 승인 기록만으로 모델 전송 완료나 실제 비용을 확정할 수 없습니다.</p></div></details>}
      <details open={showReservations}><summary onClick={(event) => { event.preventDefault(); setShowReservations((value) => !value) }} className="min-h-11 cursor-pointer py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-brand-primary">실행별 예약 · {count(data.count)}건</summary>
        <p className="py-2 text-xs leading-5 text-ink-muted">각 평가가 확보한 몫과 미확인 호출을 확인합니다. 예약이 닫혀도 확정 사용량과 미확인 몫은 남을 수 있습니다. 실행 링크에서 상세 내역을 확인하세요.</p>
        {!data.results.length ? <p className="py-3 text-sm">예약 기록이 없습니다.</p> : <div className="overflow-x-auto"><table className="mt-3 w-full text-left text-sm">
          <thead><tr><th>실행</th><th>예약 상태</th><th>할당량</th><th>미확인 호출</th></tr></thead>
          <tbody>{data.results.map((row) => <tr key={row.run_id} className="border-t border-line"><td className="py-3 pr-3"><Link className="text-brand-primary underline" to={`/ops/evaluations/${row.run_id}`}>{row.dataset_id} · {row.run_id.slice(0, 8)}</Link></td><td>{row.closed_at ? '닫힘' : '열림'}</td><td>{count(row.breakdown.allocated_calls)}회 · {count(row.breakdown.allocated_output_tokens)}토큰</td><td>{count(row.breakdown.unknown_calls)}회</td></tr>)}</tbody>
        </table></div>}
        {(data.count > 25 || page > 1) && <nav aria-label="예산 예약 페이지" className="mt-3 flex flex-wrap items-center justify-end gap-3 text-sm"><button type="button" className={styles.secondaryButton} disabled={page === 1} onClick={() => setPage((value) => value - 1)}>예약 이전</button><span>{page}페이지</span><button type="button" className={styles.secondaryButton} disabled={!data.next} onClick={() => setPage((value) => value + 1)}>예약 다음</button></nav>}
      </details>
      <details><summary className="cursor-pointer text-sm font-semibold">한도 변경 이력 · 최근 {summary.recent_changes.length} / 전체 {summary.change_count}건</summary>
        <p className="py-2 text-xs text-ink-muted">CLI 변경자는 운영자가 입력한 값이며 Core 로그인으로 인증한 신원은 아닙니다. CORE_ADMIN은 기존 프로젝트의 관리자 세션을 확인한 기록입니다. 기존 한도의 과거 변경 기록은 소급 생성하지 않습니다.</p>
        {!summary.recent_changes.length ? <p className="text-sm">기록된 한도 변경 이력이 없습니다.</p> : <ol className="space-y-3 text-sm">{summary.recent_changes.map((change) => <li key={change.request_id} className="border-t border-line pt-3">
          <p>{date(change.created_at)} · {change.actor} · {change.source}</p>
          <p>{change.previous_limits ? `${count(change.previous_limits.calls)}회 / ${count(change.previous_limits.output_tokens)}토큰` : '미설정'} → {count(change.limits.calls)}회 / {count(change.limits.output_tokens)}토큰</p>
          <p>입력 한도: {inputCount(change.previous_limits?.input_tokens)} → {inputCount(change.limits.input_tokens)}</p>
          <p className="break-words">사유: {change.reason}</p><p className="break-all text-xs text-ink-muted">요청 ID: {change.request_id}</p>
        </li>)}</ol>}
      </details>
      </div>
      </details>
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
  return <section className={styles.card} aria-label="실행 예산 장부">
    <h2 className={styles.cardTitle}>실행 예산 장부</h2>
    {error && <p role="alert" className="text-sm text-red-700">{error} 표시된 값이 있으면 마지막 조회 기록입니다.</p>}
    {!data && !error && <p role="status">실행 예약을 불러오고 있습니다.</p>}
    {data && <>
      <p className="text-xs text-ink-muted">조회 시각: {date(data.as_of)}</p>
      {data.state === 'missing' && <p className="text-sm text-amber-800">이 모델 실행에는 예약 기록이 없습니다. 사용량을 0으로 판단할 수 없습니다.</p>}
      {data.state === 'not_applicable' && <p className="text-sm">새 모델 호출을 예약하는 실행이 아닙니다. 원본 실행의 비용은 원본 장부에서 확인하세요.</p>}
      {data.legacy_usage && <section aria-label="과거 사용량 반영 이력" className="space-y-2 rounded-xl bg-[#f3f7f5] p-4 text-sm">
        <h3 className="font-semibold">과거 사용량 반영 이력</h3>
        <p>{date(data.legacy_usage.created_at)} · {data.legacy_usage.actor} · {data.legacy_usage.actor_source ?? 'CLI'}</p>
        <p>사유: {data.legacy_usage.reason}</p>
        <p>저장 응답 사용량: {count(data.legacy_usage.usage.calls)}회 · 입력 {count(data.legacy_usage.usage.input_tokens)} / 출력 {count(data.legacy_usage.usage.output_tokens)}토큰</p>
        <p>전체 할당량: {count(data.legacy_usage.before.calls)} → {count(data.legacy_usage.after.calls)}회 · 입력 {count(data.legacy_usage.before.input_tokens)} → {count(data.legacy_usage.after.input_tokens)}토큰 · 출력 {count(data.legacy_usage.before.output_tokens)} → {count(data.legacy_usage.after.output_tokens)}토큰</p>
        <p className="break-all text-xs text-ink-muted">원본 SHA-256: {data.legacy_usage.capture_sha256}</p>
        <p className="break-all text-xs text-ink-muted">검토 증거 SHA-256: {data.legacy_usage.evidence_sha256} · 요청: {data.legacy_usage.request_id}</p>
        <p>저장 응답을 검토한 기록이며 당시 예약·서명 영수증·제공자 청구 확인이 아닙니다. 답변 품질 승인과도 별개입니다.</p>
        <p className="text-xs text-ink-muted">{data.legacy_usage.actor_source === 'CORE_ADMIN' ? '기존 프로젝트의 관리자 세션을 확인해 기록한 검토자입니다.' : '검토자는 CLI 운영자가 입력한 값이며 Core 로그인으로 인증한 신원은 아닙니다.'}</p>
      </section>}
      {data.reservation && <>
        <p className="text-sm">예약 상태: {data.reservation.closed_at ? `닫힘 · ${date(data.reservation.closed_at)}` : '열림'} · 실행의 완료·취소 상태와 별도로 관리합니다.</p>
        <p className="text-sm">실행 내 입력 상한 최댓값: {inputCount(data.reservation.max_input_tokens)}</p>
        <Breakdown value={data.reservation.breakdown} />
        {data.reservation.breakdown.unknown_calls > 0 && <p className="text-sm text-amber-800">미확인 호출은 전송·사용량을 확정하지 못한 상태입니다. 예약이 닫혀도 해당 호출의 최대 출력 몫은 유지됩니다. 입력 상한이 기록된 호출은 입력 예약도 유지됩니다.</p>}
        {data.cleanup && <section aria-label="종료 예약 정리 이력" className="space-y-2 rounded-xl bg-[#f3f7f5] p-4 text-sm">
          <h3 className="font-semibold">종료 예약 정리 이력</h3>
          <p>{date(data.cleanup.created_at)} · {data.cleanup.actor} · CLI</p>
          <p>사유: {data.cleanup.reason}</p>
          <p>반환: {count(data.cleanup.before.reservation_calls - data.cleanup.after.reservation_calls)}회 · {count(data.cleanup.before.reservation_output_tokens - data.cleanup.after.reservation_output_tokens)}출력 토큰</p>
          <p>입력 할당 기록: {inputCount(data.reservation.max_input_tokens == null ? null : data.cleanup.before.reservation_input_tokens)} → {inputCount(data.reservation.max_input_tokens == null && data.cleanup.after.unknown_calls > 0 ? null : data.cleanup.after.reservation_input_tokens)}</p>
          <p>유지된 미확인 몫: {count(data.cleanup.after.unknown_calls)}회 · {count(data.cleanup.after.unknown_output_tokens)}출력 토큰</p>
          <p>종료 근거: Prefect {data.cleanup.evidence.state_type} · 확인 {date(data.cleanup.evidence.observed_at)}</p>
          <p className="break-all text-xs text-ink-muted">정리 요청: {data.cleanup.request_id} · 종료 상태 ID: {data.cleanup.evidence.state_id}</p>
          <p className="text-xs text-ink-muted">변경자는 CLI 운영자가 입력한 값입니다. 실제 결제 환불이나 미확인 사용량 보정이 아니며 새 모델 실행을 시작하지 않습니다.</p>
        </section>}
        {Boolean(data.corrections?.length) && <section aria-label="사용량 보정 이력" className="space-y-3 rounded-xl bg-[#f3f7f5] p-4 text-sm">
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
        </section>}
        <details><summary className="cursor-pointer text-sm font-semibold">호출별 승인·정산 · {data.calls.length}건</summary>
          <ul className="mt-3 space-y-2 text-sm">{data.calls.map((call) => <li key={call.sequence}>
            <p>승인 상한: 입력 {inputCount(call.max_input_tokens)} / 출력 {inputCount(call.max_output_tokens)}</p>
            <p>생성 전 입력 계산: {inputCount(call.counted_input_tokens)}</p>
            <p>{call.operation_id ? `${call.operation_id.startsWith('document_embedding:') ? '문서 임베딩' : call.operation_id.startsWith('query_embedding:') ? '질문 임베딩' : '답변 작업'} · ${call.operation_id}` : '작업 식별 기록 없음 · 과거 승인'}</p>
            호출 {call.sequence + 1} · 승인 {date(call.authorized_at)} · {call.settled_at ? `정산 ${date(call.settled_at)} · 입력 ${count(call.input_tokens!)} / 출력 ${count(call.output_tokens!)}토큰` : data.corrections?.some((record) => record.sequence === call.sequence) ? '원본 정산 미수신 · 사용량 보정 이력 참조' : '사용량 미확인'}
          </li>)}</ul>
        </details>
      </>}
    </>}
  </section>
}
