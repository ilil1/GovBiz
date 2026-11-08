import { createRequestId } from './requestId'
import { useEffect, useId, useRef, useState } from 'react'
import { OpsApiError, setBudgetLimits, type BudgetLimitsInput, type BudgetSummary } from '../../../data/ops/opsApi'
import { workspacePageStyles as styles } from '../../shared/workspace/WorkspacePage.styles'
import { BudgetPlanningPanel } from './BudgetPlanningPanel'

const amount = (value: number | null | undefined, unit: string) => value == null ? '미설정' : `${value.toLocaleString('ko-KR')}${unit}`

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
    setProposal(null); setError(''); setFillNotice(''); setCheckedNeeds(null); setAttempted(false); setInputOpen(false); setOpened(true)
  }
  const review = () => {
    const valid = (value: string) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value))
    if (!valid(calls) || !valid(output) || (input !== '' && !valid(input)) || !reason.trim() || reason.trim().length > 1000) {
      setError('0 이상의 정수 한도와 변경 사유를 입력하세요.'); return
    }
    setAttempted(false)
    setProposal({ request_id: createRequestId(), expected_revision: revision,
      calls: Number(calls), output_tokens: Number(output), input_tokens: input === '' ? null : Number(input), reason: reason.trim() })
    setError('')
  }
  const applyRequired = (required: { calls: number; input_tokens: number; output_tokens: number }) => {
    const allocated = summary.allocated
    if (summary.state !== 'consistent' || !allocated || revision !== summary.limits_revision) return
    const valid = (value: string) => value === '' || (/^\d+$/.test(value) && Number.isSafeInteger(Number(value)))
    if (![calls, input, output].every(valid)) {
      setError('입력한 한도에 0 이상의 안전한 정수를 입력하거나 비운 뒤 다시 계산해 주세요.')
      return
    }
    const choose = (needed: number, used: number, limit: number | null | undefined, current: string) => {
      const sum = needed + used
      if (!Number.isSafeInteger(sum)) return null
      return String(Math.max(sum, limit ?? 0, current === '' ? 0 : Number(current)))
    }
    const nextCalls = choose(required.calls, allocated.calls, summary.limits?.calls, calls)
    const nextOutput = choose(required.output_tokens, allocated.output_tokens, summary.limits?.output_tokens, output)
    const canCalculateInput = (summary.input_state === 'enforced' || summary.input_state === 'unconfigured') && allocated.input_tokens != null
    const nextInput = canCalculateInput ? choose(required.input_tokens, allocated.input_tokens!, summary.limits?.input_tokens, input) : input
    if (nextCalls === null || nextOutput === null || nextInput === null) {
      setError('계산 결과가 안전한 숫자 범위를 벗어났습니다. 한도를 직접 확인해 주세요.')
      return
    }
    setCalls(nextCalls); setOutput(nextOutput); setInputOpen(true)
    if (canCalculateInput) setInput(nextInput)
    setError('')
    setFillNotice('필요량을 입력했습니다. 아래 값을 확인한 뒤 변경 내용을 확인해 주세요. 아직 저장되지는 않았습니다.')
  }
  const save = async () => {
    if (!proposal || submitting.current) return
    submitting.current = true; setBusy(true); setAttempted(true); setError('')
    try {
      await setBudgetLimits(proposal, owner)
      setOpened(false); onSaved()
    } catch (failure) {
      if (failure instanceof OpsApiError && [401, 403].includes(failure.status)) onExpired()
      setError(failure instanceof Error ? failure.message : '한도 저장 결과를 확인하지 못했습니다.')
    } finally { submitting.current = false; setBusy(false) }
  }
  if (!summary.limits_revision) return null
  return <section aria-label="누적 한도 설정" className="space-y-5">
    {!opened && <button type="button" className={`${styles.primaryButton} max-sm:w-full`} disabled={busy || summary.state === 'inconsistent'} onClick={open}>{summary.limits ? 'AI 평가 사용량 변경하기' : 'AI 평가 사용량 설정하기'}</button>}
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
        <BudgetPlanningPanel summary={summary} revision={revision} onApply={applyRequired} onContinueManually={() => setInputOpen(true)} onResultChange={setCheckedNeeds} onExpired={onExpired} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <button type="button" className={styles.secondaryButton} onClick={() => setOpened(false)}>닫기</button>
          {!checkedNeeds && <button type="button" className={styles.secondaryButton} onClick={() => setInputOpen(true)}>필요량 확인 없이 직접 입력</button>}
        </div>
      </div>
      <div hidden={!inputOpen || Boolean(proposal)} className="space-y-4 rounded-xl border border-line bg-white p-4 sm:p-5">
      {fillNotice && !proposal && <p role="status" className="text-sm text-brand-primary">{fillNotice}</p>}
      <form className="grid gap-x-5 gap-y-5 text-sm sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); review() }}>
        <div className="space-y-1 sm:col-span-2"><h3 ref={inputHeading} tabIndex={-1} className="text-lg font-bold text-ink focus-visible:outline-2 focus-visible:outline-brand-primary">2. 얼마나 사용할지 정하기</h3>{checkedNeeds ? <p className="leading-6 text-ink-muted">각 항목 아래의 숫자는 선택한 평가 1회에 필요한 최대치입니다. 전체 허용량에는 이전 사용량도 포함해야 합니다.</p> : <p className="leading-6 text-ink-muted">이전 사용량과 앞으로 사용할 양을 포함한 전체 허용량을 입력하세요. 필요한 양은 이전 단계에서 확인할 수 있습니다.</p>}</div>
      <details className="rounded-lg bg-surface-muted p-3 text-sm sm:col-span-2">
        <summary className="cursor-pointer font-semibold">한도 입력 도움말</summary>
        <div className="mt-2 space-y-2 leading-6 text-ink-muted">
          <p>호출은 모델 API를 사용하는 횟수입니다. 입력 토큰은 모델에 보내는 분량, 출력 토큰은 모델이 생성하는 분량입니다.</p>
          <p>입력 한도를 처음 설정하지 않으려면 빈칸으로 두세요. 한번 설정하면 해제할 수 없으며, 0은 미설정이 아니라 한도 0입니다.</p>
          <p>예: 현재 20회 할당 + 추가 6회 예약 = 호출 한도 26회.</p>
          <p>변경 사유에는 평가 목적과 한도를 정한 이유를 적어 주세요.</p>
        </div>
      </details>
        <div className="space-y-1">
          <label className="grid gap-2 font-semibold text-ink">AI 요청 허용 횟수<input className="min-h-11 rounded-lg border border-line px-3 py-2 focus:outline-2 focus:outline-brand-primary" inputMode="numeric" value={calls} onChange={(event) => { setCalls(event.target.value); setFillNotice('') }} aria-describedby={`${helpId}-calls`} required /></label>
          {checkedNeeds && <p className="text-sm font-semibold text-brand-primary">이번 평가 1회 최대 {checkedNeeds.calls.toLocaleString('ko-KR')}회</p>}<p className="text-xs leading-5 text-ink-muted">AI에 요청할 수 있는 전체 횟수입니다. 질문 한 개에 여러 번 요청할 수도 있습니다.</p><p id={`${helpId}-calls`} className="sr-only">답변 생성·임베딩 등에 사용하는 API 호출의 총횟수입니다. 평가 횟수나 질문 수를 뜻하지 않습니다. RAG 평가는 문서·질문 임베딩과 답변 호출을 합합니다.</p>
        </div>
        <div className="space-y-1">
          <label className="grid gap-2 font-semibold text-ink">AI 답변 허용량 (출력 토큰)<input className="min-h-11 rounded-lg border border-line px-3 py-2 focus:outline-2 focus:outline-brand-primary" inputMode="numeric" value={output} onChange={(event) => { setOutput(event.target.value); setFillNotice('') }} aria-describedby={`${helpId}-output`} required /></label>
          {checkedNeeds && <p className="text-sm font-semibold text-brand-primary">이번 평가 1회 최대 {checkedNeeds.output_tokens.toLocaleString('ko-KR')}토큰</p>}<p className="text-xs leading-5 text-ink-muted">AI가 생성할 답변의 전체 분량입니다. 토큰은 글자 수와 다른 AI 사용량 단위입니다.</p><p id={`${helpId}-output`} className="sr-only">모델이 생성하는 답변 등 출력 분량의 총상한입니다. 평가별 최대 출력량을 합산해 정합니다.</p>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <label className="grid gap-2 font-semibold text-ink">AI에 보내는 내용 허용량 (입력 토큰)<input className="min-h-11 rounded-lg border border-line px-3 py-2 focus:outline-2 focus:outline-brand-primary" inputMode="numeric" value={input} onChange={(event) => { setInput(event.target.value); setFillNotice('') }} aria-describedby={`${helpId}-input`} required={previous?.input_tokens != null} /></label>
          {checkedNeeds && <p className="text-sm font-semibold text-brand-primary">이번 평가 1회 최대 {checkedNeeds.input_tokens.toLocaleString('ko-KR')}토큰</p>}<p className="text-xs leading-5 text-ink-muted">질문과 공고 내용처럼 AI에 전달하는 전체 분량입니다.</p><p className="text-xs leading-5 text-ink-muted">{previous?.input_tokens == null ? '처음에는 비워 둘 수 있습니다. 입력 후에는 해제할 수 없으며, 0은 한도 0입니다.' : '설정된 입력 한도는 비울 수 없습니다. 0은 한도 0입니다.'}</p>
          {summary.input_state === 'legacy_unknown' && <p className="text-xs leading-5 text-amber-800">과거 입력 사용량이 확인되지 않아 지금은 이 칸을 비워 두세요. {summary.legacy_live_run_count > 0 ? <> <a href="#budget-unaccounted" className="font-semibold underline">이전 평가 기록으로 이동</a>해 기록 확인 버튼을 눌러 확인할 수 있습니다. 확인할 수 없는 기록은 자동으로 반영되지 않습니다.</> : '목록에서 확인할 기록이 없습니다. 관리자에게 과거 사용 기록 확인을 요청하세요.'} 입력 한도를 설정하기 전에는 검색·RAG 평가를 실행할 수 없습니다.</p>}
          <p id={`${helpId}-input`} className="sr-only">질문·지침·근거 등 모델에 보내는 분량의 총상한입니다. 토큰은 문자 수와 다릅니다. 과거 미확인 입력 기록을 해결한 뒤 설정할 수 있습니다. 최초 미설정은 빈칸으로 두며, 한 번 설정하면 해제할 수 없습니다. 숫자 0은 미설정이 아닌 한도 0입니다.</p>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <label className="grid gap-2 font-semibold text-ink">한도 변경 사유<textarea className="min-h-20 rounded-lg border border-line px-3 py-2 focus:outline-2 focus:outline-brand-primary" placeholder="예: 공고 답변 평가 1회 진행" value={reason} onChange={(event) => setReason(event.target.value)} aria-describedby={`${helpId}-reason`} maxLength={1000} required /></label>
          <p id={`${helpId}-reason`} className="sr-only">평가 목적·범위와 한도를 정한 근거를 남기세요. 예: “검토 자료 H01~H06 답변 평가 1회분을 현재 할당량에 추가”.</p>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col-reverse gap-2 sm:flex-row"><button className={styles.secondaryButton} type="button" onClick={() => setOpened(false)}>닫기</button><button className={styles.secondaryButton} type="button" onClick={() => setInputOpen(false)}>이전: 필요한 양 확인</button></div>
          <button className={styles.primaryButton} type="submit">입력 내용 확인</button>
        </div>
      </form>
      </div>
      {proposal && <div className="space-y-3 rounded-xl bg-[#f3f7f5] p-4 text-sm">
        <h3 ref={reviewHeading} tabIndex={-1} className="text-base font-bold text-ink focus-visible:outline-2 focus-visible:outline-brand-primary">3. 입력 내용 확인 후 저장</h3><p>아래 내용은 아직 저장되지 않았습니다. 확인한 뒤 저장해 주세요.</p><p>호출: {amount(previous?.calls, '회')} → {amount(proposal.calls, '회')}</p>
        <p>입력: {amount(previous?.input_tokens, '토큰')} → {amount(proposal.input_tokens, '토큰')}</p>
        <p>출력: {amount(previous?.output_tokens, '토큰')} → {amount(proposal.output_tokens, '토큰')}</p>
        <p>사유: {proposal.reason}</p>
        <p>로그인한 관리자 계정으로 변경 이력이 저장됩니다. 다른 운영자의 변경과 이미 할당된 사용량은 저장 시 다시 확인합니다.</p>
        <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col-reverse gap-2 sm:flex-row"><button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => setOpened(false)}>닫기</button><button type="button" className={styles.secondaryButton} disabled={busy || attempted} onClick={() => { setProposal(null); setError('') }}>입력 수정</button></div>
          <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => void save()}>{busy ? '저장 중…' : '확인한 한도 저장'}</button>
        </div>
        {error && <p>결과가 불확실하면 위 저장 버튼으로 같은 요청을 재확인할 수 있습니다. 조건을 바꾸려면 먼저 예산을 새로고침하세요.</p>}
      </div>}
    </>}
  </section>
}
