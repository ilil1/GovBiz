import { useEffect, useRef, useState } from 'react'
import { OpsApiError, saveRagReferenceReview, type RagReferenceReviewInput, type RagReviewState } from '../../../data/ops/opsApi'
import { workspacePageStyles as styles } from '../../shared/workspace/WorkspacePage.styles'
import { EvaluationHelp } from './EvaluationHelp'

type Decision = RagReferenceReviewInput['decision']
const labels: Record<Decision, string> = { APPROVED: '기준 승인', CHANGES_REQUESTED: '수정 필요', DEFERRED: '판단 보류', REVOKED: '승인 철회' }
const options: Record<Decision, string> = { APPROVED: '맞아요 (기준 승인)', CHANGES_REQUESTED: '고쳐야 해요', DEFERRED: '판단하기 어려워요', REVOKED: '이전 승인 취소' }
type Props = {
  runId: string; state: RagReviewState; disabled: boolean; onDirty: (value: boolean) => void;
  onBusy: (value: boolean) => void; onSaved: (value: RagReviewState) => void; onExpired: () => void;
}

export function RagReferenceReviewPanel({ runId, state, disabled, onDirty, onBusy, onSaved, onExpired }: Props) {
  const [selectedCase, setSelectedCase] = useState(0)
  const [decision, setDecision] = useState<Decision | ''>('')
  const [comment, setComment] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const reference = state.reference_review
  const current = reference.history.find((row) => row.id === reference.current_id)
  const cases = state.material.cases
  const selected = cases[selectedCase]
  const markDirty = () => { setDirty(true); onDirty(true) }
  const discard = () => { setDecision(''); setComment(''); setConfirmed(false); setDirty(false); onDirty(false); setError('') }
  const save = async () => {
    if (disabled || inFlight.current || conflict || !decision || !comment.trim() || !confirmed) return
    inFlight.current = true; setBusy(true); onBusy(true); setError('')
    try {
      const value = await saveRagReferenceReview(runId, {
        decision, comment: comment.trim(), confirmed_all_cases: confirmed,
        fixture_sha256: reference.fixture_sha256, case_ids: reference.case_ids,
        rubric_version: reference.rubric.version, review_version: state.review_version,
      }, state.reviewer_id)
      if (mounted.current) { onDirty(false); onSaved(value) }
    } catch (cause) {
      if (!mounted.current) return
      if (cause instanceof OpsApiError && [401, 403].includes(cause.status)) { onExpired(); return }
      if (cause instanceof OpsApiError && cause.status === 409) setConflict(true)
      setError(cause instanceof Error ? cause.message : '기준 확인을 저장하지 못했어요.')
    } finally {
      inFlight.current = false
      if (mounted.current) { setBusy(false); onBusy(false) }
    }
  }
  return <section className="space-y-3 rounded-xl border border-line p-4" aria-label="RAG 참조 자료 검토" aria-busy={busy}>
    <EvaluationHelp label="평가 기준 확인" title={<h3 className="font-semibold">평가 기준 확인 · {current ? labels[current.decision] : '미확인'}</h3>}>
      <p>{reference.rubric.description} 기준 승인은 이 실행에만 적용되며, AI 작성 출처는 유지돼요.</p>
    </EvaluationHelp>
    <p className="text-sm">질문마다 공고 내용과 평가 기준이 맞는지 확인해 주세요.</p>
    {selected && <section aria-label="평가 기준 살펴보기" className="grid gap-3 rounded-xl bg-slate-50 p-4 text-sm">
      {cases.length > 1 && <label className="grid gap-2 font-semibold">확인할 질문 선택
        <select className="min-h-11 w-full rounded-lg border border-line bg-white p-2" value={selectedCase} onChange={(event) => setSelectedCase(Number(event.target.value))}>
          {cases.map((item, index) => <option key={item.case_id} value={index}>{index + 1}. {item.question}</option>)}
        </select>
      </label>}
      <div><h4 className="font-semibold">질문</h4><p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{selectedCase + 1}. {selected.question}</p></div>
      <div className="grid min-w-0 items-start gap-3 md:grid-cols-2">
        <section className="min-w-0"><h4 className="font-semibold">공고 내용</h4>{state.material.data_type === 'official-html-snapshot' && <p className="mt-1 text-xs text-ink-muted">저장한 공고 본문이에요. 첨부파일은 포함되지 않아요.</p>}<pre tabIndex={0} aria-label="공고 내용" className="mt-2 max-h-60 overflow-auto rounded-lg bg-white p-3 font-sans whitespace-pre-wrap [overflow-wrap:anywhere]">{selected.content}</pre></section>
        <section className="min-w-0"><h4 className="font-semibold">AI가 작성한 평가 기준</h4><p className="mt-1">{selected.expected_status === 'ANSWERED' ? '이 공고 내용으로 답변할 수 있어야 해요.' : '공고 내용이 부족하면 답변을 보류해야 해요.'}</p>
          {selected.expected_evidence.length > 0 && <div className="mt-2 grid gap-2"><p>확인할 공고 내용:</p>{selected.expected_evidence.map((evidence, index) => <blockquote key={`${evidence.chunk_id}-${index}`} className="border-l-2 border-brand-primary pl-3 whitespace-pre-wrap [overflow-wrap:anywhere]">{evidence.quote}</blockquote>)}</div>}
          {selected.expected_evidence.length === 0 && <p className="mt-2">지정된 근거가 없어요.</p>}
        </section>
      </div>
      {cases.length > 1 && <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={`${styles.secondaryButton} min-h-11 !text-sm`} disabled={selectedCase === 0} onClick={() => setSelectedCase(selectedCase - 1)}>이전 기준</button>
        <span className="tabular-nums">{selectedCase + 1} / {cases.length}</span>
        <button type="button" className={`${styles.secondaryButton} min-h-11 !text-sm`} disabled={selectedCase === cases.length - 1} onClick={() => setSelectedCase(selectedCase + 1)}>다음 기준</button>
      </div>}
    </section>}
    <p className="text-sm text-ink-muted">평가 기준 확인은 답변 합격과 별개예요.</p>
    <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void save() }}>
      <label className="block text-sm font-semibold">평가 기준이 맞나요?
        <select className="mt-1 w-full rounded-lg border border-line p-2" value={decision} required disabled={disabled || busy || conflict} onChange={(event) => { setDecision(event.target.value as Decision | ''); markDirty() }}>
          <option value="">선택해 주세요</option>
          {(Object.keys(labels) as Decision[]).filter((value) => value !== 'REVOKED' || reference.can_revoke).map((value) => <option key={value} value={value}>{options[value]}</option>)}
        </select>
      </label>
      <label className="block text-sm font-semibold">확인한 이유
        <textarea className="mt-1 w-full rounded-lg border border-line p-2" value={comment} maxLength={3000} rows={3} required disabled={disabled || busy || conflict} onChange={(event) => { setComment(event.target.value); markDirty() }} placeholder="확인한 내용과 판단 이유를 적어 주세요." />
      </label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={disabled || busy || conflict} onChange={(event) => { setConfirmed(event.target.checked); markDirty() }} />모든 질문의 공고 내용, 답변 가능 여부와 필요한 근거를 확인했습니다.</label>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {conflict && <p className="text-sm">다른 검토나 자료 변경이 있습니다. ‘입력 지우기’ 후 검토 자료를 새로고침하고 다시 판단하세요.</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={`${styles.primaryButton} min-h-11 !text-sm justify-center`} disabled={disabled || busy || conflict || !decision || !comment.trim() || !confirmed}>{busy ? '저장 중…' : '기준 확인 저장'}</button>
        <button type="button" className={`${styles.secondaryButton} min-h-11 !text-sm justify-center`} disabled={disabled || busy || !dirty} onClick={discard}>입력 지우기</button>
      </div>
      {dirty && <p className="text-xs">다른 질문도 확인할 수 있어요. 다음 단계로 가기 전 이 내용을 저장하거나 취소해 주세요.</p>}
    </form>
    <details><summary className="cursor-pointer font-semibold">기준 확인 이력 · {reference.history.length}건</summary>
      {reference.history.map((row) => <article key={row.id} className="my-2 rounded-lg bg-surface-muted p-3 text-sm" aria-label={`참조 검토 이력 ${row.version}`}>
        <p>#{row.version} · {labels[row.decision]} · {row.is_current ? '현재 자료의 최신 검토' : '이전 검토'}</p>
        <p>{row.reviewed_by} · {new Date(row.created_at).toLocaleString('ko-KR')}</p>
        <p className="whitespace-pre-wrap break-words">{row.comment}</p>
        {row.revoked_review_id !== null && <p>철회 대상 기록: #{row.revoked_review_id}</p>}
        <details className="break-all text-xs"><summary>참조 검토 당시 자료 정보</summary>
          <p>대상: {row.case_ids.join(', ')}</p><p>기준: {row.rubric_version}</p><p>평가 자료: {row.fixture_sha256}</p><p>실행 명세: {row.execution_spec_sha256}</p>
        </details>
      </article>)}
    </details>
  </section>
}
