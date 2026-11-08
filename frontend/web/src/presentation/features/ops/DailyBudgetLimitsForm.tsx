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
  const open = () => {
    setPrevious(daily); setRevision(daily.limits_revision!); setDisable(false)
    setCalls(daily.limits?.calls.toString() ?? '')
    setInput(daily.limits?.input_tokens.toString() ?? '')
    setOutput(daily.limits?.output_tokens.toString() ?? '')
    setReason(''); setProposal(null); setError(''); setConflict(false); setAttempted(false); setOpened(true)
  }
  const review = () => {
    if (stale || conflict) return
    const valid = (value: string) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value))
    if ((!disable && ![calls, input, output].every(valid)) || !reason.trim() || reason.trim().length > 1000) {
      setError('호출·입력·출력에 0 이상의 정수 한도와 변경 사유를 입력하세요.'); return
    }
    const shared = { request_id: createRequestId(), expected_revision: revision, reason: reason.trim() }
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
  return <section aria-label="일별 한도 설정" className="space-y-3 border-t border-line pt-4">
    <button type="button" className={styles.secondaryButton} disabled={opened || busy} onClick={open}>일별 한도 설정</button>
    {opened && <>
      <div className="space-y-2 rounded-xl bg-white p-4 text-sm leading-6">
        <p className="font-semibold">하루에 사용할 양을 정해 주세요</p>
        <p className="text-ink-muted">새 평가에서 자료와 ‘새 응답 생성’, 모델을 선택한 뒤 ‘실행 설정·예산 점검’을 눌러 필요량을 확인하세요. 하루에 허용할 평가와 이전 미정리 예약을 고려해 직접 입력합니다.</p>
        <a className="inline-flex min-h-11 items-center font-semibold text-brand-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-brand-primary" href="/ops/evaluations/new" target="_blank" rel="noreferrer">새 평가에서 필요량 확인하기 (새 탭)</a>
        <p className="text-xs text-ink-muted">서울 시간 기준이며, 일별 한도와 누적 한도를 함께 확인합니다. 점검과 한도 저장만으로 모델 호출이나 정기 실행이 시작되지 않습니다.</p>
      </div>
      <details className="rounded-lg bg-surface-muted p-3 text-sm">
        <summary className="cursor-pointer font-semibold">일별 한도 입력 도움말</summary>
        <div className="mt-2 space-y-2 leading-6 text-ink-muted">
          <p>호출은 모델 API 사용 횟수이고, 입력·출력 토큰은 모델에 보내거나 모델이 생성하는 분량입니다. 세 항목의 하루 한도를 모두 입력해 주세요.</p>
          <p>0은 제한 해제가 아니라 한도 0입니다. 일별 제한을 해제해도 누적 한도는 유지되며 정기 실행의 일별 예산 조건은 충족하지 못합니다.</p>
          <p>변경 사유에는 하루 평가 범위와 한도 산정 이유를 적어 주세요.</p>
        </div>
      </details>
      {error && <p role="alert">{error}</p>}
      {(stale || conflict) && <p role="alert">일별 정책을 다시 확인해야 합니다. 예산 새로고침 후 변경 내용을 다시 작성하세요.</p>}
      {!proposal ? <form className="grid gap-3 text-sm sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); review() }}>
        <div className="space-y-1 sm:col-span-2">
          <label className="grid gap-1">일별 정책 변경<select className="min-h-11 rounded-lg border border-line px-3 py-2 focus:outline-2 focus:outline-brand-primary" value={disable ? 'disable' : 'enable'} disabled={stale || conflict} onChange={(event) => setDisable(event.target.value === 'disable')} aria-describedby={`${helpId}-policy`}>
            <option value="enable">한도 설정·적용</option><option value="disable" disabled={!previous?.limits || previous.state === 'disabled'}>일별 제한 해제</option>
          </select></label>
          <p id={`${helpId}-policy`} className="sr-only">적용하려면 세 한도를 모두 입력하세요. 숫자 0은 제한 해제가 아닌 한도 0입니다. 일별 제한을 해제해도 누적 한도와 기존 사용 기록은 유지되지만, 정기 실행에 필요한 일별 예산 조건을 충족하지 못합니다. 선택 후 최종 저장해야 반영됩니다.</p>
        </div>
        {!disable && <>
          <div className="space-y-1">
            <label className="grid gap-1">일별 호출 한도<input className="min-h-11 rounded-lg border border-line px-3 py-2 focus:outline-2 focus:outline-brand-primary" inputMode="numeric" value={calls} disabled={stale || conflict} onChange={(event) => setCalls(event.target.value)} aria-describedby={`${helpId}-calls`} required /></label>
            <p id={`${helpId}-calls`} className="sr-only">하루에 허용할 답변 생성·임베딩 등의 API 호출 총횟수입니다. 하루 평가 횟수와 각 평가의 최대 호출량을 함께 확인하세요.</p>
          </div>
          <div className="space-y-1">
            <label className="grid gap-1">일별 입력 토큰 한도<input className="min-h-11 rounded-lg border border-line px-3 py-2 focus:outline-2 focus:outline-brand-primary" inputMode="numeric" value={input} disabled={stale || conflict} onChange={(event) => setInput(event.target.value)} aria-describedby={`${helpId}-input`} required /></label>
            <p id={`${helpId}-input`} className="sr-only">질문·지침·근거 등 모델에 보내는 하루 입력 분량입니다. 예정된 평가의 최대 입력량을 합산하세요. 토큰은 문자 수와 다릅니다.</p>
          </div>
          <div className="space-y-1">
            <label className="grid gap-1">일별 출력 토큰 한도<input className="min-h-11 rounded-lg border border-line px-3 py-2 focus:outline-2 focus:outline-brand-primary" inputMode="numeric" value={output} disabled={stale || conflict} onChange={(event) => setOutput(event.target.value)} aria-describedby={`${helpId}-output`} required /></label>
            <p id={`${helpId}-output`} className="sr-only">모델이 생성하는 하루 출력 분량입니다. 예정된 평가의 최대 출력량을 합산하세요. 당일 할당량과 전날 이월량보다 낮게 저장할 수 없습니다.</p>
          </div>
        </>}
        <div className="space-y-1 sm:col-span-2">
          <label className="grid gap-1">일별 한도 변경 사유<textarea className="min-h-20 rounded-lg border border-line px-3 py-2 focus:outline-2 focus:outline-brand-primary" placeholder="예: 하루 공고 답변 평가 1회 진행" value={reason} disabled={stale || conflict} onChange={(event) => setReason(event.target.value)} aria-describedby={`${helpId}-reason`} maxLength={1000} required /></label>
          <p id={`${helpId}-reason`} className="sr-only">하루 평가 범위와 한도 산정 근거 또는 해제 이유를 남기세요. 예: “하루 답변 평가 1회분과 이월 예약량을 반영”.</p>
        </div>
        <div className="flex flex-col-reverse gap-2 pt-2 sm:col-span-2 sm:flex-row sm:justify-end">
          <button className={styles.secondaryButton} type="button" onClick={() => setOpened(false)}>일별 설정 닫기</button>
          <button className={styles.primaryButton} type="submit" disabled={stale || conflict}>일별 변경 내용 확인</button>
        </div>
      </form> : <div className="space-y-3 rounded-xl bg-[#f3f7f5] p-4 text-sm">
        <p>일별 제한: {previous?.state === 'disabled' ? '미적용' : '적용 중'} → {proposal.disable ? '해제' : '적용'}</p>
        {proposal.disable ? <p>일별 제한을 해제하면 누적 한도만 적용됩니다. 기존 예약·미확정 사용량·변경 이력은 유지됩니다.</p>
          : (['calls', 'input_tokens', 'output_tokens'] as const).map((key) => <p key={key}>{({ calls: '호출', input_tokens: '입력 토큰', output_tokens: '출력 토큰' })[key]}: {amount(previous?.limits?.[key])} → {amount(proposal[key])}</p>)}
        <p>사유: {proposal.reason}</p>
        <p>로그인한 관리자 계정으로 기록하며, 저장 시 최신 정책과 오늘 할당량·전날 이월량을 다시 검사합니다.</p>
        <div className="flex flex-wrap gap-3">
          <button type="button" className={styles.primaryButton} disabled={busy || stale || conflict} onClick={() => void save()}>{busy ? '저장 중…' : '확인한 일별 정책 저장'}</button>
          <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => setOpened(false)}>일별 설정 닫기</button>
        </div>
        {error && !conflict && <p>응답을 확인하지 못했다면 위 저장 버튼으로 같은 요청을 재확인하세요.</p>}
      </div>}
    </>}
  </section>
}
