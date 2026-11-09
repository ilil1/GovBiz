import { useEffect, useRef, useState } from 'react'
import { clearEvaluationBaseline, getEvaluationReview, OpsApiError, promoteEvaluationBaseline, saveEvaluationCaseReview, saveEvaluationReview } from '../../../data/ops/opsApi'
import type { CaseReviewDecision, EvaluationReview } from '../../../data/ops/opsApi'
import { workspacePageStyles as styles, workspaceTagClassName } from '../../shared/workspace/WorkspacePage.styles'
import { QualityReviewPanel } from './QualityReviewPanel'
import { EvaluationReviewProgress } from './EvaluationReviewProgress'
import { EvaluationHelp } from './EvaluationHelp'

export function EvaluationReviewPanel({ runId, onExpired, onChanged }: { runId: string; onExpired: () => void; onChanged: () => void }) {
  const [data, setData] = useState<EvaluationReview | null>(null)
  const [loading, setLoading] = useState(true)
  const [comment, setComment] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [selectedCase, setSelectedCase] = useState('')
  const [focusTarget, setFocusTarget] = useState<string | null>(null)
  const [savedCase, setSavedCase] = useState('')
  const [fixtureDirty, setFixtureDirty] = useState(false)
  const [confirmRefresh, setConfirmRefresh] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [caseDrafts, setCaseDrafts] = useState<Record<string, { decision: CaseReviewDecision | ''; comment: string }>>({})
  const expiry = useRef(onExpired); expiry.current = onExpired
  const inFlight = useRef(false)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    getEvaluationReview(runId, controller.signal).then((value) => {
      if (!controller.signal.aborted) { setData(value); setError(''); setLoadFailed(false); setConflict(false); setConfirmed(false); setCaseDrafts({}) }
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
    const element = document.getElementById(focusTarget)
    for (let details = element?.closest('details') ?? null; details; details = details.parentElement?.closest('details') ?? null) details.open = true
    element?.focus(); element?.scrollIntoView({ block: 'start' })
    setFocusTarget(null)
  }, [focusTarget, selectedCase])
  const navigateReview = (target: string) => {
    if (target.startsWith('case-review-')) setSelectedCase(target.slice('case-review-'.length))
    setFocusTarget(target)
  }
  const caseItems = data?.material?.cases ?? []
  const selectedIndex = Math.max(0, caseItems.findIndex((item) => item.case_id === selectedCase))
  const selectCase = (index: number) => {
    const item = caseItems[index]
    if (item) { setSelectedCase(item.case_id); setSavedCase('') }
  }
  const latest = data?.reviews[0]
  const hasDrafts = Object.keys(caseDrafts).length > 0
  const hasUnsaved = hasDrafts || fixtureDirty || comment !== '' || confirmed
  const locked = busy || loading || loadFailed || conflict || confirmRefresh
  const reload = () => {
    if (busy || loading) return
    setConfirmRefresh(false); setCaseDrafts({}); setFixtureDirty(false); setComment(''); setConfirmed(false)
    setNotice(''); setLoading(true); setRefresh((value) => value + 1)
  }
  const stamp = () => ({ capture_sha256: data!.material!.capture_sha256, fixture_sha256: data!.material!.fixture_sha256, rubric_version: data!.rubric.version, review_version: data!.review_version })
  const caseLabel = (decision: CaseReviewDecision) => ({ SUITABLE: '적합', UNSUITABLE: '부적합', DEFERRED: '판단 보류' })[decision]
  const saveCase = async (caseId: string, advance = false) => {
    const draft = caseDrafts[caseId]
    if (inFlight.current || locked || fixtureDirty || !data?.material || !draft?.decision || !draft.comment.trim()) return
    inFlight.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const value = await saveEvaluationCaseReview(runId, caseId, draft.decision, draft.comment.trim(), stamp())
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
        ? await clearEvaluationBaseline(runId, data.baseline_version, comment.trim())
        : decision
        ? await saveEvaluationReview(runId, decision, comment.trim(), stamp())
        : await promoteEvaluationBaseline(runId, latest!.id, data.baseline_version)
      setData(value); setConfirmed(false); setComment(''); onChanged()
      setNotice(decision === 'CLEAR' ? '비교 기준을 해제했습니다.' : decision ? '검토 기록을 저장했습니다.' : '이 데이터셋의 비교 기준으로 지정했습니다.')
    } catch (reason) {
      if (reason instanceof OpsApiError && reason.status === 409) setConflict(true)
      if (reason instanceof OpsApiError && [401, 403].includes(reason.status)) expiry.current()
      else setError(reason instanceof Error ? reason.message : '검토를 저장하지 못했습니다.')
    } finally { inFlight.current = false; setBusy(false) }
  }
  return <section className={styles.card} aria-label="응답 검토와 기준 지정">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className={styles.cardTitle}>답변 검토</h2><button className={`${styles.secondaryButton} min-h-11 !text-sm`} disabled={busy || loading || confirmRefresh} onClick={() => hasUnsaved ? setConfirmRefresh(true) : reload()}>검토 새로고침</button></div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="text-sm text-brand-primary">{notice}</p>}
    {confirmRefresh && <section aria-label="검토 입력 취소 확인" className="grid gap-3 rounded-xl bg-amber-50 p-4 text-sm">
      <p>저장하지 않은 사례 판단·기준 자료 검토·전체 의견이 사라집니다. 입력을 버리고 최신 검토 기록을 불러올까요? 서버에 저장된 기록은 유지됩니다.</p>
      <div className="flex flex-wrap items-center gap-3"><button type="button" className={`${styles.secondaryButton} min-h-11 !text-sm`} onClick={() => setConfirmRefresh(false)}>계속 작성</button><button type="button" className={`${styles.secondaryButton} min-h-11 !text-sm`} onClick={reload}>입력 버리고 새로고침</button></div>
    </section>}
    {loading && data && <p role="status" className="text-sm">최신 검토 자료를 불러오는 동안 저장을 중지합니다.</p>}
    {loadFailed && <p className="text-sm text-amber-800">최신 검토 자료를 확인하지 못했습니다. 새로고침에 성공한 뒤 판단을 저장하세요.</p>}
    {conflict && <p className="text-sm text-amber-800">다른 검토나 자료 변경이 있습니다. 입력은 보존했으며 저장을 중지했습니다. 검토 새로고침으로 최신 기록을 확인한 뒤 다시 판단하세요.</p>}
    {!data ? loading && <p role="status">검토 자료를 불러오고 있습니다.</p> : <>
      <EvaluationReviewProgress data={data} hasDrafts={hasDrafts} draftCaseId={Object.keys(caseDrafts)[0]} disabled={locked || !!error} onNavigate={navigateReview} />
      {data.material_error && <p role="alert" className="text-sm text-red-700">{data.material_error}</p>}
      {data.baseline_requires_review && <p className="rounded-xl bg-amber-50 p-3 text-sm">이전에 지정한 비교 기준을 다시 검토해야 합니다. 검토와 품질 판정을 마치기 전에는 새 평가에 사용할 수 없습니다.</p>}
      <QualityReviewPanel key={`${runId}:${refresh}`} runId={runId} data={data} busy={locked || hasDrafts} onBusy={setBusy} onDirty={setFixtureDirty} onConflict={() => setConflict(true)} onExpired={onExpired} onNavigate={navigateReview} onSaved={(value) => { setData(value); setConfirmed(false); onChanged() }} />
      <details className="group rounded-xl border border-line p-4"><summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 font-semibold [&::-webkit-details-marker]:hidden"><span>질문과 답변 검토하기</span><span aria-hidden="true" className="text-xs text-brand-primary"><span className="group-open:hidden">펼치기 +</span><span className="hidden group-open:inline">접기 −</span></span></summary>
      <div className="mt-4 grid gap-4">
      <details className="text-sm"><summary className="cursor-pointer font-semibold">평가 자료의 출처·범위·변경 내용</summary><div className="mt-3 grid gap-3">
      {data.material?.data_type === 'admin-provided' && <p className="rounded-xl bg-slate-50 p-3 text-sm">관리자가 직접 입력한 공고 내용과 기준이에요. 링크의 본문이나 첨부파일을 가져온 것은 아니므로 직접 확인해 주세요.</p>}
      {data.material?.candidate_origin === 'admin-entered-answer' && <p className="rounded-xl bg-amber-50 p-3 text-sm">관리자 입력 답변 · 실제 모델 호출 기록이 아닙니다. 무료 채점·검토용이며 현재 모델의 성능 측정으로 해석하지 마세요.</p>}
      {data.material?.data_type === 'official-html-snapshot' && <p className="rounded-xl bg-amber-50 p-3 text-sm">실제 공고에서 저장한 본문이에요. 첨부파일과 이후 변경 내용은 포함되지 않았어요. AI가 작성한 기준이 공고와 맞는지 확인해 주세요.</p>}
      {data.material?.candidate_origin === 'historical-answer-projection' && <p className="rounded-xl bg-slate-50 p-3 text-sm">과거 저장 응답 · {data.material.recorded_model} · {data.material.recorded_at ? new Date(data.material.recorded_at).toLocaleString('ko-KR') : '시각 미기록'}. 이번에 생성한 응답이나 현재 모델의 성능이나 공고 검색 성능을 새로 측정한 결과는 아니에요.</p>}
      {data.material?.reference_revision && <section aria-label="참조 조건 변경 내용" className="grid gap-2 rounded-xl bg-amber-50 p-4 text-sm">
        <h3 className="font-bold">참조 조건을 보완한 새 평가 자료</h3>
        <p>{data.material.reference_revision.reason}</p>
        <p>변경 사례: {data.material.reference_revision.changed_case_ids.join(', ')} · 이전 자료: {data.material.reference_revision.previous_dataset_id}</p>
        <blockquote className="border-l-2 border-amber-400 pl-3">{data.material.reference_revision.source_quote}</blockquote>
        <p>공고 원문과 과거 답변은 유지했습니다. 이전 자료의 승인·비교 기준은 이 버전에 승계되지 않으므로 기준 자료와 사례를 다시 검토하세요.</p>
      </section>}
      </div></details>
      <p><span className={workspaceTagClassName(data.approval_current ? 'ok' : 'info')}>{data.approval_current ? '검토 승인' : latest?.decision === 'APPROVED' ? '이전 승인 · 사례별 재검토 필요' : latest ? '수정 필요' : '미검토'}</span>{data.is_baseline && <span className="ml-3 text-sm font-semibold text-brand-primary">지금 비교에 쓰는 결과</span>}</p>
      <details className="rounded-xl bg-slate-50 p-4 text-sm"><summary className="cursor-pointer font-semibold">답변을 확인할 때 볼 기준</summary><ul className="mt-2 list-disc space-y-1 pl-5">{data.rubric.criteria.map((criterion) => <li key={criterion}>{criterion}</li>)}</ul><p className="mt-2">모든 질문을 적합으로 저장해야 전체 승인할 수 있습니다.</p></details>
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
        <div className="grid gap-3 border-t border-line pt-4"><h4 className="font-bold">3. 답변이 맞는지 확인</h4><p className="text-sm font-semibold">저장된 판단: {valid ? caseLabel(current.decision) : current ? '자료 또는 검토 기준 변경 · 재검토 필요' : '미검토'}</p>
          <label className="grid gap-2 text-sm">{item.case_id} 판단<select className="rounded-xl border border-line p-3" value={draft.decision} disabled={locked || fixtureDirty} onChange={(event) => setCaseDrafts((values) => ({ ...values, [item.case_id]: { ...draft, decision: event.target.value as CaseReviewDecision | '' } }))}><option value="">선택해 주세요</option><option value="SUITABLE">문제없어요 (적합)</option><option value="UNSUITABLE">문제가 있어요 (부적합)</option><option value="DEFERRED">판단하기 어려워요 (보류)</option></select></label>
          <label className="grid gap-2 text-sm">{item.case_id} 확인한 이유<textarea className="rounded-xl border border-line p-3" rows={3} maxLength={3000} placeholder="확인한 원문 위치와 답변에 맞거나 빠진 내용을 적어 주세요." value={draft.comment} disabled={locked || fixtureDirty} onChange={(event) => setCaseDrafts((values) => ({ ...values, [item.case_id]: { ...draft, comment: event.target.value } }))} /></label>
          <div className="flex flex-wrap items-center gap-3">
            <button className={`${styles.primaryButton} min-h-11 !text-sm`} disabled={locked || fixtureDirty || !caseDrafts[item.case_id] || !draft.decision || !draft.comment.trim()} onClick={() => void saveCase(item.case_id)}>{item.case_id} 검토 저장</button>
            {selectedIndex < caseItems.length - 1 && <button className={`${styles.secondaryButton} min-h-11 !text-sm`} disabled={locked || fixtureDirty || !caseDrafts[item.case_id] || !draft.decision || !draft.comment.trim()} onClick={() => void saveCase(item.case_id, true)}>저장하고 다음 질문</button>}
          </div>
          {savedCase === item.case_id && !caseDrafts[item.case_id] && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-brand-primary">저장 완료. {selectedIndex < caseItems.length - 1 ? '다음 질문을 확인해 주세요.' : '모든 질문을 확인했다면 전체 검토를 진행해 주세요.'}</p>}
          {(!draft.decision || !draft.comment.trim()) && <p className="text-xs text-ink-muted">판단과 이유를 입력해 주세요.</p>}
          {!!history.length && <details><summary className="cursor-pointer text-sm">{item.case_id} 검토 이력 · {history.length}건</summary><ol className="mt-2 space-y-2">{history.map((review) => <li key={review.id} className="rounded-xl bg-slate-50 p-3 text-sm"><p>{caseLabel(review.decision)} · {review.reviewed_by} · {new Date(review.created_at).toLocaleString('ko-KR')}</p><p className="whitespace-pre-wrap">{review.comment}</p></li>)}</ol></details>}
        </div>
      </article>})}
      </div></details>
      {(data.material || data.is_baseline) && <details id="overall-review" tabIndex={-1} style={{ scrollMarginTop: 'calc(var(--workspace-header-h, 0px) + 1rem)' }} className="group rounded-xl border border-line p-4">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 font-bold [&::-webkit-details-marker]:hidden"><span>전체 검토와 비교 기준</span><span aria-hidden="true" className="text-xs text-brand-primary"><span className="group-open:hidden">펼치기 +</span><span className="hidden group-open:inline">접기 −</span></span></summary>
        <div className="mt-4 grid gap-3">
        <p className="text-sm text-ink-muted">질문별 확인을 마쳤다면 전체 의견을 적고 저장해 주세요.</p>
        {!data.can_approve && <p className="text-sm text-amber-800">전체 승인 전에는 모든 답변을 확인하고 적합으로 저장해야 합니다.</p>}
        <label className="grid gap-2 text-sm font-semibold">검토 의견<textarea rows={3} maxLength={3000} className="w-full rounded-xl border border-line p-3 font-normal" value={comment} disabled={locked || fixtureDirty} onChange={(event) => setComment(event.target.value)} placeholder="근거와 답변을 대조한 판단과 남은 문제를 기록하세요." /></label>
        {data.material && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={locked || fixtureDirty} onChange={(event) => setConfirmed(event.target.checked)} />위 모든 사례의 질문·근거·후보 답변을 검토했습니다.</label>}
        {hasDrafts && <p className="text-sm text-amber-800">저장하지 않은 사례 판단이 있습니다. 먼저 사례 검토를 저장하세요.</p>}
        <div className="flex flex-wrap items-center gap-3" role="group" aria-label="전체 검토 저장">
          <button className={`${styles.primaryButton} min-h-11 !text-sm`} disabled={locked || fixtureDirty || hasDrafts || !data.can_approve || !data.material || !confirmed || !comment.trim()} onClick={() => void mutate('APPROVED')}>검토 승인 저장</button>
          <button className={`${styles.secondaryButton} min-h-11 !text-sm`} disabled={locked || fixtureDirty || hasDrafts || !data.material || !confirmed || !comment.trim()} onClick={() => void mutate('CHANGES_REQUESTED')}>수정 필요 저장</button>
        </div>
        <div className="grid gap-3 border-t border-line pt-4">
          <EvaluationHelp label="비교 기준" title={<h4 className="font-semibold">다음 평가와 비교할 때 사용하기</h4>}><p>이 결과를 같은 자료로 진행하는 다음 평가의 비교 기준으로 사용해요. 이미 접수한 평가는 바뀌지 않아요. 이 실행에 새 검토를 저장하면 기준 지정이 해제됩니다.</p></EvaluationHelp>
          <p className="text-sm text-ink-muted">새 기준을 지정하면 기존 기준이 바뀌어요.</p>
          <div className="flex flex-wrap items-center gap-3">
            <button className={`${styles.secondaryButton} min-h-11 !text-sm`} disabled={locked || fixtureDirty || hasDrafts || !data.material || data.is_baseline || !data.approval_current || !data.can_promote} onClick={() => void mutate()}>비교 기준으로 지정</button>
            {data.is_baseline && <button className={`${styles.secondaryButton} min-h-11 !text-sm`} disabled={locked || fixtureDirty || !comment.trim()} onClick={() => void mutate('CLEAR')}>의견을 사유로 기준 해제</button>}
          </div>
        </div>
        </div>
      </details>}
      {!!data.baseline_history.length && <details><summary className="cursor-pointer text-sm font-semibold">비교 기준 변경 이력 · {data.baseline_history.length}건</summary><ol className="mt-3 grid gap-3">{data.baseline_history.map((item) => <li key={item.version} className="rounded-xl bg-slate-50 p-3 text-sm"><p className="font-semibold">버전 {item.version} · {item.run_id ? item.previous_run_id ? '교체' : '지정' : '해제'} · {item.changed_by} · {new Date(item.created_at).toLocaleString('ko-KR')}</p><p className="break-all">{item.previous_run_id ?? '기준 없음'} → {item.run_id ?? '기준 없음'}</p><p className="mt-2 whitespace-pre-wrap">{item.reason}</p></li>)}</ol></details>}
      {!!data.reviews.length && <details><summary className="cursor-pointer text-sm font-semibold">검토 이력 · {data.reviews.length}건</summary><ol className="mt-3 grid gap-3">{data.reviews.map((review) => <li key={review.id} className="rounded-xl bg-slate-50 p-3 text-sm"><p className="font-semibold">{review.decision === 'APPROVED' ? '검토 승인' : '수정 필요'} · {review.reviewed_by} · {new Date(review.created_at).toLocaleString('ko-KR')}</p><p className="mt-2 whitespace-pre-wrap">{review.comment}</p></li>)}</ol></details>}
    </>}
  </section>
}
