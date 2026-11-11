import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import { assessEvaluationQuality, OpsApiError, saveFixtureReview } from '../../../data/ops/opsApi'
import type { EvaluationReview } from '../../../data/ops/opsApi'
import { EvaluationHelp } from './EvaluationHelp'
import { workspacePageStyles as styles, workspaceTagClassName } from '../../shared/workspace/WorkspacePage.styles'

const labels = { NOT_EVALUATED: '확인 전', NEEDS_REVIEW: '확인 필요', FAIL: '불합격', PASS: '합격' }
const fixtureLabels = { APPROVED: '기준 자료 검토 승인', CHANGES_REQUESTED: '기준 자료 수정 필요', DEFERRED: '기준 자료 판단 보류' }
const readableReasons = new Map([
  ['FIXTURE_REVIEW_REQUIRED', '평가 기준을 확인해 주세요.'],
  ['CASE_REVIEW_REQUIRED', '답변을 아직 확인하지 않았거나 판단을 보류했어요.'],
  ['CASE_UNSUITABLE', '답변에 문제가 있다고 확인했어요.'],
  ['STATUS_MISMATCH', '답변했는지 또는 보류했는지가 평가 기준과 달라요.'],
  ['EXPECTED_CITATION_MISSING', '답변에 표시해야 할 공고 근거가 빠졌어요.'],
])
const questionReasonCodes = new Set(['CASE_REVIEW_REQUIRED', 'CASE_UNSUITABLE', 'STATUS_MISMATCH', 'EXPECTED_CITATION_MISSING'])

