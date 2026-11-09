import { createRequestId } from './requestId'
import { useEffect, useId, useRef, useState } from 'react'
import { getBudgetSummary, OpsApiError, setBudgetLimits, type BudgetLimitsInput, type BudgetSummary } from '../../../data/ops/opsApi'
import { workspacePageStyles as styles } from '../../shared/workspace/WorkspacePage.styles'
import { BudgetPlanningPanel } from './BudgetPlanningPanel'

const amount = (value: number | null | undefined, unit: string) => value == null ? '미설정' : `${value.toLocaleString('ko-KR')}${unit}`
type AmountParts = { confirmed: number; unknown: number; reserved: number }
type CalculatedAmount = { used: number; needed: number; parts: AmountParts | null }

// 각 분리 항목이 장부의 합계와 일치할 때만 사용·예약을 개별 표시한다.
const amountParts = (summary: BudgetSummary, kind: 'calls' | 'input' | 'output', allocated: number): AmountParts | null => {
  const value = summary.breakdown
  if (summary.state !== 'consistent' || !value) return null
  let confirmed: number
  let unknown: number | undefined
  let reserved: number | undefined
  if (kind === 'calls') {
    confirmed = value.settled_calls + (value.legacy_calls ?? 0)
    unknown = value.unknown_calls
    reserved = value.unapproved_calls
  } else if (kind === 'output') {
    confirmed = value.confirmed_output_tokens + (value.legacy_output_tokens ?? 0)
    unknown = value.unknown_output_tokens
    reserved = value.unapproved_output_tokens + value.pending_release_output_tokens
  } else {
    if (value.unbounded_input_calls !== 0 || value.unbounded_input_reservations !== 0) return null
    confirmed = value.confirmed_input_tokens + (value.legacy_input_tokens ?? 0)
    unknown = value.unknown_input_tokens
    reserved = value.unapproved_input_tokens == null || value.pending_release_input_tokens == null
      ? undefined : value.unapproved_input_tokens + value.pending_release_input_tokens
  }
  if (unknown == null || reserved == null || ![confirmed, unknown, reserved].every((item) => Number.isSafeInteger(item) && item >= 0)
      || confirmed + unknown + reserved !== allocated) return null
  return { confirmed, unknown, reserved }
}

function CalculationPreview({ label, value, entered, currentLimit, unit }: {
  label: string; value: CalculatedAmount; entered: string; currentLimit: number | null | undefined; unit: string
}) {
  if (!/^\d+$/.test(entered) || !Number.isSafeInteger(Number(entered)) || !Number.isSafeInteger(value.used + Number(entered))) {
    return <p className="text-sm text-ink-muted">0 이상의 정수를 입력해 주세요.</p>
  }
  const format = (number: number) => `${number.toLocaleString('ko-KR')}${unit}`
  const total = Math.max(value.used + Number(entered), currentLimit ?? 0)
  const remaining = currentLimit == null ? null : Math.max(0, currentLimit - value.used)
  const afterRemaining = Math.max(0, total - value.used)
  const increase = currentLimit == null ? null : total - currentLimit
  const parts = value.parts
  return <section aria-label={`${label} 한도 변화`} className="space-y-3 rounded-lg bg-surface-muted p-3 text-sm">
    <dl className="grid grid-cols-2 gap-x-3 gap-y-3">
      <div><dt className="text-xs text-ink-muted">현재 전체 한도</dt><dd className="mt-1 font-semibold text-ink">{currentLimit == null ? '미설정' : format(currentLimit)}</dd></div>
      <div><dt className="text-xs text-ink-muted">현재 남은 한도</dt><dd className="mt-1 font-semibold text-ink">{remaining == null ? '미설정' : format(remaining)}</dd></div>
      <div><dt className="text-xs text-ink-muted">저장 시 전체 한도</dt><dd className="mt-1 font-bold text-brand-primary">{format(total)}</dd></div>
      <div><dt className="text-xs text-ink-muted">저장 시 남은 한도</dt><dd className="mt-1 font-bold text-brand-primary">{format(afterRemaining)}</dd></div>
    </dl>
    <p className="text-xs text-ink-muted">{increase == null ? '저장 시 전체 한도를 새로 설정합니다.' : increase === 0 ? '저장 시 전체 한도 유지' : `저장 시 전체 한도 ${format(increase)} 증가`}</p>
    <details className="text-xs text-ink-muted">
      <summary aria-label={`${label} 현재 사용량 상세`} className="min-h-8 cursor-pointer py-1 font-medium focus-visible:outline-2 focus-visible:outline-brand-primary">현재 사용량 상세</summary>
      <p className="pb-1 leading-5">{parts
        ? `점검 시점 기준 확인된 사용 ${format(parts.confirmed)} · 미확인 ${format(parts.unknown)} · 예약·반환 대기 ${format(parts.reserved)}`
        : `점검 시점 기준 사용·예약 합계 ${format(value.used)} · 상세 내역 확인 불가`}</p>
    </details>
  </section>
}

