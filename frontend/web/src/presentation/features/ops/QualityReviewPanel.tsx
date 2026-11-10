import { useEffect, useId, useRef, useState } from 'react'
import { assessEvaluationQuality, OpsApiError, saveFixtureReview } from '../../../data/ops/opsApi'
import type { EvaluationReview } from '../../../data/ops/opsApi'
import { EvaluationHelp } from './EvaluationHelp'
import { workspacePageStyles as styles, workspaceTagClassName } from '../../shared/workspace/WorkspacePage.styles'

const labels = { NOT_EVALUATED: '확인 전', NEEDS_REVIEW: '확인 필요', FAIL: '불합격', PASS: '합격' }
const fixtureLabels = { APPROVED: '기준 자료 검토 승인', CHANGES_REQUESTED: '기준 자료 수정 필요', DEFERRED: '기준 자료 판단 보류' }

export function QualityReviewPanel({ runId, data, busy, onBusy, onDirty, onConflict, onSaved, onExpired, onNavigate }: {
  runId: string; data: EvaluationReview; busy: boolean; onBusy: (value: boolean) => void;
  onDirty: (value: boolean) => void; onConflict: () => void;
  onSaved: (value: EvaluationReview) => void; onExpired: () => void; onNavigate: (target: string) => void;
}) {
  const criterionId = useId()
  const [decision, setDecision] = useState<'APPROVED' | 'CHANGES_REQUESTED' | 'DEFERRED' | ''>('')
  const [comment, setComment] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const material = data.material
  const quality = data.quality
  const fixtureReview = quality?.fixture_reviews[0]
  const fixtureCurrent = !!fixtureReview && !!material && !!quality && fixtureReview.fixture_sha256 === material.fixture_sha256
    && fixtureReview.rubric_version === quality.fixture_rubric_version && fixtureReview.case_ids.length === material.cases.length
    && fixtureReview.case_ids.every((id, index) => id === material.cases[index].case_id)
  const fixtureNeedsReview = !!material?.cases.length && !!quality?.input_sha256 && !(fixtureCurrent && fixtureReview.decision === 'APPROVED')
  const [fixtureOpen, setFixtureOpen] = useState(fixtureNeedsReview)
  const previousFixtureNeedsReview = useRef(fixtureNeedsReview)
  const [fixtureCaseIndex, setFixtureCaseIndex] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const active = useRef(false)
  const cases = data.material?.cases.map((item) => item.case_id).join(', ')
  const dirty = decision !== '' || comment !== '' || confirmed
  useEffect(() => { onDirty(dirty) }, [dirty, onDirty])
  useEffect(() => {
    if (fixtureNeedsReview && !previousFixtureNeedsReview.current) setFixtureOpen(true)
    previousFixtureNeedsReview.current = fixtureNeedsReview
  }, [fixtureNeedsReview])
  useEffect(() => { setConfirmed(false); setFixtureCaseIndex(0) }, [runId, data.material?.fixture_sha256, quality?.fixture_version, cases])
  if (!quality) return <p className="text-sm text-ink-muted">품질 판정 정보를 확인할 수 없습니다.</p>
  const current = quality.history.find((item) => item.id === quality.current_id)
  const fixtureStatus = fixtureCurrent && fixtureReview
    ? { APPROVED: '확인 완료', CHANGES_REQUESTED: '수정 필요', DEFERRED: '판단 보류' }[fixtureReview.decision]
    : fixtureReview ? '다시 확인 필요' : '확인 전'
  const qualityStale = !quality.is_current && (quality.history.length > 0 || quality.status !== 'NOT_EVALUATED')
  const qualityStatus = qualityStale ? '다시 확인 필요' : labels[quality.status]
  const fixtureCases = data.material?.cases ?? []
  const fixtureCase = fixtureCases[fixtureCaseIndex] ?? fixtureCases[0]
  const save = async (fixture: boolean) => {
    if (active.current || busy || !data.material || !quality.input_sha256) return
    if (fixture && (!decision || !comment.trim() || !confirmed)) return
    if (!fixture && dirty) return
    active.current = true; onBusy(true); setError(''); setNotice('')
    try {
      const value = fixture && decision ? await saveFixtureReview(runId, {
        decision, comment: comment.trim(), fixture_sha256: data.material.fixture_sha256,
        case_ids: data.material.cases.map((item) => item.case_id), rubric_version: quality.fixture_rubric_version,
        fixture_version: quality.fixture_version,
      }) : await assessEvaluationQuality(runId, quality.input_sha256)
      onSaved(value)
      setNotice(fixture ? '평가 기준 확인 결과를 저장했어요.' : `품질 판정을 저장했습니다: ${labels[value.quality?.status ?? 'NOT_EVALUATED']}. 아래 판정 사유와 다음 단계를 확인하세요.`)
      if (fixture) { setDecision(''); setComment(''); setConfirmed(false) }
    } catch (reason) {
      if (reason instanceof OpsApiError && reason.status === 409) onConflict()
      if (reason instanceof OpsApiError && [401, 403].includes(reason.status)) onExpired()
      else setError(reason instanceof Error ? reason.message : '품질 판정을 저장하지 못했습니다.')
    } finally { active.current = false; onBusy(false) }
  }
  return <section aria-label="품질 판정" className="grid gap-4 rounded-xl border border-line p-4">
    <h3 className="font-bold">평가 기준과 최종 결과</h3>
    <details id="fixture-review" open={fixtureOpen} onToggle={(event) => setFixtureOpen(event.currentTarget.open)} tabIndex={-1} style={{ scrollMarginTop: 'calc(var(--workspace-header-h, 0px) + 1rem)' }} className="group min-w-0 rounded-xl border border-line bg-white">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 flex-wrap items-center gap-2"><span>평가 기준 확인</span><span className={workspaceTagClassName(fixtureStatus === '확인 완료' ? 'ok' : fixtureStatus === '수정 필요' ? 'danger' : 'info')}>{fixtureStatus}</span></span>
        <span aria-hidden="true" className="shrink-0 text-xs text-brand-primary"><span className="group-open:hidden">펼치기 +</span><span className="hidden group-open:inline">접기 −</span></span>
      </summary>
      <div className="grid gap-3 border-t border-line p-4 text-sm">
        <p>각 질문에서 공고 내용과 답변을 확인할 기준이 맞는지 살펴봐 주세요.</p>
        {fixtureCase && <section aria-label="기준을 확인할 자료" className="grid min-w-0 gap-3 rounded-xl bg-slate-50 p-4">
          {fixtureCases.length > 1 && <>
            <label className="grid gap-2 font-semibold"><span className="flex items-center justify-between gap-3"><span>질문 선택</span><span aria-hidden="true" className="text-xs font-normal text-ink-muted">총 {fixtureCases.length}개</span></span>
              <select aria-label="질문 선택" className="min-h-11 w-full min-w-0 rounded-xl border border-line bg-white p-3 font-normal" value={fixtureCaseIndex} disabled={busy} onChange={(event) => setFixtureCaseIndex(Number(event.target.value))}>
                {fixtureCases.map((item, index) => <option key={item.case_id} value={index}>{index + 1}번째 질문</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button type="button" aria-label="기준의 이전 질문" className={`${styles.secondaryButton} min-h-11 !text-sm justify-center`} disabled={busy || fixtureCaseIndex === 0} onClick={() => setFixtureCaseIndex((index) => Math.max(0, index - 1))}>이전 질문</button>
              <button type="button" aria-label="기준의 다음 질문" className={`${styles.secondaryButton} min-h-11 !text-sm justify-center`} disabled={busy || fixtureCaseIndex >= fixtureCases.length - 1} onClick={() => setFixtureCaseIndex((index) => Math.min(fixtureCases.length - 1, index + 1))}>다음 질문</button>
            </div>
          </>}
          <div className="grid min-w-0 gap-3">
            <div><h4 className="font-semibold">질문</h4><p aria-live="polite" aria-atomic="true" className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{fixtureCase.question}</p></div>
            <div><h4 className="font-semibold">공고 내용</h4>{fixtureCase.evidence.length ? <div className="mt-1 grid gap-2">{fixtureCase.evidence.map((chunk) => <div key={chunk.order} className="border-l-2 border-brand-primary pl-3"><p className="text-xs font-semibold">공고 내용 {chunk.order + 1}</p><p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{chunk.text}</p></div>)}</div> : <p className="mt-1 text-ink-muted">기록된 공고 내용이 없어요.</p>}</div>
            <div><h4 className="font-semibold">{data.material?.reference_source === 'admin-authored' ? '관리자가 작성한 답변 기준' : data.material?.reference_source === 'ai-authored' ? 'AI가 작성한 답변 기준' : '답변 기준'}</h4>
              <dl className="mt-2 grid gap-3 rounded-lg bg-white p-3 [overflow-wrap:anywhere]">
                <div><dt className="font-semibold">답변 가능 여부</dt><dd className="mt-1">{fixtureCase.expected_status === 'ANSWERED' ? '공고 내용으로 답변 가능' : fixtureCase.expected_status === 'INSUFFICIENT_EVIDENCE' ? '공고 내용이 부족해 답변 보류' : '확인할 수 없음'}</dd></div>
                <div><dt className="font-semibold">답변에 표시할 공고 내용 번호</dt><dd className="mt-1">{fixtureCase.expected_citation_orders.map((order) => order + 1).join(', ') || '정해진 번호 없음'}</dd></div>
                <div><dt className="font-semibold">답변에 포함할 내용</dt><dd className="mt-1 whitespace-pre-wrap">{fixtureCase.reference_facts.join(' / ') || '지정된 내용 없음'}</dd></div>
                <div><dt className="font-semibold">답변에 포함하면 안 되는 내용</dt><dd className="mt-1 whitespace-pre-wrap">{fixtureCase.forbidden_claims.join(' / ') || '지정된 내용 없음'}</dd></div>
              </dl>
            </div>
          </div>
        </section>}
        {fixtureCase && <button type="button" className={`${styles.secondaryButton} min-h-11 !text-sm justify-self-start`} disabled={busy} onClick={() => onNavigate(`case-review-${fixtureCase.case_id}`)}>이 질문의 답변 보기</button>}
        <div className="grid gap-2"><EvaluationHelp label="평가 기준" title={<label htmlFor={criterionId}>평가 기준이 맞나요?</label>}><p>질문에 필요한 답변과 근거가 공고 내용과 맞는지 확인하는 기준이에요. 답변 자체의 검토와는 별도로 저장합니다.</p></EvaluationHelp><select id={criterionId} className="rounded-xl border border-line p-3" value={decision} disabled={busy} onChange={(event) => setDecision(event.target.value as typeof decision)}><option value="">선택해 주세요</option><option value="APPROVED">문제없어요 (승인)</option><option value="CHANGES_REQUESTED">고쳐야 해요 (수정 필요)</option><option value="DEFERRED">판단하기 어려워요 (보류)</option></select></div>
        <label className="grid gap-2">기준을 확인한 이유<textarea className="rounded-xl border border-line p-3" rows={2} value={comment} maxLength={3000} disabled={busy} onChange={(event) => setComment(event.target.value)} /></label>
        <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} />모든 질문의 공고 내용과 평가 기준을 확인했어요.</label>
        <button className={`${styles.secondaryButton} min-h-11 !text-sm justify-self-start`} disabled={busy || !data.material || !quality.input_sha256 || !confirmed || !decision || !comment.trim()} onClick={() => void save(true)}>평가 기준 확인 저장</button>
        {(!decision || !comment.trim() || !confirmed) && <p className="text-xs text-ink-muted">확인 결과와 이유를 적고 확인란을 선택해 주세요.</p>}
        <p className="text-xs text-ink-muted">검토를 변경하면 이 자료의 기존 비교 기준이 해제됩니다. 최종 결과도 다시 확인해야 합니다.</p>
        {quality.fixture_reviews.map((item) => <div key={item.id} className="rounded-xl bg-slate-50 p-3"><p>{fixtureLabels[item.decision]} · {item.reviewed_by} · {new Date(item.created_at).toLocaleString('ko-KR')}</p><p className="whitespace-pre-wrap">{item.comment}</p></div>)}
      </div>
    </details>
    {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-brand-primary">{notice}</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <details id="quality-review" tabIndex={-1} style={{ scrollMarginTop: 'calc(var(--workspace-header-h, 0px) + 1rem)' }} className="group min-w-0 rounded-xl border border-line bg-white">
    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary [&::-webkit-details-marker]:hidden">
      <span className="flex min-w-0 flex-wrap items-center gap-2"><span>최종 결과</span><span className={workspaceTagClassName(!qualityStale && quality.status === 'PASS' ? 'ok' : !qualityStale && quality.status === 'FAIL' ? 'danger' : 'info')}>{qualityStatus}</span></span>
      <span aria-hidden="true" className="shrink-0 text-xs text-brand-primary"><span className="group-open:hidden">펼치기 +</span><span className="hidden group-open:inline">접기 −</span></span>
    </summary>
    <div className="grid gap-4 border-t border-line p-4">
    <p className="text-sm leading-6">이 평가는 정해진 질문만 확인해요. 모든 답변이 정확하다는 뜻은 아닙니다.</p>
    <details className="text-xs text-ink-muted"><summary className="cursor-pointer font-semibold">판정 기준 자세히 보기</summary><p className="mt-2">정책: {quality.policy?.definition.version ?? '확인 불가'} · 자동 의미 충실도: 미측정 · 의미 판단: 사례별 사람 검토</p></details>
    {!quality.is_current && quality.history.length > 0 && <p className="text-sm text-amber-800">자료·정책·검토가 변경됐습니다. 이전 판정은 이력으로 보존되며 다시 판정해야 합니다.</p>}
    {qualityStale && current && current.reasons.length > 0 && <p className="text-sm font-semibold text-ink-muted">이전 결과에서 확인된 내용</p>}
    {current && <ul className="list-disc pl-5 text-sm">{current.reasons.map((reason, index) => <li key={`${reason.code}-${reason.case_id}-${index}`}>{reason.case_id ? `${reason.case_id}: ` : ''}{reason.message}</li>)}</ul>}
    {quality.blocked_reason && <p role="alert" className="text-sm text-amber-800">{quality.blocked_reason}</p>}
    <button className={`${styles.secondaryButton} min-h-11 !text-sm justify-self-start`} disabled={busy || dirty || !data.material || !quality.input_sha256} onClick={() => void save(false)}>최종 결과 확인하고 저장</button>
    {dirty && <p className="text-sm text-amber-800">작성 중인 기준 확인을 먼저 저장하거나 입력을 비워 주세요.</p>}
    {quality.history.length > 0 && <details><summary className="cursor-pointer text-sm font-semibold">품질 판정 이력 · {quality.history.length}건</summary><ol className="mt-3 grid gap-3">{quality.history.map((item) => <li key={item.id} className="rounded-xl bg-slate-50 p-3 text-sm"><p>{labels[item.status]} · {item.policy.definition.version} · {item.assessed_by} · {new Date(item.created_at).toLocaleString('ko-KR')}</p><p className="break-all text-xs">판정 근거 ID: {item.input_sha256}</p><ul>{item.reasons.map((reason, index) => <li key={index}>{reason.case_id ? `${reason.case_id}: ` : ''}{reason.message}</li>)}</ul></li>)}</ol></details>}
    </div>
    </details>
  </section>
}
