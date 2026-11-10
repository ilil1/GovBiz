import { createRequestId } from './requestId'
import { useId, useRef, useState } from 'react'
import { OpsApiError, setDailyBudgetLimits, type DailyBudget, type DailyBudgetLimitsInput } from '../../../data/ops/opsApi'
import { workspacePageStyles as styles } from '../../shared/workspace/WorkspacePage.styles'

export function DailyBudgetLimitsForm({ daily, owner, onSaved, onExpired }: {
  daily: DailyBudget | undefined; owner: string; onSaved: () => void; onExpired: () => void
}) {
  const helpId = useId()
  const [opened, setOpened] = useState(false)
  const [disable, setDisable] = useState(false)
  const [calls, setCalls] = useState('')
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [reason, setReason] = useState('')
  const [revision, setRevision] = useState('')
  const [previous, setPrevious] = useState(daily)
  const [proposal, setProposal] = useState<DailyBudgetLimitsInput | null>(null)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)
  if (!daily?.limits_revision) return null
  // A successful write may have lost its response: keep that exact request retryable.
  const stale = !attempted && revision !== daily.limits_revision
  const open = (disableLimit: boolean) => {
    setPrevious(daily); setRevision(daily.limits_revision!); setDisable(disableLimit)
    setCalls(daily.limits?.calls.toString() ?? '')
    setInput(daily.limits?.input_tokens.toString() ?? '')
    setOutput(daily.limits?.output_tokens.toString() ?? '')
    setReason(''); setProposal(null); setError(''); setConflict(false); setAttempted(false); setOpened(true)
  }
  const review = () => {
    if (stale || conflict) return
    const valid = (value: string) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value))
    if ((!disable && ![calls, input, output].every(valid)) || reason.trim().length > 1000) {
      setError('호출·입력·출력에 0 이상의 정수 한도를 입력하세요.'); return
    }
    const shared = { request_id: createRequestId(), expected_revision: revision, reason: reason.trim() || (disable ? '자동 생성: 하루 한도 해제' : '자동 생성: 하루 한도 설정') }
    setProposal(disable ? { ...shared, disable: true, calls: null, input_tokens: null, output_tokens: null }
      : { ...shared, disable: false, calls: Number(calls), input_tokens: Number(input), output_tokens: Number(output) })
    setError('')
  }
  const save = async () => {
    if (!proposal || submitting.current || stale || conflict) return
    submitting.current = true; setBusy(true); setAttempted(true); setError('')
    try {
      await setDailyBudgetLimits(proposal, owner)
      setOpened(false); onSaved()
    } catch (failure) {
      if (failure instanceof OpsApiError && [401, 403].includes(failure.status)) onExpired()
      if (failure instanceof OpsApiError && failure.status === 409) setConflict(true)
      setError(failure instanceof Error ? failure.message : '일별 한도 저장 결과를 확인하지 못했습니다.')
    } finally { submitting.current = false; setBusy(false) }
  }
  const amount = (value: number | undefined) => value === undefined ? '미설정' : value.toLocaleString('ko-KR')
  return <section aria-label="일별 한도 설정" className="space-y-5">
    {!opened && <div className="flex flex-wrap gap-2">
      <button type="button" className={`${styles.primaryButton} max-sm:w-full`} disabled={busy} onClick={() => open(false)}>{daily.state === 'disabled' ? '하루 한도 설정하기' : '하루 한도 변경하기'}</button>
      {daily.state !== 'disabled' && daily.limits && <button type="button" className={`${styles.secondaryButton} max-sm:w-full`} disabled={busy} onClick={() => open(true)}>하루 한도 해제하기</button>}
    </div>}
    {opened && <>
      {error && <p role="alert">{error}</p>}
      {(stale || conflict) && <p role="alert">일별 정책을 다시 확인해야 합니다. 예산 새로고침 후 변경 내용을 다시 작성하세요.</p>}
      {!proposal ? <form className="grid gap-3 text-sm sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); review() }}>
        <h4 className="font-bold text-ink sm:col-span-2">{disable ? '하루 한도 해제' : '하루 한도 설정'}</h4>
        {disable && <p className="rounded-lg bg-amber-50 p-3 leading-6 text-amber-800 sm:col-span-2">하루 제한을 해제하면 누적 한도는 유지되지만, 정기 평가에 필요한 일별 예산 조건을 충족하지 못합니다.</p>}
        {!disable && <>
          <p id={`${helpId}-zero`} className="text-xs text-ink-muted sm:col-span-2">0은 제한 해제가 아닌 사용 불가를 뜻합니다.</p>
          <label className="grid gap-1">AI 요청 (회)<input className="min-h-11 rounded-lg border border-line px-3 py-2 focus:outline-2 focus:outline-brand-primary" inputMode="numeric" value={calls} disabled={stale || conflict} onChange={(event) => setCalls(event.target.value)} aria-describedby={`${helpId}-zero`} required /></label>
          <label className="grid gap-1">AI에 보내는 내용 (입력 토큰)<input className="min-h-11 rounded-lg border border-line px-3 py-2 focus:outline-2 focus:outline-brand-primary" inputMode="numeric" value={input} disabled={stale || conflict} onChange={(event) => setInput(event.target.value)} aria-describedby={`${helpId}-zero`} required /></label>
          <label className="grid gap-1">AI 답변 (출력 토큰)<input className="min-h-11 rounded-lg border border-line px-3 py-2 focus:outline-2 focus:outline-brand-primary" inputMode="numeric" value={output} disabled={stale || conflict} onChange={(event) => setOutput(event.target.value)} aria-describedby={`${helpId}-zero`} required /></label>
        </>}
        <details className="rounded-lg bg-surface-muted p-3 text-sm sm:col-span-2">
          <summary className="cursor-pointer font-semibold">변경 이유 직접 적기 (선택)</summary>
          <label className="mt-3 grid gap-1">일별 한도 변경 사유<textarea className="min-h-20 rounded-lg border border-line px-3 py-2 focus:outline-2 focus:outline-brand-primary" placeholder="예: 하루 공고 답변 평가 1회 진행" value={reason} disabled={stale || conflict} onChange={(event) => setReason(event.target.value)} aria-describedby={`${helpId}-reason`} maxLength={1000} /></label>
          <p id={`${helpId}-reason`} className="mt-2 text-xs text-ink-muted">비워 두면 자동 생성된 사유가 변경 이력에 기록됩니다.</p>
        </details>
        <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
          <button className={styles.secondaryButton} type="button" onClick={() => setOpened(false)}>일별 설정 닫기</button>
          <button className={styles.primaryButton} type="submit" disabled={stale || conflict}>{disable ? '해제 내용 확인' : '일별 변경 내용 확인'}</button>
        </div>
      </form> : <div className="space-y-3 rounded-xl bg-[#f3f7f5] p-4 text-sm">
        <p className="font-semibold">{proposal.disable ? '하루 한도 해제 확인' : '저장할 하루 한도 확인'}</p>
        <p>일별 제한: {previous?.state === 'disabled' ? '미적용' : '적용 중'} → {proposal.disable ? '해제' : '적용'}</p>
        {proposal.disable ? <p>일별 제한을 해제하면 누적 한도만 적용됩니다. 기존 예약·미확정 사용량·변경 이력은 유지되며, 정기 평가에 필요한 일별 예산 조건은 충족하지 못합니다.</p>
          : (['calls', 'input_tokens', 'output_tokens'] as const).map((key) => <p key={key}>{({ calls: '호출', input_tokens: '입력 토큰', output_tokens: '출력 토큰' })[key]}: {amount(previous?.limits?.[key])} → {amount(proposal[key])}{key === 'calls' ? '회' : '토큰'}</p>)}
        <p>사유: {proposal.reason}</p>
        <p className="sr-only">로그인한 관리자 계정으로 기록하며, 저장 시 최신 정책과 오늘 할당량·전날 이월량을 다시 검사합니다.</p>
        <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col-reverse gap-2 sm:flex-row"><button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => setOpened(false)}>일별 설정 닫기</button><button type="button" className={styles.secondaryButton} disabled={busy || attempted} onClick={() => { setProposal(null); setError('') }}>입력 수정</button></div>
          <button type="button" className={styles.primaryButton} disabled={busy || stale || conflict} onClick={() => void save()}>{busy ? '저장 중…' : '확인한 일별 정책 저장'}</button>
        </div>
        {error && !conflict && <p>응답을 확인하지 못했다면 위 저장 버튼으로 같은 요청을 재확인하세요.</p>}
      </div>}
    </>}
  </section>
}