export function BudgetLimitsForm({ summary, owner, onSaved, onExpired }: {
  summary: BudgetSummary; owner: string; onSaved: () => void; onExpired: () => void
}) {
  const helpId = useId()
  const [opened, setOpened] = useState(false)
  const [inputOpen, setInputOpen] = useState(false)
  const [calls, setCalls] = useState('')
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [reason, setReason] = useState('')
  const [revision, setRevision] = useState('')
  const [previous, setPrevious] = useState(summary.limits)
  const [proposal, setProposal] = useState<BudgetLimitsInput | null>(null)
  const [error, setError] = useState('')
  const [fillNotice, setFillNotice] = useState('')
  const [checkedNeeds, setCheckedNeeds] = useState<{ calls: number; input_tokens: number; output_tokens: number } | null>(null)
  const [calculated, setCalculated] = useState<{ calls: CalculatedAmount; input: CalculatedAmount | null; output: CalculatedAmount } | null>(null)
  const [planningKey, setPlanningKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const submitting = useRef(false)
  const planningHeading = useRef<HTMLDivElement>(null)
  const inputHeading = useRef<HTMLHeadingElement>(null)
  const reviewHeading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (!opened) return
    if (proposal) reviewHeading.current?.focus()
    else if (inputOpen) inputHeading.current?.focus()
    else planningHeading.current?.focus()
  }, [opened, inputOpen, proposal])
  const open = () => {
    setCalls(summary.limits?.calls.toString() ?? '')
    setInput(summary.limits?.input_tokens?.toString() ?? '')
    setOutput(summary.limits?.output_tokens.toString() ?? '')
    setPrevious(summary.limits); setRevision(summary.limits_revision!); setReason('')
    setProposal(null); setError(''); setFillNotice(''); setCheckedNeeds(null); setCalculated(null); setAttempted(false); setInputOpen(false); setOpened(true)
  }
  const checkSnapshot = (current: BudgetSummary) => {
    if (!calculated) return true
    const allocated = current.allocated
    const firstSetup = current.state === 'unconfigured' && !allocated
    return current.limits_revision === revision && (firstSetup || current.state === 'consistent' && allocated != null)
      && (allocated?.calls ?? 0) === calculated.calls.used
      && (allocated?.output_tokens ?? 0) === calculated.output.used
      && (!calculated.input || (allocated?.input_tokens != null || firstSetup && current.input_state === 'unconfigured' && current.legacy_live_run_count === 0)
        && (allocated?.input_tokens ?? 0) === calculated.input.used && ['enforced', 'unconfigured'].includes(current.input_state ?? ''))
  }
  const review = async () => {
    const valid = (value: string) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value))
    if (!valid(calls) || !valid(output) || (input !== '' && !valid(input)) || reason.trim().length > 1000) {
      setError('한도에 0 이상의 정수를 입력해 주세요.'); return
    }
    if (summary.input_state === 'legacy_unknown' && previous?.input_tokens == null && input !== '') {
      setError('이전 사용량을 확인하기 전에는 입력 한도를 비워 주세요.'); return
    }
    if (busy || submitting.current) return
    let current = summary
    if (calculated) {
      submitting.current = true; setBusy(true); setError('')
      try { current = await getBudgetSummary() }
      catch (failure) {
        if (failure instanceof OpsApiError && [401, 403].includes(failure.status)) onExpired()
        setError('현재 예산을 확인하지 못했습니다. 다시 시도해 주세요.'); return
      } finally { submitting.current = false; setBusy(false) }
      if (!checkSnapshot(current)) {
        setError('예산 사용량이나 한도가 바뀌었습니다. 예산을 새로고침하고 필요량을 다시 확인해 주세요.'); return
      }
    }
    const allocated = current.allocated
    const firstSetup = current.state === 'unconfigured' && !allocated
    const total = (value: string, used: number, limit: number | null | undefined) => Math.max(used + Number(value), limit ?? 0)
    const nextCalls = calculated ? total(calls, allocated?.calls ?? 0, current.limits?.calls) : Number(calls)
    const nextOutput = calculated ? total(output, allocated?.output_tokens ?? 0, current.limits?.output_tokens) : Number(output)
    const canConvertInput = calculated?.input && (allocated?.input_tokens != null || firstSetup && current.input_state === 'unconfigured' && current.legacy_live_run_count === 0)
    if (calculated?.input && (!canConvertInput || !['enforced', 'unconfigured'].includes(current.input_state ?? ''))) {
      setError('입력 사용량을 확인할 수 없습니다. 예산을 새로고침하고 다시 확인해 주세요.'); return
    }
    const nextInput = input === '' ? null : canConvertInput ? total(input, allocated?.input_tokens ?? 0, current.limits?.input_tokens) : Number(input)
    if (![nextCalls, nextOutput, ...(nextInput === null ? [] : [nextInput])].every(Number.isSafeInteger)) {
      setError('계산 결과가 안전한 숫자 범위를 벗어났습니다. 확보할 양을 줄여 주세요.'); return
    }
    setAttempted(false)
    setProposal({ request_id: createRequestId(), expected_revision: revision,
      calls: nextCalls, output_tokens: nextOutput, input_tokens: nextInput, reason: reason.trim() || '자동 생성: AI 평가 사용량 한도 설정' })
    setError('')
  }
  const applyRequired = (required: { calls: number; input_tokens: number; output_tokens: number }) => {
    const allocated = summary.allocated
    const firstSetup = summary.state === 'unconfigured' && !allocated
    if ((!firstSetup && (summary.state !== 'consistent' || !allocated)) || revision !== summary.limits_revision) return
    const valid = (value: string) => value === '' || (/^\d+$/.test(value) && Number.isSafeInteger(Number(value)))
    if (![calls, input, output].every(valid)) {
      setError('입력한 한도에 0 이상의 안전한 정수를 입력하거나 비운 뒤 다시 계산해 주세요.')
      return
    }
    const canCalculateInput = (summary.input_state === 'enforced' || summary.input_state === 'unconfigured') && (allocated?.input_tokens != null || firstSetup && summary.input_state === 'unconfigured' && summary.legacy_live_run_count === 0)
    if (![required.calls, required.output_tokens, required.input_tokens, (allocated?.calls ?? 0) + required.calls, (allocated?.output_tokens ?? 0) + required.output_tokens, ...(canCalculateInput ? [(allocated?.input_tokens ?? 0) + required.input_tokens] : [])].every(Number.isSafeInteger)) {
      setError('계산 결과가 안전한 숫자 범위를 벗어났습니다. 한도를 직접 확인해 주세요.'); return
    }
    if (calculated && calculated.calls.needed === required.calls && calculated.output.needed === required.output_tokens && (!calculated.input || calculated.input.needed === required.input_tokens)) {
      setInputOpen(true); return
    }
    setCalculated({
      calls: { used: allocated?.calls ?? 0, needed: required.calls, parts: amountParts(summary, 'calls', allocated?.calls ?? 0) },
      input: canCalculateInput ? { used: allocated?.input_tokens ?? 0, needed: required.input_tokens, parts: amountParts(summary, 'input', allocated?.input_tokens ?? 0) } : null,
      output: { used: allocated?.output_tokens ?? 0, needed: required.output_tokens, parts: amountParts(summary, 'output', allocated?.output_tokens ?? 0) },
    })
    setCalls(String(required.calls)); setOutput(String(required.output_tokens)); setInputOpen(true)
    if (canCalculateInput) setInput(String(required.input_tokens))
    else setInput(summary.limits?.input_tokens?.toString() ?? '')
    setError('')
    setFillNotice(canCalculateInput ? '이번 평가에 확보할 최대량입니다. 저장 전 전체 한도를 확인할 수 있습니다.' : '요청 횟수와 답변에 확보할 양을 입력했습니다. 입력 사용량은 확인할 수 없어 전체 한도를 자동 계산하지 않았습니다.')
  }

  const clearCalculation = () => {
    setCalls(previous?.calls.toString() ?? '')
    setInput(previous?.input_tokens?.toString() ?? '')
    setOutput(previous?.output_tokens.toString() ?? '')
    setCheckedNeeds(null); setCalculated(null); setFillNotice(''); setError(''); setInputOpen(false)
    setPlanningKey((value) => value + 1)
  }
  const save = async () => {
    if (!proposal || submitting.current) return
    submitting.current = true; setBusy(true); setError('')
    try {
      if (calculated && !attempted) {
        const current = await getBudgetSummary()
        if (!checkSnapshot(current)) {
          setProposal(null); setAttempted(false)
          setError('예산 사용량이나 한도가 바뀌었습니다. 예산을 새로고침하고 필요량을 다시 확인해 주세요.')
          return
        }
      }
      setAttempted(true)
      await setBudgetLimits(proposal, owner)
      setOpened(false); onSaved()
    } catch (failure) {
      if (failure instanceof OpsApiError && [401, 403].includes(failure.status)) onExpired()
      setError(failure instanceof Error ? failure.message : '한도 저장 결과를 확인하지 못했습니다.')
    } finally { submitting.current = false; setBusy(false) }
  }
  if (!summary.limits_revision) return null
  return <section aria-label="누적 한도 설정" className="space-y-5">
    {!opened && <button type="button" className={`${styles.primaryButton} max-sm:w-full`} disabled={busy || summary.state === 'inconsistent'} onClick={open}>{summary.limits ? '전체 한도 변경하기' : '전체 한도 설정하기'}</button>}
    {opened && <>
      <nav aria-label="예산 설정 단계" className="grid grid-cols-3 gap-1 rounded-xl bg-surface-muted p-1 text-center text-xs sm:text-sm">
        {['필요량 확인', '사용량 입력', '확인 및 저장'].map((label, index) => {
          const current = proposal ? 2 : inputOpen ? 1 : 0
          return <span key={label} aria-current={index === current ? 'step' : undefined} className={`rounded-lg px-1 py-2.5 font-semibold sm:px-3 ${index === current ? 'bg-white text-brand-primary shadow-sm' : 'text-ink-muted'}`}>
            <span className="mr-1">{index + 1}.</span>{label}
          </span>
        })}
      </nav>
      {error && <p role="alert">{error}</p>}
      <div ref={planningHeading} tabIndex={-1} hidden={inputOpen || Boolean(proposal)} className="space-y-3 focus-visible:outline-2 focus-visible:outline-brand-primary">
        <BudgetPlanningPanel key={planningKey} summary={summary} revision={revision} onApply={applyRequired} onContinueManually={() => setInputOpen(true)} onResultChange={(value) => { setCheckedNeeds(value); if (!value && calculated) { setCalculated(null); setCalls(previous?.calls.toString() ?? ''); setInput(previous?.input_tokens?.toString() ?? ''); setOutput(previous?.output_tokens.toString() ?? '') } }} onExpired={onExpired} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <button type="button" className={styles.secondaryButton} onClick={() => setOpened(false)}>닫기</button>
          {!checkedNeeds && <button type="button" className={styles.secondaryButton} onClick={() => setInputOpen(true)}>필요량 확인 없이 직접 입력</button>}
        </div>
      </div>
      <div hidden={!inputOpen || Boolean(proposal)} className="space-y-4 rounded-xl border border-line bg-white p-4 sm:p-5">
      {fillNotice && !proposal && <p role="status" className="text-sm text-brand-primary">{fillNotice}</p>}
      <form className="grid gap-x-5 gap-y-5 text-sm sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void review() }}>
        <div className="space-y-1 sm:col-span-2"><h3 ref={inputHeading} tabIndex={-1} className="text-lg font-bold text-ink focus-visible:outline-2 focus-visible:outline-brand-primary">2. 얼마나 사용할지 정하기</h3>{calculated ? <p className="leading-6 text-ink-muted">아래 값은 점검 시점 기준이며 한도는 모든 평가가 함께 사용합니다.{summary.legacy_live_run_count > 0 && ' 사용량을 확인하지 못한 이전 평가는 표시된 장부에서 제외됩니다.'}</p> : <p className="leading-6 text-ink-muted">이전 사용량과 앞으로 사용할 양을 포함한 전체 허용량을 입력하세요. 필요한 양은 이전 단계에서 확인할 수 있습니다.</p>}</div>
      <details className="rounded-lg bg-surface-muted p-3 text-sm sm:col-span-2">
        <summary className="cursor-pointer font-semibold">한도 입력 도움말</summary>
        <div className="mt-2 space-y-2 leading-6 text-ink-muted">
          <p>AI 요청 횟수는 평가 횟수와 다르며, 한 질문에서 여러 번 요청할 수 있습니다. 입력 토큰은 AI에 보내는 양이고 출력 토큰은 AI가 만드는 답변의 양입니다.</p>
          <p>입력 한도를 처음 설정하지 않으려면 빈칸으로 두세요. 한번 설정하면 해제할 수 없으며, 0은 미설정이 아니라 한도 0입니다.</p>
          <p>예: 현재 20회 할당 + 추가 6회 예약 = 호출 한도 26회.</p>
          <p>변경 사유를 적지 않으면 자동 생성된 내용이 이력에 저장됩니다.</p>
        </div>
      </details>
        <div className="space-y-1">
          <label className="grid gap-2 font-semibold text-ink">{calculated ? 'AI 요청 확보 횟수' : 'AI 요청 허용 횟수'}<input className="min-h-11 rounded-lg border border-line px-3 py-2 focus:outline-2 focus:outline-brand-primary" inputMode="numeric" value={calls} onChange={(event) => { setCalls(event.target.value); setFillNotice('') }} aria-describedby={`${helpId}-calls`} required /></label>
          {calculated && <CalculationPreview label="AI 요청" value={calculated.calls} entered={calls} currentLimit={previous?.calls} unit="회" />}<p id={`${helpId}-calls`} className="sr-only">답변 생성·임베딩 등에 사용하는 API 호출의 총횟수입니다. 평가 횟수나 질문 수를 뜻하지 않습니다. RAG 평가는 문서·질문 임베딩과 답변 호출을 합합니다.</p>
        </div>
        <div className="space-y-1">
          <label className="grid gap-2 font-semibold text-ink">{calculated ? 'AI 답변 확보량 (출력 토큰)' : 'AI 답변 허용량 (출력 토큰)'}<input className="min-h-11 rounded-lg border border-line px-3 py-2 focus:outline-2 focus:outline-brand-primary" inputMode="numeric" value={output} onChange={(event) => { setOutput(event.target.value); setFillNotice('') }} aria-describedby={`${helpId}-output`} required /></label>
          {calculated && <CalculationPreview label="AI 답변" value={calculated.output} entered={output} currentLimit={previous?.output_tokens} unit="토큰" />}<p id={`${helpId}-output`} className="sr-only">모델이 생성하는 답변 등 출력 분량의 총상한입니다. 평가별 최대 출력량을 합산해 정합니다.</p>
        </div>
        <div className="space-y-2 sm:col-span-2">
          <div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-ink">{calculated?.input ? 'AI에 보내는 내용 확보량 (입력 토큰)' : 'AI에 보내는 내용 허용량 (입력 토큰)'}</span><details className="relative"><summary aria-label="입력 한도 도움말" className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-line text-xs font-bold">?</summary><p className="mt-2 rounded-lg bg-surface-muted p-3 text-xs leading-5 text-ink-muted">질문과 공고 등 AI에 보내는 내용의 양입니다. 처음에는 비워 둘 수 있습니다. 설정 후에는 해제할 수 없으며, 0을 입력하면 사용할 수 없습니다.</p></details></div>
          <input aria-label={calculated?.input ? 'AI에 보내는 내용 확보량 (입력 토큰)' : 'AI에 보내는 내용 허용량 (입력 토큰)'} className="min-h-11 w-full rounded-lg border border-line px-3 py-2 focus:outline-2 focus:outline-brand-primary disabled:bg-surface-muted" inputMode="numeric" value={input} onChange={(event) => { setInput(event.target.value); setFillNotice('') }} aria-describedby={`${helpId}-input`} required={previous?.input_tokens != null} disabled={summary.input_state === 'legacy_unknown' && previous?.input_tokens == null && input === ''} />
          {checkedNeeds && (calculated?.input ? <CalculationPreview label="AI에 보내는 내용" value={calculated.input} entered={input} currentLimit={previous?.input_tokens} unit="토큰" /> : <p className="text-sm text-ink-muted">이번 평가 최대 {checkedNeeds.input_tokens.toLocaleString('ko-KR')}토큰 · 기존 사용량을 확인할 수 없어 전체 한도를 자동 계산하지 않았습니다.</p>)}
          {summary.input_state === 'legacy_unknown' && <p id={`${helpId}-input`} className="text-xs leading-5 text-amber-800">이전 평가의 사용량을 확인하기 전에는 입력 한도를 설정할 수 없습니다. {summary.legacy_live_run_count > 0 ? <> <a href="#budget-unaccounted" className="font-semibold underline">이전 평가 기록 확인하기</a>. 필요한 정보가 없으면 자동 반영할 수 없습니다.</> : '관리자에게 사용 기록 확인을 요청해 주세요.'} 검색·RAG 평가는 입력 한도를 설정한 뒤 실행할 수 있습니다.</p>}
          {summary.input_state !== 'legacy_unknown' && <p id={`${helpId}-input`} className="sr-only">입력 한도는 처음에는 비워 둘 수 있지만, 설정 후에는 해제할 수 없습니다. 숫자 0은 사용량 한도 0입니다.</p>}
        </div>
        <details className="rounded-lg bg-surface-muted p-3 text-sm sm:col-span-2">
          <summary className="cursor-pointer font-semibold">변경 이유 직접 적기 (선택)</summary>
          <label className="mt-3 grid gap-2 font-semibold text-ink">한도 변경 사유<textarea className="min-h-20 rounded-lg border border-line bg-white px-3 py-2 focus:outline-2 focus:outline-brand-primary" placeholder="예: 공고 답변 평가 1회 진행" value={reason} onChange={(event) => setReason(event.target.value)} aria-describedby={`${helpId}-reason`} maxLength={1000} /></label>
          <p id={`${helpId}-reason`} className="mt-2 text-xs leading-5 text-ink-muted">비워 두면 ‘자동 생성: AI 평가 사용량 한도 설정’으로 변경 이력에 기록됩니다.</p>
        </details>
        <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col-reverse gap-2 sm:flex-row"><button className={styles.secondaryButton} type="button" onClick={() => setOpened(false)}>닫기</button><button className={styles.secondaryButton} type="button" onClick={() => setInputOpen(false)}>이전: 필요한 양 확인</button>{checkedNeeds && <button className={styles.secondaryButton} type="button" onClick={clearCalculation}>계산 지우기</button>}</div>
          <button className={styles.primaryButton} type="submit" disabled={busy}>{busy ? '예산 확인 중…' : '입력 내용 확인'}</button>
        </div>
      </form>
      </div>
      {proposal && <div className="space-y-3 rounded-xl bg-[#f3f7f5] p-4 text-sm">
        <h3 ref={reviewHeading} tabIndex={-1} className="text-base font-bold text-ink focus-visible:outline-2 focus-visible:outline-brand-primary">3. 입력 내용 확인 후 저장</h3><p>한도는 모든 평가가 함께 사용합니다. 저장해도 평가가 실행되지는 않으며, 실행할 때 사용 가능 여부를 다시 확인합니다.</p><p>호출: {amount(previous?.calls, '회')} → {amount(proposal.calls, '회')}</p>
        <p>입력: {amount(previous?.input_tokens, '토큰')} → {amount(proposal.input_tokens, '토큰')}</p>
        <p>출력: {amount(previous?.output_tokens, '토큰')} → {amount(proposal.output_tokens, '토큰')}</p>
        <p>사유: {proposal.reason}</p>
        <p className="sr-only">로그인한 관리자 계정으로 변경 이력이 저장됩니다. 다른 운영자의 변경과 이미 할당된 사용량은 저장 시 다시 확인합니다.</p>
        <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col-reverse gap-2 sm:flex-row"><button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => setOpened(false)}>닫기</button><button type="button" className={styles.secondaryButton} disabled={busy || attempted} onClick={() => { setProposal(null); setError('') }}>입력 수정</button></div>
          <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => void save()}>{busy ? '저장 중…' : '확인한 한도 저장'}</button>
        </div>
        {error && <p>결과가 불확실하면 위 저장 버튼으로 같은 요청을 재확인할 수 있습니다. 조건을 바꾸려면 먼저 예산을 새로고침하세요.</p>}
      </div>}
    </>}
  </section>
}