export function QualityReviewPanel({ runId, data, busy, needsRefresh, active, onBusy, onDirty, onConflict, onSaved, onExpired, onReviewAnswers, nextActionLabel }: {
  runId: string; data: EvaluationReview; busy: boolean; needsRefresh: boolean; onBusy: (value: boolean) => void;
  active: RefObject<boolean>;
  onDirty: (value: boolean) => void; onConflict: () => void;
  onSaved: (value: EvaluationReview) => void; onExpired: () => void; onReviewAnswers?: () => void; nextActionLabel?: string;
}) {
  const criterionId = useId()
  const [decision, setDecision] = useState<'APPROVED' | 'CHANGES_REQUESTED' | 'DEFERRED' | ''>('')
  const [comment, setComment] = useState('')
  const reasonRequired = decision === 'CHANGES_REQUESTED' || decision === 'DEFERRED'
  const [confirmed, setConfirmed] = useState(false)
  const material = data.material
  const quality = data.quality
  const fixtureReview = quality?.fixture_reviews[0]
  const fixtureCurrent = !!fixtureReview && !!material && !!quality && fixtureReview.fixture_sha256 === material.fixture_sha256
    && fixtureReview.rubric_version === quality.fixture_rubric_version && fixtureReview.case_ids.length === material.cases.length
    && fixtureReview.case_ids.every((id, index) => id === material.cases[index].case_id)
  const [fixtureCaseIndex, setFixtureCaseIndex] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showReviewAnswers, setShowReviewAnswers] = useState(false)
  const cases = data.material?.cases.map((item) => item.case_id).join(', ')
  const dirty = decision !== '' || comment !== '' || confirmed
  useEffect(() => { onDirty(dirty) }, [dirty, onDirty])
  useEffect(() => { setConfirmed(false); setFixtureCaseIndex(0) }, [runId, data.material?.fixture_sha256, quality?.fixture_version, cases])
  if (!quality) return <p className="text-sm text-ink-muted">품질 판정 정보를 확인할 수 없습니다.</p>
  const fixtureStatus = !material?.cases.length || !quality.input_sha256 ? '확인 불가'
    : dirty ? '작성 중'
      : needsRefresh ? '다시 확인 필요'
      : fixtureCurrent && fixtureReview
        ? { APPROVED: '확인 완료', CHANGES_REQUESTED: '수정 필요', DEFERRED: '판단 보류' }[fixtureReview.decision]
        : fixtureReview ? '다시 확인 필요' : '확인 전'
  const fixtureCases = data.material?.cases ?? []
  const fixtureCase = fixtureCases[fixtureCaseIndex] ?? fixtureCases[0]
  const impact = data.fixture_review_impact
  const impacts = impact == null
    ? ['기존 비교 기준이 있다면 해제되고, 이전 최종 결과가 있다면 다시 확인해야 해요.']
    : [
      ...(impact.has_active_baseline ? ['기존 비교 기준이 해제돼요.'] : []),
      ...(impact.has_quality_assessments ? ['이전 최종 결과를 다시 확인해야 해요.'] : []),
    ]
  const startEditing = () => { setNotice(''); setShowReviewAnswers(false) }
  const save = async () => {
    if (active.current || busy || !data.material || !quality.input_sha256) return
    if (!decision || (reasonRequired && !comment.trim()) || !confirmed) return
    active.current = true; onBusy(true); setError(''); setNotice(''); setShowReviewAnswers(false)
    try {
      const value = await saveFixtureReview(runId, {
        decision, comment: reasonRequired ? comment.trim() : '', fixture_sha256: data.material.fixture_sha256,
        case_ids: data.material.cases.map((item) => item.case_id), rubric_version: quality.fixture_rubric_version,
        fixture_version: quality.fixture_version,
      })
      onSaved(value)
      setNotice('평가 기준 확인 결과를 저장했어요.')
      setShowReviewAnswers(decision === 'APPROVED')
      setDecision(''); setComment(''); setConfirmed(false)
    } catch (reason) {
      if (reason instanceof OpsApiError && reason.status === 409) onConflict()
      if (reason instanceof OpsApiError && [401, 403].includes(reason.status)) onExpired()
      else setError(reason instanceof Error ? reason.message : '평가 기준을 저장하지 못했습니다.')
    } finally { active.current = false; onBusy(false) }
  }
  return <section aria-label="평가 기준" className="grid gap-4">
    <section id="fixture-review" aria-label="평가 기준 확인" tabIndex={-1} style={{ scrollMarginTop: 'calc(var(--workspace-header-h, 0px) + 1rem)' }} className="min-w-0 rounded-xl border border-line bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary">
      <div className="flex min-h-11 min-w-0 flex-wrap items-center gap-2 px-4 py-3 text-base font-bold text-ink"><h3>평가 기준 확인</h3><span className={`${workspaceTagClassName(fixtureStatus === '확인 완료' ? 'ok' : fixtureStatus === '수정 필요' ? 'danger' : 'info')} !text-sm`}>{fixtureStatus}</span></div>
      <div className="grid gap-4 border-t border-line p-4 text-base leading-6 text-ink">
        {fixtureCase && <section aria-label="기준을 확인할 자료" className="grid min-w-0 gap-3 rounded-xl bg-slate-50 p-4">
          {fixtureCases.length > 1 && <>
            <label className="grid gap-2 font-bold"><span className="flex items-center justify-between gap-3"><span>질문 선택</span><span aria-hidden="true" className="text-sm font-normal text-ink">총 {fixtureCases.length}개</span></span>
              <select aria-label="질문 선택" className="min-h-11 w-full min-w-0 rounded-xl border border-line bg-white p-3 font-normal" value={fixtureCaseIndex} disabled={busy} onChange={(event) => setFixtureCaseIndex(Number(event.target.value))}>
                {fixtureCases.map((item, index) => <option key={item.case_id} value={index}>{index + 1}번째 질문</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button type="button" aria-label="기준의 이전 질문" className={`${styles.secondaryButton} min-h-11 !text-sm justify-center`} disabled={busy || fixtureCaseIndex === 0} onClick={() => setFixtureCaseIndex((index) => Math.max(0, index - 1))}>이전 질문</button>
              <button type="button" aria-label="기준의 다음 질문" className={`${styles.secondaryButton} min-h-11 !text-sm justify-center`} disabled={busy || fixtureCaseIndex >= fixtureCases.length - 1} onClick={() => setFixtureCaseIndex((index) => Math.min(fixtureCases.length - 1, index + 1))}>다음 질문</button>
            </div>
          </>}
          <div className="grid min-w-0 gap-4">
            <div><h4 className="text-sm font-semibold text-ink-muted">질문</h4><p aria-live="polite" aria-atomic="true" className="mt-1 whitespace-pre-wrap leading-7 [overflow-wrap:anywhere]">{fixtureCase.question}</p></div>
            <div><h4 className="text-sm font-semibold text-ink-muted">공고 내용</h4>{fixtureCase.evidence.length ? <div className="mt-1 grid gap-2">{fixtureCase.evidence.map((chunk) => <div key={chunk.order} className="border-l-2 border-brand-primary pl-3"><p className="text-sm font-semibold text-ink-muted">공고 내용 {chunk.order + 1}</p><p className="whitespace-pre-wrap leading-7 [overflow-wrap:anywhere]">{chunk.text}</p></div>)}</div> : <p className="mt-1">기록된 공고 내용이 없어요.</p>}</div>
            <div><h4 className="text-base font-semibold text-ink">{data.material?.reference_source === 'admin-authored' ? '관리자가 작성한 답변 기준' : data.material?.reference_source === 'ai-authored' ? 'AI가 작성한 답변 기준' : '답변 기준'}</h4>
              <dl className="mt-2 grid gap-4 rounded-lg bg-white p-3 [overflow-wrap:anywhere]">
                <div><dt className="text-sm font-semibold text-ink-muted">답변 가능 여부</dt><dd className="mt-1 text-base font-normal text-ink">{fixtureCase.expected_status === 'ANSWERED' ? '공고 내용으로 답변 가능' : fixtureCase.expected_status === 'INSUFFICIENT_EVIDENCE' ? '공고 내용이 부족해 답변 보류' : '확인할 수 없음'}</dd></div>
                <div><dt className="text-sm font-semibold text-ink-muted">답변에 표시할 공고 내용 번호</dt><dd className="mt-1 text-base font-normal text-ink">{fixtureCase.expected_citation_orders.map((order) => order + 1).join(', ') || '정해진 번호 없음'}</dd></div>
                <div><dt className="text-sm font-semibold text-ink-muted">답변에 포함할 내용</dt><dd className="mt-1 whitespace-pre-wrap text-base font-normal text-ink">{fixtureCase.reference_facts.join(' / ') || '지정된 내용 없음'}</dd></div>
                <div><dt className="text-sm font-semibold text-ink-muted">답변에 포함하면 안 되는 내용</dt><dd className="mt-1 whitespace-pre-wrap text-base font-normal text-ink">{fixtureCase.forbidden_claims.join(' / ') || '지정된 내용 없음'}</dd></div>
              </dl>
            </div>
            <details key={fixtureCase.case_id} className="group/answer min-w-0 rounded-lg border border-line bg-white">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary [&::-webkit-details-marker]:hidden">
                <span>이 질문의 답변 보기</span><span aria-hidden="true" className="shrink-0 text-sm text-brand-primary"><span className="group-open/answer:hidden">펼치기 +</span><span className="hidden group-open/answer:inline">접기 −</span></span>
              </summary>
              <p className="px-3 pb-3 whitespace-pre-wrap [overflow-wrap:anywhere]">{fixtureCase.answer.trim() ? fixtureCase.answer : '저장된 답변이 없어요.'}</p>
            </details>
          </div>
        </section>}
        <div className="grid gap-3 border-t border-line pt-4">
          <div className="grid gap-2"><EvaluationHelp label="평가 기준" title={<label htmlFor={criterionId} className="text-lg font-bold text-ink">평가 기준이 맞나요?</label>}><p>질문에 필요한 답변과 근거가 공고 내용과 맞는지 확인하는 기준이에요. 답변 자체의 검토와는 별도로 저장합니다.</p></EvaluationHelp><select id={criterionId} className="min-h-11 rounded-xl border border-line bg-white p-3 text-base font-normal text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary" value={decision} disabled={busy} onChange={(event) => { startEditing(); setDecision(event.target.value as typeof decision) }}><option value="">선택해 주세요</option><option value="APPROVED">문제없어요 (승인)</option><option value="CHANGES_REQUESTED">고쳐야 해요 (수정 필요)</option><option value="DEFERRED">판단하기 어려워요 (보류)</option></select></div>
          {reasonRequired && <label className="grid gap-2 font-semibold">{decision === 'CHANGES_REQUESTED' ? '어떤 점을 고쳐야 하나요?' : '판단하기 어려운 이유'}<textarea required className="rounded-xl border border-line p-3 font-normal" rows={2} value={comment} maxLength={3000} disabled={busy} onChange={(event) => { startEditing(); setComment(event.target.value) }} /></label>}
          <label className="flex items-start gap-2"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={confirmed} disabled={busy} onChange={(event) => { startEditing(); setConfirmed(event.target.checked) }} />모든 질문의 공고 내용과 평가 기준을 확인했어요.</label>
          <button className={`${styles.secondaryButton} min-h-11 !text-base justify-self-start`} disabled={busy || !data.material || !quality.input_sha256 || !confirmed || !decision || (reasonRequired && !comment.trim())} onClick={() => void save()}>평가 기준 저장</button>
          {reasonRequired && !comment.trim() && <p className="text-sm text-ink">판단 이유를 적어 주세요.</p>}
        </div>
        {impacts.length > 0 && <p className="text-sm text-ink">저장하면 {impacts.join(' ')}</p>}
        {quality.fixture_reviews.map((item) => <div key={item.id} className="rounded-xl bg-slate-50 p-3"><p>{fixtureLabels[item.decision]} · {item.reviewed_by} · {new Date(item.created_at).toLocaleString('ko-KR')}</p>{item.comment.trim() && <p className="whitespace-pre-wrap">{item.comment}</p>}</div>)}
      </div>
    </section>
    {notice && <div className="grid gap-2 rounded-lg bg-green-50 p-3 text-sm text-brand-primary"><p role="status">{notice}</p>{showReviewAnswers && !dirty && fixtureCurrent && fixtureReview?.decision === 'APPROVED' && !!material?.cases.length && !!quality.input_sha256 && onReviewAnswers && nextActionLabel && <button type="button" className={`${styles.secondaryButton} min-h-11 !text-sm justify-self-start`} disabled={busy} onClick={onReviewAnswers}>{nextActionLabel}</button>}</div>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </section>
}

export function QualityResultPanel({ runId, data, busy, navigationDisabled, hasAnswerDrafts, fixtureDirty, needsRefresh, active, onBusy, onNavigate, onConflict, onSaved, onExpired }: {
  runId: string; data: EvaluationReview; busy: boolean; navigationDisabled: boolean; hasAnswerDrafts: boolean; fixtureDirty: boolean; needsRefresh: boolean; active: RefObject<boolean>;
  onBusy: (value: boolean) => void; onNavigate: (target: string) => void; onConflict: () => void;
  onSaved: (value: EvaluationReview) => void; onExpired: () => void;
}) {
  const [error, setError] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const [assessing, setAssessing] = useState(false)
  const assessButton = useRef<HTMLButtonElement>(null)
  const quality = data.quality
  const latest = useRef({ runId, quality, needsRefresh })
  latest.current = { runId, quality, needsRefresh }
  useEffect(() => { setAnnouncement('') }, [quality?.input_sha256])
  if (!quality) return <section id="quality-review" tabIndex={-1} style={{ scrollMarginTop: 'calc(var(--workspace-header-h, 0px) + 1rem)' }} className="rounded-xl border border-line p-4"><h3 className="font-bold">전체 답변 결과</h3><p className="mt-2 text-sm">결과를 확인할 수 없어요.</p></section>
  const resultAvailable = !!data.material?.cases.length && !!quality.input_sha256
  const current = quality.is_current ? quality.history.find((item) => item.id === quality.current_id && item.status === quality.status && item.input_sha256 === quality.input_sha256) : undefined
  const currentUnavailable = quality.is_current ? !current : quality.history.length === 0 && quality.status !== 'NOT_EVALUATED'
  const qualityStale = !quality.is_current && quality.history.length > 0
  const qualityStatus = !resultAvailable || currentUnavailable ? '확인 불가' : needsRefresh ? '다시 확인 필요' : qualityStale ? '다시 판정 필요' : labels[quality.status]
  const save = async () => {
    if (active.current || busy || needsRefresh || fixtureDirty || !resultAvailable || !quality.input_sha256 || quality.is_current || currentUnavailable) return
    const requestedInputHash = quality.input_sha256
    const initiatingButton = assessButton.current
    const wasFocused = !!initiatingButton && document.activeElement === initiatingButton
    let focusMoved = false
    let restoreFocus = true
    const noteFocusChange = (event: FocusEvent) => { if (event.target !== initiatingButton && event.target !== document.body) focusMoved = true }
    const noteInteraction = () => { focusMoved = true }
    if (wasFocused) {
      document.addEventListener('focusin', noteFocusChange)
      document.addEventListener('pointerdown', noteInteraction)
      document.addEventListener('keydown', noteInteraction)
    }
    active.current = true; onBusy(true); setAssessing(true); setError(''); setAnnouncement('')
    try {
      const value = await assessEvaluationQuality(runId, requestedInputHash)
      const next = value.quality
      const latestQuality = latest.current.quality
      const sameRequest = latest.current.runId === runId && !latest.current.needsRefresh && latestQuality?.input_sha256 === requestedInputHash
        && latestQuality.current_id === quality.current_id && latestQuality.status === quality.status && latestQuality.is_current === quality.is_current
      const validResult = sameRequest && !!next?.is_current && next.status !== 'NOT_EVALUATED' && next.input_sha256 === requestedInputHash && !!value.material?.cases.length
        && next.history.some((item) => item.id === next.current_id && item.status === next.status && item.input_sha256 === requestedInputHash)
      if (!validResult || !next) {
        onConflict()
        setError('결과를 확인할 수 없어요. 검토를 새로고침해 주세요.')
        return
      }
      onSaved(value)
      setAnnouncement(`판정 결과: ${labels[next.status]}`)
    } catch (reason) {
      if (reason instanceof OpsApiError && reason.status >= 200 && reason.status < 300) {
        onConflict()
        setError('결과를 확인할 수 없어요. 검토를 새로고침해 주세요.')
        return
      }
      if (reason instanceof OpsApiError && reason.status === 409) onConflict()
      if (reason instanceof OpsApiError && [401, 403].includes(reason.status)) { restoreFocus = false; onExpired() }
      else setError(reason instanceof Error ? reason.message : '결과를 확인하지 못했어요. 다시 시도해 주세요.')
    } finally {
      document.removeEventListener('focusin', noteFocusChange)
      document.removeEventListener('pointerdown', noteInteraction)
      document.removeEventListener('keydown', noteInteraction)
      if (restoreFocus && wasFocused && !focusMoved && (document.activeElement === initiatingButton || document.activeElement === document.body)) {
        document.getElementById('quality-review')?.focus({ preventScroll: true })
      }
      active.current = false; setAssessing(false); onBusy(false)
    }
  }
  return <section aria-label="전체 답변 결과 판정" className="grid gap-4">
    <section id="quality-review" aria-label="전체 답변 결과" tabIndex={-1} style={{ scrollMarginTop: 'calc(var(--workspace-header-h, 0px) + 1rem)' }} className="min-w-0 rounded-xl border border-line bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary">
    <div className="flex min-h-11 min-w-0 flex-wrap items-center gap-2 px-4 py-3 text-base font-bold text-ink"><h3>전체 답변 결과</h3><span className={`${workspaceTagClassName(qualityStatus === '합격' ? 'ok' : qualityStatus === '불합격' ? 'danger' : 'info')} !text-sm`}>{qualityStatus}</span></div>
    <div className="grid gap-4 border-t border-line p-4">
    <p className="text-sm leading-6">저장한 기준과 질문별 확인을 종합해요. 비교 기준을 지정할 때 필요하며, 답변 확인만 한다면 선택 사항이에요. 답변 내용의 정확성은 자동으로 측정하지 않아요.</p>
    {needsRefresh && <p className="text-sm text-amber-800">최신 검토 기록을 다시 불러온 뒤 결과를 확인해 주세요.</p>}
    {currentUnavailable && !needsRefresh && <p className="text-sm text-amber-800">결과 기록을 확인할 수 없어요. 검토를 다시 불러와 주세요.</p>}
    {!resultAvailable && <p className="text-sm text-amber-800">판정할 질문이나 자료를 확인할 수 없어요.</p>}
    {qualityStale && resultAvailable && !needsRefresh && <p className="text-sm text-amber-800">판정에 사용한 내용이 바뀌어 다시 판정해야 해요.</p>}
    {current && resultAvailable && !needsRefresh && current.status === 'NEEDS_REVIEW' && current.reasons.length === 0 && <p role="alert" className="text-sm text-amber-800">확인할 내용을 불러오지 못했어요. 검토를 새로고침해 주세요.</p>}
    {current && resultAvailable && !needsRefresh && current.reasons.length > 0 && <div className="grid gap-2 text-sm"><p className="font-semibold">{current.status === 'NEEDS_REVIEW' ? '판정은 끝났지만 확인할 내용이 남았어요.' : '결과 이유'}</p><ul className="grid gap-3">{current.reasons.map((reason, index) => {
      const target = reason.code === 'FIXTURE_REVIEW_REQUIRED' && data.material?.cases.length ? 'fixture-review'
        : questionReasonCodes.has(reason.code) && reason.case_id && data.material?.cases.some((item) => item.case_id === reason.case_id) ? `case-review-${reason.case_id}` : null
      const shownEarlier = target && current.reasons.slice(0, index).some((previous) => target === 'fixture-review'
        ? previous.code === 'FIXTURE_REVIEW_REQUIRED'
        : previous.case_id === reason.case_id && questionReasonCodes.has(previous.code))
      return <li key={`${reason.code}-${reason.case_id}-${index}`} className="grid justify-items-start gap-1"><p>{reason.case_id ? `${reason.case_id}: ` : ''}{readableReasons.get(reason.code) ?? reason.message}</p>{target && !shownEarlier && <button type="button" className="min-h-11 rounded-md text-left font-semibold text-brand-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary disabled:cursor-not-allowed disabled:opacity-60" disabled={navigationDisabled} onClick={() => onNavigate(target)}>{target === 'fixture-review' ? '평가 기준 확인하기' : `${reason.case_id} 답변 확인하기`}</button>}</li>
    })}</ul></div>}
    {quality.blocked_reason && <p role="alert" className="text-sm text-amber-800">{quality.blocked_reason}</p>}
    {!quality.is_current && !currentUnavailable && data.is_baseline && resultAvailable && <p className="text-sm text-amber-800">판정 결과에 따라 현재 비교 기준이 해제될 수 있어요.</p>}
    {!quality.is_current && !currentUnavailable && <button ref={assessButton} className={`${styles.secondaryButton} min-h-11 !text-sm justify-self-start`} disabled={busy || assessing || needsRefresh || fixtureDirty || !resultAvailable} onClick={() => void save()}>{assessing ? '판정 중…' : qualityStale ? '결과 다시 판정하기' : '결과 판정하기'}</button>}
    {hasAnswerDrafts && <p className="text-sm text-amber-800">작성 중인 답변은 결과에 반영되지 않았어요. 먼저 저장해 주세요.</p>}
    {fixtureDirty && <p className="text-sm text-amber-800">작성 중인 기준 확인을 먼저 저장하거나 입력을 비워 주세요.</p>}
    {quality.history.length > 0 && <details><summary className="cursor-pointer text-sm font-semibold">결과 확인 이력 · {quality.history.length}건</summary><ol className="mt-3 grid gap-3">{quality.history.map((item) => <li key={item.id} className="rounded-xl bg-slate-50 p-3 text-sm"><p>{labels[item.status]} · {item.policy.definition.version} · {item.assessed_by} · {new Date(item.created_at).toLocaleString('ko-KR')}</p><p className="break-all text-xs">판정 근거 ID: {item.input_sha256}</p><ul>{item.reasons.map((reason, index) => <li key={index}>{reason.case_id ? `${reason.case_id}: ` : ''}{reason.message}</li>)}</ul></li>)}</ol></details>}
    </div>
    </section>
    <p role="status" aria-atomic="true" className="sr-only">{announcement}</p>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </section>
}
