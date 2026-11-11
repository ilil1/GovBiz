import { useEffect, useRef, useState } from 'react'
import { clearEvaluationBaseline, getEvaluationReview, OpsApiError, promoteEvaluationBaseline, saveEvaluationCaseReview, saveEvaluationReview } from '../../../data/ops/opsApi'
import type { CaseReviewDecision, EvaluationReview } from '../../../data/ops/opsApi'
import { workspacePageStyles as styles, workspaceTagClassName } from '../../shared/workspace/WorkspacePage.styles'
import { QualityResultPanel, QualityReviewPanel } from './QualityReviewPanel'
import { EvaluationReviewProgress } from './EvaluationReviewProgress'
import { EvaluationHelp } from './EvaluationHelp'

type ReviewPanel = 'criterion' | 'answers' | 'overall'

const readableReviewCriteria = new Map([
  ['신청 조건·예외·제외 사유를 누락하거나 근거에 없는 조건을 추가하지 않았는가', '신청 조건과 예외·제외 사유가 빠지지 않았나요? 제공된 공고 내용에 없는 조건을 추가하지 않았나요?'],
  ['답변의 각 주장이 제공한 근거와 일치하고, 근거가 부족하면 부족하다고 답했는가', '답변이 제공된 공고 내용과 맞나요? 근거가 부족할 때는 부족하다고 밝혔나요?'],
  ['인용한 청크가 답변을 뒷받침하며 필요한 인용이 빠지지 않았는가', '답변에 표시한 공고 내용이 답변을 뒷받침하나요? 필요한 근거가 빠지지 않았나요?'],
])

function panelForTarget(target: string): ReviewPanel {
  if (target.startsWith('case-review-')) return 'answers'
  if (target === 'overall-review' || target === 'quality-review') return 'overall'
  return 'criterion'
}

function initialSelection(data: EvaluationReview): { panel: ReviewPanel; caseId?: string } {
  const material = data.material
  const quality = data.quality
  const fixture = quality?.fixture_reviews[0]
  const approved = !!fixture && !!material?.cases.length && !!quality?.input_sha256
    && fixture.decision === 'APPROVED' && fixture.fixture_sha256 === material.fixture_sha256
    && fixture.rubric_version === quality.fixture_rubric_version
    && fixture.case_ids.length === material.cases.length
    && fixture.case_ids.every((id, index) => id === material.cases[index].case_id)
  if (!approved || !material) return { panel: 'criterion' }
  const cases = material.cases.map((item) => {
    const review = data.case_reviews.find((row) => row.case_id === item.case_id)
    const unreviewed = !review || review.capture_sha256 !== material.capture_sha256
      || review.fixture_sha256 !== material.fixture_sha256 || review.rubric_version !== data.rubric.version
    return { id: item.case_id, unreviewed, deferred: !unreviewed && review?.decision === 'DEFERRED' }
  })
  const pending = cases.find((item) => item.unreviewed) ?? cases.find((item) => item.deferred)
  return pending ? { panel: 'answers', caseId: pending.id } : { panel: 'answers' }
}

export function EvaluationReviewPanel({ runId, onExpired, onChanged }: { runId: string; onExpired: () => void; onChanged: () => void }) {
  const [data, setData] = useState<EvaluationReview | null>(null)
  const [loading, setLoading] = useState(true)
  const [comment, setComment] = useState('')
  const [clearReason, setClearReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [selectedCase, setSelectedCase] = useState('')
  const [activePanel, setActivePanel] = useState<ReviewPanel>('criterion')
  const [focusTarget, setFocusTarget] = useState<string | null>(null)
  const [savedCase, setSavedCase] = useState('')
  const [fixtureDirty, setFixtureDirty] = useState(false)
  const [confirmRefresh, setConfirmRefresh] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [caseDrafts, setCaseDrafts] = useState<Record<string, { decision: CaseReviewDecision | ''; comment: string }>>({})
  const expiry = useRef(onExpired); expiry.current = onExpired
  const inFlight = useRef(false)
  const panelChoiceVersion = useRef(0)
  useEffect(() => {
    const controller = new AbortController()
    const choiceAtStart = panelChoiceVersion.current
    setLoading(true)
    getEvaluationReview(runId, controller.signal).then((value) => {
      if (!controller.signal.aborted) { setData(value); if (panelChoiceVersion.current === choiceAtStart) { const selection = initialSelection(value); setActivePanel(selection.panel); setSelectedCase(selection.caseId ?? '') }; setError(''); setLoadFailed(false); setConflict(false); setConfirmed(false); setCaseDrafts({}) }
    }).catch((reason) => {
      if (controller.signal.aborted) return
      setLoadFailed(true)
      if (reason instanceof OpsApiError && [401, 403].includes(reason.status)) expiry.current()
      else setError(reason instanceof Error ? reason.message : '검토 자료를 불러오지 못했습니다.')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [runId, refresh])
  useEffect(() => {
    if (!focusTarget) return
    if (activePanel !== panelForTarget(focusTarget)) return
    const element = document.getElementById(focusTarget)
    for (let details = element?.closest('details') ?? null; details; details = details.parentElement?.closest('details') ?? null) details.open = true
    element?.focus(); element?.scrollIntoView({ block: 'start' })
    setFocusTarget(null)
  }, [focusTarget, selectedCase, activePanel])
  const navigateReview = (target: string) => {
    panelChoiceVersion.current += 1
    setActivePanel(panelForTarget(target))
    if (target.startsWith('case-review-')) setSelectedCase(target.slice('case-review-'.length))
    setFocusTarget(target)
  }
  const choosePanel = (panel: ReviewPanel) => { panelChoiceVersion.current += 1; setActivePanel(panel) }
  const caseItems = data?.material?.cases ?? []
  const selectedIndex = Math.max(0, caseItems.findIndex((item) => item.case_id === selectedCase))
  const selectCase = (index: number) => {
    const item = caseItems[index]
    if (item) { panelChoiceVersion.current += 1; setSelectedCase(item.case_id); setSavedCase('') }
  }
  const latest = data?.reviews[0]
  const hasDrafts = Object.keys(caseDrafts).length > 0
  const hasUnsaved = hasDrafts || fixtureDirty || comment !== '' || confirmed || clearReason !== ''
  const locked = busy || loading || loadFailed || conflict || confirmRefresh
  const caseChecks = caseItems.map((item) => {
    // 서버는 검토를 최신 버전부터 반환한다. 과거 적합 기록으로 최신 판단을 덮지 않는다.
    const review = data?.case_reviews.find((row) => row.case_id === item.case_id)
    const current = !!review && !!data?.material && review.capture_sha256 === data.material.capture_sha256
      && review.fixture_sha256 === data.material.fixture_sha256 && review.rubric_version === data.rubric.version
    return { id: item.case_id, review, current }
  })
  const pendingCase = caseChecks.find((item) => !item.current) ?? caseChecks.find((item) => item.review?.decision === 'DEFERRED')
  const questionStatus = !caseChecks.length ? '확인 불가'
    : hasDrafts ? '작성 중'
      : loadFailed || conflict ? '다시 확인 필요'
        : caseChecks.some((item) => !item.current && item.review) ? '다시 확인 필요'
          : caseChecks.every((item) => !item.current) ? '확인 전'
            : caseChecks.some((item) => !item.current) ? '확인 중'
              : caseChecks.some((item) => item.review?.decision === 'DEFERRED') ? '판단 보류'
                : caseChecks.some((item) => item.review?.decision === 'UNSUITABLE') ? '문제 있음' : '확인 완료'
  const overallStatus = !data?.material && !data?.is_baseline ? '확인 불가'
    : comment !== '' || confirmed || clearReason !== '' ? '작성 중'
    : loadFailed || conflict ? '다시 확인 필요'
      : data?.is_baseline ? data.baseline_requires_review ? '기준 재확인 필요' : '비교 기준 사용 중'
        : data?.approval_current ? '검토 승인'
          : latest?.decision === 'APPROVED' ? '다시 확인 필요'
            : latest?.decision === 'CHANGES_REQUESTED' ? '수정 의견 기록됨' : '선택'
  const overallReviewStatus = loading ? '확인 중'
    : loadFailed || conflict ? '다시 확인 필요'
      : !data?.material ? '확인 불가'
        : data.approval_current ? '승인 완료'
          : latest?.decision === 'APPROVED' ? '다시 확인 필요'
            : latest?.decision === 'CHANGES_REQUESTED' ? '수정 필요' : '승인 전'
  const fixtureReview = data?.quality?.fixture_reviews[0]
  const fixtureCurrent = !!fixtureReview && !!data?.material && !!data.quality
    && fixtureReview.fixture_sha256 === data?.material?.fixture_sha256
    && fixtureReview.rubric_version === data?.quality?.fixture_rubric_version
    && fixtureReview.case_ids.length === caseItems.length
    && fixtureReview.case_ids.every((id, index) => id === caseItems[index].case_id)
  const fixtureApproved = fixtureCurrent && fixtureReview.decision === 'APPROVED'
  const criterionStatus = !caseItems.length || !data?.quality?.input_sha256 ? '확인 불가'
    : fixtureDirty ? '작성 중'
      : loadFailed || conflict ? '다시 확인 필요'
      : fixtureCurrent ? { APPROVED: '확인 완료', CHANGES_REQUESTED: '수정 필요', DEFERRED: '판단 보류' }[fixtureReview.decision]
        : fixtureReview ? '다시 확인 필요' : '확인 전'
  const quality = data?.quality
  const canGuide = fixtureApproved && !hasDrafts && !fixtureDirty && !locked && !error && !!data?.quality?.input_sha256
  const nextCriterionTarget = canGuide && pendingCase ? `case-review-${pendingCase.id}` : null
  const nextPendingCase = caseChecks.find((item) => item.id !== savedCase && !item.current)
    ?? caseChecks.find((item) => item.id !== savedCase && item.review?.decision === 'DEFERRED')
  const reload = () => {
    if (busy || loading) return
    setConfirmRefresh(false); setCaseDrafts({}); setFixtureDirty(false); setComment(''); setConfirmed(false); setClearReason('')
    setNotice(''); setLoading(true); setRefresh((value) => value + 1)
  }
  const stamp = () => ({ capture_sha256: data!.material!.capture_sha256, fixture_sha256: data!.material!.fixture_sha256, rubric_version: data!.rubric.version, review_version: data!.review_version })
  const caseLabel = (decision: CaseReviewDecision) => ({ SUITABLE: '적합', UNSUITABLE: '부적합', DEFERRED: '판단 보류' })[decision]
  const saveCase = async (caseId: string, advance = false) => {
    const draft = caseDrafts[caseId]
    if (inFlight.current || locked || fixtureDirty || !data?.material || !draft?.decision || (draft.decision !== 'SUITABLE' && !draft.comment.trim())) return
    inFlight.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const value = await saveEvaluationCaseReview(runId, caseId, draft.decision, draft.decision === 'SUITABLE' ? '' : draft.comment.trim(), stamp())
      setData(value); setConfirmed(false)
      setCaseDrafts((drafts) => Object.fromEntries(Object.entries(drafts).filter(([id]) => id !== caseId)))
      setNotice(`${caseId} 사례 검토를 저장했습니다.`); setSavedCase(caseId); onChanged()
      if (advance && caseItems[selectedIndex + 1]) navigateReview(`case-review-${caseItems[selectedIndex + 1].case_id}`)
    } catch (reason) {
      if (reason instanceof OpsApiError && reason.status === 409) setConflict(true)
      if (reason instanceof OpsApiError && [401, 403].includes(reason.status)) expiry.current()
      else setError(reason instanceof Error ? reason.message : '사례 검토를 저장하지 못했습니다.')
    } finally { inFlight.current = false; setBusy(false) }
  }
  const mutate = async (decision?: 'APPROVED' | 'CHANGES_REQUESTED' | 'CLEAR') => {
    if (inFlight.current || locked || fixtureDirty || !data || (decision !== 'CLEAR' && !data.material) || (!decision && !latest)) return
    if (decision !== 'CLEAR' && hasDrafts) return
    inFlight.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const value = decision === 'CLEAR'
        ? await clearEvaluationBaseline(runId, data.baseline_version, clearReason.trim())
        : decision
        ? await saveEvaluationReview(runId, decision, comment.trim(), stamp())
        : await promoteEvaluationBaseline(runId, latest!.id, data.baseline_version)
      setData(value)
      if (decision === 'CLEAR') setClearReason('')
      else if (decision) { setConfirmed(false); setComment('') }
      onChanged()
      setNotice(decision === 'CLEAR' ? '비교 기준을 해제했습니다.' : decision ? '검토 기록을 저장했습니다.' : '이 데이터셋의 비교 기준으로 지정했습니다.')
    } catch (reason) {
      if (reason instanceof OpsApiError && reason.status === 409) setConflict(true)
      if (reason instanceof OpsApiError && [401, 403].includes(reason.status)) expiry.current()
      else setError(reason instanceof Error ? reason.message : '검토를 저장하지 못했습니다.')
    } finally { inFlight.current = false; setBusy(false) }
  }
  const overallForm = data?.material && <div className="grid gap-3">
    {!data.can_approve && <p className="text-sm text-amber-800">승인하려면 모든 답변을 문제없음으로 저장해 주세요.</p>}
    {data.is_baseline && <p className="text-sm text-amber-800">새 검토를 저장하면 이 비교 기준이 해제돼요.</p>}
    <label className="grid gap-2 text-sm font-semibold">검토 의견<textarea rows={3} maxLength={3000} required className="w-full rounded-xl border border-line p-3 font-normal" value={comment} disabled={locked || fixtureDirty} onChange={(event) => setComment(event.target.value)} placeholder="전체 답변을 확인한 의견을 적어 주세요." /></label>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" required checked={confirmed} disabled={locked || fixtureDirty} onChange={(event) => setConfirmed(event.target.checked)} />모든 질문과 공고 내용, 답변을 확인했어요.</label>
    <div className="flex flex-wrap items-center gap-3" role="group" aria-label="전체 검토 저장">
      <button className={`${styles.primaryButton} min-h-11 !text-sm`} disabled={locked || fixtureDirty || hasDrafts || !data.can_approve || !confirmed || !comment.trim()} onClick={() => void mutate('APPROVED')}>검토 승인 저장</button>
      <button className={`${styles.secondaryButton} min-h-11 !text-sm`} disabled={locked || fixtureDirty || hasDrafts || !confirmed || !comment.trim()} onClick={() => void mutate('CHANGES_REQUESTED')}>수정 필요 저장</button>
    </div>
  </div>
  return <section className={styles.card} aria-label="응답 검토와 기준 지정">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className={`${styles.cardTitle} !text-xl`}>답변 검토</h2><button className={`${styles.secondaryButton} min-h-11 !text-sm`} disabled={busy || loading || confirmRefresh} onClick={() => hasUnsaved ? setConfirmRefresh(true) : reload()}>검토 새로고침</button></div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="text-sm text-brand-primary">{notice}</p>}
    {confirmRefresh && <section aria-label="검토 입력 취소 확인" className="grid gap-3 rounded-xl bg-amber-50 p-4 text-sm">
      <p>저장하지 않은 사례 판단·기준 자료 검토·전체 의견·기준 해제 사유가 사라집니다. 입력을 버리고 최신 검토 기록을 불러올까요? 서버에 저장된 기록은 유지됩니다.</p>
      <div className="flex flex-wrap items-center gap-3"><button type="button" className={`${styles.secondaryButton} min-h-11 !text-sm`} onClick={() => setConfirmRefresh(false)}>계속 작성</button><button type="button" className={`${styles.secondaryButton} min-h-11 !text-sm`} onClick={reload}>입력 버리고 새로고침</button></div>
    </section>}
    {loading && data && <p role="status" className="text-sm">최신 검토 자료를 불러오는 동안 저장을 중지합니다.</p>}
    {loadFailed && <p className="text-sm text-amber-800">최신 검토 자료를 확인하지 못했습니다. 새로고침에 성공한 뒤 판단을 저장하세요.</p>}
    {conflict && <p className="text-sm text-amber-800">다른 검토나 자료 변경이 있습니다. 입력은 보존했으며 저장을 중지했습니다. 검토 새로고침으로 최신 기록을 확인한 뒤 다시 판단하세요.</p>}
    {!data ? loading && <p role="status">검토 자료를 불러오고 있습니다.</p> : <>
      <EvaluationReviewProgress data={data} hasDrafts={hasDrafts} fixtureDirty={fixtureDirty} draftCaseId={Object.keys(caseDrafts)[0]} disabled={locked || !!error} onNavigate={navigateReview} />
      {data.material_error && <p role="alert" className="text-sm text-red-700">{data.material_error}</p>}
      {data.baseline_requires_review && <p className="rounded-xl bg-amber-50 p-3 text-sm">이전에 지정한 비교 기준을 다시 검토해야 합니다. 검토와 품질 판정을 마치기 전에는 새 평가에 사용할 수 없습니다.</p>}
      {busy && <p role="status" className="text-sm">저장 중이에요.</p>}
      <nav aria-label="답변 검토 영역" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {([
          { id: 'criterion', label: '평가 기준', status: criterionStatus },
          { id: 'answers', label: '답변 확인', status: questionStatus },
          { id: 'overall', label: '전체·비교 (선택)', status: overallStatus },
        ] as const).map((panel) => <button key={panel.id} type="button" aria-label={`${panel.label} · ${panel.status}`} aria-pressed={activePanel === panel.id} disabled={busy} onClick={() => choosePanel(panel.id)} className={`grid min-h-11 min-w-0 content-center gap-1 rounded-xl border px-3 py-2 text-left last:col-span-2 sm:last:col-span-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary disabled:cursor-not-allowed disabled:opacity-60 ${activePanel === panel.id ? 'border-brand-primary bg-brand-soft text-ink' : 'border-line bg-white text-ink'}`}><span className="text-sm font-bold [overflow-wrap:anywhere]">{activePanel === panel.id && <span aria-hidden="true">✓ </span>}{panel.label}</span><span className="text-sm [overflow-wrap:anywhere]">{panel.status}</span></button>)}
      </nav>
      <div hidden={activePanel !== 'criterion'}>
      <QualityReviewPanel key={`${runId}:${refresh}`} runId={runId} data={data} busy={locked || hasDrafts} needsRefresh={loadFailed || conflict} active={inFlight} onBusy={setBusy} onDirty={setFixtureDirty} onConflict={() => setConflict(true)} onExpired={onExpired} onReviewAnswers={nextCriterionTarget ? () => navigateReview(nextCriterionTarget) : undefined} nextActionLabel={nextCriterionTarget ? '답변 확인하기' : undefined} onSaved={(value) => { setData(value); setConfirmed(false); onChanged() }} />
      </div>
      <div hidden={activePanel !== 'answers'}>
      <div className="grid gap-4">
      <section aria-label="질문과 답변 검토하기" className="min-w-0 rounded-xl border border-line bg-white"><div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 px-4 py-2"><div className="flex min-h-11 min-w-0 flex-wrap items-center gap-2 text-base font-bold text-ink"><h3>질문과 답변 검토하기</h3><span className={`${workspaceTagClassName(questionStatus === '확인 완료' ? 'ok' : questionStatus === '문제 있음' ? 'danger' : 'info')} !text-sm`}>{questionStatus}</span></div></div>
      <div className="grid gap-4 border-t border-line p-4">
      {caseItems.length > 0 ? <>
      <div className="grid gap-2">
      <details className="group min-w-0 rounded-xl border border-line text-sm">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary [&::-webkit-details-marker]:hidden"><span>자료 출처와 변경 내용</span><span aria-hidden="true" className="shrink-0 whitespace-nowrap text-xs text-brand-primary"><span className="group-open:hidden">펼치기 +</span><span className="hidden group-open:inline">접기 −</span></span></summary>
        <div className="grid min-w-0 gap-3 border-t border-line p-4 leading-6 [overflow-wrap:anywhere]">
          {data.material?.data_type === 'admin-provided' && <p>관리자가 등록한 공고 내용과 기준이에요. 실제 공고와 첨부파일 포함 여부를 확인해 주세요.</p>}
          {data.material?.data_type === 'official-html-snapshot' && <p>실제 공고에서 저장한 본문이에요. 첨부파일과 이후 변경 내용은 포함되지 않았어요. 평가 기준이 공고 내용과 맞는지 확인해 주세요.</p>}
          {data.material?.data_type === 'synthetic' && <p>가상으로 만든 평가 자료예요.</p>}
          {data.material?.candidate_origin === 'admin-entered-answer' && <p>관리자가 직접 입력한 답변이에요. 실제 모델 호출 기록이 아니며, 현재 모델의 성능을 새로 측정한 결과가 아니에요.</p>}
          {data.material?.candidate_origin === 'historical-answer-projection' && <p>과거 저장 답변 · {data.material.recorded_model || '모델 미기록'} · {data.material.recorded_at ? new Date(data.material.recorded_at).toLocaleString('ko-KR') : '시각 미기록'}. 이번에 생성한 답변이 아니며 현재 모델과 공고 검색 성능을 새로 측정하지 않았어요.</p>}
          {data.material?.reference_revision && <section aria-label="참조 조건 변경 내용" className="grid gap-2 border-t border-line pt-3">
            <h4 className="font-semibold">평가 기준이 바뀌었어요</h4>
            <p>{data.material.reference_revision.reason}</p>
            <p>변경된 질문: {data.material.reference_revision.changed_case_ids.join(', ')}</p>
            <p>공고 원문과 과거 답변은 유지했어요. 이전 자료의 승인과 비교 기준은 적용되지 않으므로 다시 확인해 주세요.</p>
            <details><summary className="cursor-pointer font-semibold">변경 근거 자세히 보기</summary><div className="mt-2 grid gap-2"><p className="break-all">이전 자료: {data.material.reference_revision.previous_dataset_id}</p><blockquote className="border-l-2 border-brand-primary pl-3">{data.material.reference_revision.source_quote}</blockquote></div></details>
          </section>}
          {!data.material?.data_type && !['admin-entered-answer', 'historical-answer-projection'].includes(data.material?.candidate_origin ?? '') && !data.material?.reference_revision && <p>자료 출처와 변경 내용이 기록되지 않았어요.</p>}
        </div>
      </details>
      <details className="group min-w-0 rounded-xl border border-line text-sm">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary [&::-webkit-details-marker]:hidden"><span>답변 확인 기준</span><span aria-hidden="true" className="shrink-0 whitespace-nowrap text-xs text-brand-primary"><span className="group-open:hidden">펼치기 +</span><span className="hidden group-open:inline">접기 −</span></span></summary>
        <div className="min-w-0 border-t border-line p-4 leading-6 [overflow-wrap:anywhere]">{data.rubric.criteria.length ? <ul className="list-disc space-y-2 pl-5">{data.rubric.criteria.map((criterion) => <li key={criterion}>{readableReviewCriteria.get(criterion) ?? criterion}</li>)}</ul> : <p>답변 확인 기준이 기록되지 않았어요.</p>}</div>
      </details>
      </div>
      {caseItems.length > 1 && <section aria-label="사례 선택" className="grid gap-3 rounded-xl border border-line bg-slate-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">질문별로 답변을 확인하세요</h3><span className="text-sm tabular-nums">{selectedIndex + 1} / {caseItems.length}번째 질문</span></div>
        <label className="grid gap-2 text-sm font-semibold">확인할 질문
          <select className="min-h-11 w-full min-w-0 rounded-xl border border-line bg-white p-3" value={caseItems[selectedIndex].case_id} disabled={locked} onChange={(event) => selectCase(caseItems.findIndex((item) => item.case_id === event.target.value))}>
            {caseItems.map((item) => {
              const review = data.case_reviews.find((row) => row.case_id === item.case_id)
              const current = review?.capture_sha256 === data.material?.capture_sha256 && review?.fixture_sha256 === data.material?.fixture_sha256 && review?.rubric_version === data.rubric.version
              return <option key={item.case_id} value={item.case_id}>{item.case_id} · {caseDrafts[item.case_id] ? '작성 중' : current ? caseLabel(review.decision) : '미검토'} · {item.question}</option>
            })}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={`${styles.secondaryButton} min-h-11 !text-sm`} disabled={locked || selectedIndex === 0} onClick={() => selectCase(selectedIndex - 1)}>이전 질문</button>
          <button type="button" className={`${styles.secondaryButton} min-h-11 !text-sm`} disabled={locked || selectedIndex === caseItems.length - 1} onClick={() => selectCase(selectedIndex + 1)}>다음 질문</button>
        </div>
        <p className="text-xs text-ink-muted">질문을 바꿔도 작성 내용은 남아요. 확인이 끝나면 저장해 주세요.</p>
      </section>}
      {caseItems.slice(selectedIndex, selectedIndex + 1).map((item) => {
        const history = data.case_reviews.filter((review) => review.case_id === item.case_id)
        const current = history[0]
        const valid = current?.capture_sha256 === data.material?.capture_sha256 && current?.fixture_sha256 === data.material?.fixture_sha256 && current?.rubric_version === data.rubric.version
        const draft = caseDrafts[item.case_id] ?? { decision: valid ? current.decision : '', comment: valid ? current.comment : '' }
        const needsReason = draft.decision === 'UNSUITABLE' || draft.decision === 'DEFERRED'
        const reasonLabel = draft.decision === 'UNSUITABLE' ? '어떤 문제가 있나요?' : '무엇을 더 확인해야 하나요?'
        return <article id={`case-review-${item.case_id}`} tabIndex={-1} key={item.case_id} style={{ scrollMarginTop: 'calc(var(--workspace-header-h, 0px) + 1rem)' }} className="grid gap-4 rounded-xl border border-line p-4">
        <h3 className="font-bold">{item.case_id} · {item.question}</h3>
        <p className="text-xs text-ink-muted">{item.document_title}</p>
        {item.source_url && <a className="text-xs text-brand-primary underline" href={item.source_url} target="_blank" rel="noreferrer">관리자가 기록한 출처 보기 · 자동 수집 없음</a>}
        {item.source && <div className="grid gap-1 text-xs text-ink-muted"><a className="underline" href={item.source.url} target="_blank" rel="noreferrer">공고 출처 보기</a><p>원문 수집: {new Date(item.source.collected_at).toLocaleString('ko-KR')} · 저장한 HTML 본문 · 첨부 미포함</p><details><summary>저장 원문 검증 정보</summary><p className="break-all">HTML SHA-256: {item.source.html_sha256}</p><p className="break-all">본문 SHA-256: {item.source.content_sha256}</p></details></div>}
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <section className="min-w-0 rounded-xl bg-slate-50 p-4" aria-label={`${item.case_id} 원문과 참조 조건`}>
            <h4 className="mb-3 font-bold">1. 공고 내용 확인</h4>
            <details open><summary className="cursor-pointer text-sm font-semibold">답변에 제공한 공고 내용</summary><div className="mt-3 grid gap-3">{item.evidence.map((chunk) => <div key={chunk.order} className="min-w-0 border-l-2 border-brand-primary pl-3 text-sm leading-7 [overflow-wrap:anywhere]"><strong>공고 내용 {chunk.order + 1}{item.cited_orders.includes(chunk.order) ? ' · 답변에서 사용함' : ''}</strong><p className="whitespace-pre-wrap break-words">{chunk.text}</p></div>)}</div></details>
            <details className="mt-4 border-t border-line pt-3"><summary className="cursor-pointer text-sm font-semibold">{data.material?.reference_source === 'admin-authored' ? '관리자가 작성한 평가 조건' : 'AI가 작성한 평가 조건'}</summary><div className="mt-3 grid gap-2 text-sm leading-6"><p>예상 상태: {item.expected_status === 'ANSWERED' ? '근거로 답변 가능' : '근거 부족으로 답변을 보류해야 함'} · 인용해야 할 근거 번호: {item.expected_citation_orders.map((order) => order + 1).join(', ') || '없음'}</p><p className="text-xs text-ink-muted">공고 내용은 첫 번째부터 1번으로 표시합니다.</p><p>포함할 사실: {item.reference_facts.join(' / ') || '지정 없음'}</p><p>포함하면 안 되는 주장: {item.forbidden_claims.join(' / ') || '검토 기준 미설정'}</p></div></details>
          </section>
          <section className="min-w-0 rounded-xl border border-brand-primary/20 bg-[#f3f7f5] p-4" aria-label={`${item.case_id} 검토할 답변`}>
            <h4 className="mb-2 font-bold">2. 답변 확인</h4>
            <h5 className="sr-only">후보 답변</h5><p className="whitespace-pre-wrap break-words text-sm leading-7">{item.answer}</p><p className="mt-3 text-xs">{item.answer_status === 'ANSWERED' ? '답변 제공' : item.answer_status === 'INSUFFICIENT_EVIDENCE' ? '근거 부족으로 답변 보류' : `답변 상태: ${item.answer_status}`} · 답변에 표시한 공고 내용 번호: {item.cited_orders.map((order) => order + 1).join(', ') || '없음'}</p>
            <details className="mt-4 border-t border-line pt-3"><summary className="cursor-pointer text-sm font-semibold">기존 기준 답변</summary><p className="my-2 text-xs text-ink-muted">이전 답변입니다. 공고 내용을 기준으로 판단하세요.</p><p className="whitespace-pre-wrap break-words text-sm leading-7">{item.reference_answer}</p></details>
          </section>
        </div>
        <div className="grid gap-3 border-t border-line pt-4"><h4 className="font-bold">3. 답변이 맞는지 확인</h4>
          {current && !valid && <p className="text-sm font-semibold text-amber-800">자료나 평가 기준이 바뀌어 다시 확인해야 해요.</p>}
          {valid && caseDrafts[item.case_id] && draft.decision !== current.decision && <p className="text-sm font-semibold">이전에 저장한 판단: {{ SUITABLE: '문제없음', UNSUITABLE: '문제 있음', DEFERRED: '판단 보류' }[current.decision]}</p>}
          <label className="grid gap-2 text-sm">{item.case_id} 판단<select className="rounded-xl border border-line p-3" value={draft.decision} disabled={locked || fixtureDirty} onChange={(event) => setCaseDrafts((values) => ({ ...values, [item.case_id]: { ...draft, decision: event.target.value as CaseReviewDecision | '' } }))}><option value="">선택해 주세요</option><option value="SUITABLE">문제없어요 (적합)</option><option value="UNSUITABLE">문제가 있어요 (부적합)</option><option value="DEFERRED">판단하기 어려워요 (보류)</option></select></label>
          {needsReason && <label className="grid gap-2 text-sm"><span>{reasonLabel} <span className="text-ink-muted">필수</span></span><textarea aria-label={`${item.case_id} ${reasonLabel}`} required className="rounded-xl border border-line p-3" rows={3} maxLength={3000} placeholder={draft.decision === 'UNSUITABLE' ? '답변에서 틀리거나 빠진 내용을 적어 주세요.' : '확인이 필요한 내용을 적어 주세요.'} value={draft.comment} disabled={locked || fixtureDirty} onChange={(event) => setCaseDrafts((values) => ({ ...values, [item.case_id]: { ...draft, comment: event.target.value } }))} /></label>}
          <div className="flex flex-wrap items-center gap-3">
            <button className={`${styles.primaryButton} min-h-11 !text-sm`} disabled={locked || fixtureDirty || !caseDrafts[item.case_id] || !draft.decision || (needsReason && !draft.comment.trim())} onClick={() => void saveCase(item.case_id)}>{item.case_id} 검토 저장</button>
            {selectedIndex < caseItems.length - 1 && <button className={`${styles.secondaryButton} min-h-11 !text-sm`} disabled={locked || fixtureDirty || !caseDrafts[item.case_id] || !draft.decision || (needsReason && !draft.comment.trim())} onClick={() => void saveCase(item.case_id, true)}>저장하고 다음 질문</button>}
          </div>
          {savedCase === item.case_id && !caseDrafts[item.case_id] && <div className="grid justify-items-start gap-3 rounded-lg bg-green-50 p-3 text-sm text-brand-primary"><p role="status">저장했어요.</p>{canGuide && nextPendingCase && <button type="button" className={`${styles.secondaryButton} min-h-11 !text-sm`} onClick={() => navigateReview(`case-review-${nextPendingCase.id}`)}>확인이 필요한 질문으로 이동</button>}</div>}
          {!!history.length && <details><summary className="cursor-pointer text-sm">{item.case_id} 검토 이력 · {history.length}건</summary><ol className="mt-2 space-y-2">{history.map((review) => <li key={review.id} className="rounded-xl bg-slate-50 p-3 text-sm"><p>{caseLabel(review.decision)} · {review.reviewed_by} · {new Date(review.created_at).toLocaleString('ko-KR')}</p>{review.comment && <p className="whitespace-pre-wrap">{review.comment}</p>}</li>)}</ol></details>}
        </div>
      </article>})}
      </> : <p className="text-sm">확인할 질문이 없어요.</p>}
      </div></section>
      </div>
      </div>
      <div hidden={activePanel !== 'overall'}>
      <section id="overall-review" aria-label="전체 검토와 비교 기준" tabIndex={-1} style={{ scrollMarginTop: 'calc(var(--workspace-header-h, 0px) + 1rem)' }} className="min-w-0 rounded-xl border border-line bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary">
        <div className="flex min-h-11 min-w-0 flex-wrap items-center gap-2 px-4 py-3 text-base font-bold text-ink"><h3>전체 검토와 비교 기준</h3><span className={`${workspaceTagClassName(overallStatus === '검토 승인' || overallStatus === '비교 기준 사용 중' ? 'ok' : overallStatus === '기준 재확인 필요' ? 'warn' : 'info')} !text-sm`}>{overallStatus}</span></div>
        <div className="grid gap-4 border-t border-line p-4">
      <QualityResultPanel key={`result:${runId}:${refresh}`} runId={runId} data={data} busy={locked || hasDrafts} navigationDisabled={busy} hasAnswerDrafts={hasDrafts && !locked && !fixtureDirty} needsRefresh={loadFailed || conflict} active={inFlight} fixtureDirty={fixtureDirty} onBusy={setBusy} onNavigate={navigateReview} onConflict={() => setConflict(true)} onExpired={onExpired} onSaved={(value) => { setData(value); setConfirmed(false); onChanged() }} />
        {(data.material || data.is_baseline || data.reviews.length > 0 || data.baseline_history.length > 0) ? <>
        {(busy || loading || loadFailed || conflict || confirmRefresh || fixtureDirty || hasDrafts) && <p className="text-sm text-amber-800">{busy ? '저장 중이에요.' : loading ? '최신 검토 기록을 불러오고 있어요.' : loadFailed || conflict ? '최신 검토 기록을 다시 확인해 주세요.' : confirmRefresh ? '새로고침 여부를 먼저 선택해 주세요.' : fixtureDirty ? '작성 중인 평가 기준을 먼저 저장해 주세요.' : '작성 중인 답변을 저장해야 전체 검토와 기준 지정을 할 수 있어요.'}</p>}
        <section aria-label="전체 검토" className="grid gap-3 rounded-xl bg-slate-50 p-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2"><h4 className="text-base font-bold">전체 검토</h4><span className={`${workspaceTagClassName(overallReviewStatus === '승인 완료' ? 'ok' : overallReviewStatus === '수정 필요' || overallReviewStatus === '다시 확인 필요' ? 'warn' : 'info')} !text-sm`}>{overallReviewStatus}</span></div>
          {data.material ? data.approval_current ? <>
            <details className="group rounded-lg border border-line bg-white"><summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-semibold [&::-webkit-details-marker]:hidden"><span>검토 내용 변경하기</span><span aria-hidden="true" className="shrink-0 whitespace-nowrap text-xs text-brand-primary"><span className="group-open:hidden">펼치기 +</span><span className="hidden group-open:inline">접기 −</span></span></summary><div className="border-t border-line p-3">{overallForm}</div></details>
          </> : overallForm : <p className="text-sm">검토할 자료를 확인할 수 없어요.</p>}
          {!!data.reviews.length && <details><summary className="cursor-pointer text-sm font-semibold">검토 이력 · {data.reviews.length}건</summary><ol className="mt-3 grid gap-3">{data.reviews.map((review) => <li key={review.id} className="rounded-xl bg-white p-3 text-sm"><p className="font-semibold">{review.decision === 'APPROVED' ? '검토 승인' : '수정 필요'} · {review.reviewed_by} · {new Date(review.created_at).toLocaleString('ko-KR')}</p><p className="mt-2 whitespace-pre-wrap">{review.comment}</p></li>)}</ol></details>}
        </section>
        <section aria-label="다음 평가의 비교 기준" className="grid gap-3 rounded-xl border border-line p-4">
          <EvaluationHelp label="비교 기준" title={<h4 className="text-base font-bold">다음 평가의 비교 기준</h4>}><p>이 결과를 같은 자료로 진행하는 다음 평가의 비교 기준으로 사용해요. 이미 접수한 평가는 바뀌지 않아요. 이 실행에 새 검토를 저장하면 기준 지정이 해제됩니다.</p></EvaluationHelp>
          {data.is_baseline ? <>
            <p className="text-sm">{loadFailed || conflict ? '비교 기준 상태를 다시 확인해 주세요.' : data.baseline_requires_review ? '비교 기준을 다시 확인해야 해요.' : '이 결과를 비교 기준으로 사용 중이에요.'}</p>
            <details className="group rounded-lg border border-line bg-white">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-semibold [&::-webkit-details-marker]:hidden"><span>비교 기준 해제하기</span><span aria-hidden="true" className="shrink-0 whitespace-nowrap text-xs text-brand-primary"><span className="group-open:hidden">펼치기 +</span><span className="hidden group-open:inline">접기 −</span></span></summary>
              <div className="grid gap-3 border-t border-line p-3"><label className="grid gap-2 text-sm font-semibold">기준 해제 이유<textarea rows={3} maxLength={3000} className="w-full rounded-xl border border-line p-3 font-normal" value={clearReason} disabled={locked || fixtureDirty} onChange={(event) => setClearReason(event.target.value)} placeholder="기준을 해제하는 이유를 적어 주세요." /></label><div><button className={`${styles.secondaryButton} min-h-11 !text-sm`} disabled={locked || fixtureDirty || !clearReason.trim()} onClick={() => void mutate('CLEAR')}>비교 기준 해제</button></div></div>
            </details>
          </> : <>
            {!data.material ? <p className="text-sm text-ink-muted">자료를 확인하지 못해 비교 기준을 지정할 수 없어요.</p> : !data.approval_current ? <p className="text-sm text-ink-muted">전체 검토를 승인한 뒤 지정할 수 있어요.</p> : !data.can_promote ? <p className="text-sm text-ink-muted">{!quality?.input_sha256 ? '전체 답변 결과를 확인할 수 없어요.' : !quality.is_current ? quality.history.length > 0 || quality.status !== 'NOT_EVALUATED' ? '전체 답변 결과를 다시 판정해 주세요.' : '전체 답변 결과를 먼저 판정해 주세요.' : '전체 답변 결과가 합격이어야 지정할 수 있어요.'}</p> : <p className="text-sm text-ink-muted">새 기준을 지정하면 기존 기준이 바뀌어요.</p>}
            {data.material && data.approval_current && !data.can_promote && !!quality?.input_sha256 && <button type="button" className="min-h-11 justify-self-start rounded-md text-left text-sm font-semibold text-brand-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary disabled:cursor-not-allowed disabled:opacity-60" disabled={busy} onClick={() => navigateReview('quality-review')}>전체 답변 결과로 이동</button>}
            <div><button className={`${styles.secondaryButton} min-h-11 !text-sm`} disabled={locked || fixtureDirty || hasDrafts || !data.material || !data.approval_current || !data.can_promote} onClick={() => void mutate()}>비교 기준으로 지정</button></div>
            {clearReason !== '' && <div className="grid gap-2 rounded-lg bg-slate-50 p-3"><p className="text-sm">비교 기준이 해제되어 작성 중이던 이유는 저장되지 않았어요.</p><label className="grid gap-2 text-sm font-semibold">기준 해제 이유<textarea rows={3} maxLength={3000} className="w-full rounded-xl border border-line p-3 font-normal" value={clearReason} disabled={locked || fixtureDirty} onChange={(event) => setClearReason(event.target.value)} /></label><div><button className={`${styles.secondaryButton} min-h-11 !text-sm`} disabled={locked || fixtureDirty} onClick={() => setClearReason('')}>작성한 이유 지우기</button></div></div>}
          </>}
          {!!data.baseline_history.length && <details><summary className="cursor-pointer text-sm font-semibold">비교 기준 변경 이력 · {data.baseline_history.length}건</summary><ol className="mt-3 grid gap-3">{data.baseline_history.map((item) => <li key={item.version} className="rounded-xl bg-slate-50 p-3 text-sm"><p className="font-semibold">버전 {item.version} · {item.run_id ? item.previous_run_id ? '교체' : '지정' : '해제'} · {item.changed_by} · {new Date(item.created_at).toLocaleString('ko-KR')}</p><p className="break-all">{item.previous_run_id ?? '기준 없음'} → {item.run_id ?? '기준 없음'}</p><p className="mt-2 whitespace-pre-wrap">{item.reason}</p></li>)}</ol></details>}
        </section>
        </> : <p className="text-sm">확인할 전체 검토가 없어요.</p>}
        </div>
      </section>
      </div>
    </>}
  </section>
}
