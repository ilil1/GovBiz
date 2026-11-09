import { useEffect, useRef, useState } from 'react'
import { getRagReviews, OpsApiError, type RagMaterial, type RagReviewState } from '../../../data/ops/opsApi'
import { workspacePageStyles as styles, workspaceTagClassName } from '../../shared/workspace/WorkspacePage.styles'
import { RagCaseReviewForm } from './RagCaseReviewForm'
import { RagQualityPanel } from './RagQualityPanel'
import { RagReferenceReviewPanel } from './RagReferenceReviewPanel'
import { EvaluationHelp } from './EvaluationHelp'

const origins = {
  'synthetic-contract-check': '연습용 자료로 확인 · 실제 모델 성능 아님',
  'integration-stub-replay': '테스트용 답변으로 확인',
  'recorded-live-evaluation': '새로 만든 답변으로 확인',
  'recorded-capture-replay': '저장된 답변으로 확인',
}
const stages = { not_started: '시작 전', source: '공고 확인', chunk: '공고 준비', index: '자료 준비', search: '내용 찾기', answer: '답변 작성' }
const statuses = { ANSWERED: '답변 있음', INSUFFICIENT_EVIDENCE: '근거 부족' }
type Case = RagMaterial['cases'][number]
type Props = { runId: string; onExpired: () => void; onReviewChanged?: () => void }

function Observation({ label, value, item }: { label: string; value: Case['candidate']; item: Case }) {
  const chunkLabel = (id: string) => {
    const chunk = item.chunks.find((chunk) => chunk.id === id)
    return chunk ? `근거 ${chunk.order + 1}` : id
  }
  return <article className="min-w-0 rounded-xl border border-line p-4" aria-label={`${label} 답변과 근거`}>
    <h3 className="font-semibold">{label === '후보' ? '이번 답변' : '비교할 답변'}</h3>
    <p className="text-sm">{value.failure?.stage === 'not_started' ? '아직 시작하지 않았어요.' : value.failure ? `${stages[value.failure.stage]} 중 문제가 생겼어요.` : value.answer === null ? '저장된 답변이 없어요.' : '답변을 만들었어요.'}</p>
    <p className="text-sm">답변 상태: {value.answer_status ? statuses[value.answer_status] : '미실행 또는 미확인'}</p>
    <p className="my-3 whitespace-pre-wrap break-words">{value.answer ?? '저장된 답변 없음'}</p>
    <details className="text-sm"><summary className="cursor-pointer font-semibold">찾은 근거와 실행 기록</summary>
      {([
        ['검색 순서', value.retrieved_chunk_ids], ['답변 입력 순서', value.context_chunk_ids], ['인용 근거', value.cited_chunk_ids],
      ] as const).map(([title, ids]) => <p key={title} className="break-words"><strong>{title}:</strong> {ids === null ? '미실행 또는 미확인' : ids.length ? ids.map(chunkLabel).join(' → ') : '없음'}</p>)}
      {value.failure && <p className="mt-2 break-all text-xs">오류 코드: {value.failure.code}</p>}<p className="mt-2 break-all text-xs">작업 기록 번호: {value.trace_id ?? '없음'}</p>
    </details>
  </article>
}

function Material({ runId, onExpired, onReviewChanged }: Props) {
  const [state, setState] = useState<RagReviewState | null>(null)
  const [locked, setLocked] = useState(false)
  const [qualityBusy, setQualityBusy] = useState(false)
  const [referenceDirty, setReferenceDirty] = useState(false)
  const [referenceBusy, setReferenceBusy] = useState(false)
  const [referenceOpen, setReferenceOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  const material = state?.material
  const [selected, setSelected] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  const read = async () => {
    controller.current?.abort()
    const request = new AbortController()
    controller.current = request
    setBusy(true); setError(''); setState(null); setSaved(false); setLocked(false)
    try {
      const value = await getRagReviews(runId, request.signal)
      if (!request.signal.aborted) { setState(value); setSelected(0); setReferenceOpen(!value.reference_review.approved) }
    } catch (cause) {
      if (request.signal.aborted) return
      if (cause instanceof OpsApiError && [401, 403].includes(cause.status)) { onExpired(); return }
      setError(cause instanceof Error ? cause.message : '검토 자료를 불러올 수 없습니다.')
    } finally {
      if (!request.signal.aborted) setBusy(false)
    }
  }
  const item = material?.cases[selected]
  const currentReview = (caseId: string) => state?.case_reviews.find((row) => row.case_id === caseId && row.is_current
    && row.material_sha256 === material?.material_sha256 && row.rubric_version === state.rubric.version)
  const reviewedCount = material?.cases.filter((item) => currentReview(item.case_id)).length ?? 0
  const reference = state?.reference_review
  const currentReference = reference?.history.find((row) => !!material && row.id === reference.current_id && row.is_current
    && row.fixture_sha256 === material.fixture_sha256 && reference.fixture_sha256 === material.fixture_sha256
    && row.rubric_version === reference.rubric.version && row.case_ids.length === material.cases.length
    && row.case_ids.every((id, index) => id === material.cases[index].case_id)
    && reference.case_ids.length === material.cases.length && reference.case_ids.every((id, index) => id === material.cases[index].case_id))
  const referenceStatus = reference?.approved ? '확인 완료' : currentReference?.decision === 'DEFERRED' ? '판단 보류'
    : currentReference?.decision === 'CHANGES_REQUESTED' ? '수정 필요' : reference?.history.length ? '확인 필요' : '확인 전'
  const qualityStatus = !state ? '확인 전' : state.quality.is_current ? { NOT_EVALUATED: '확인 전', NEEDS_REVIEW: '확인 필요', FAIL: '불합격', PASS: '합격' }[state.quality.status] : state.quality.history.length || state.quality.status !== 'NOT_EVALUATED' ? '다시 확인 필요' : '확인 전'
  const suitableCount = material?.cases.filter((item) => {
    const review = currentReview(item.case_id)
    return review?.retrieval_decision === 'SUITABLE' && review.answer_decision === 'SUITABLE' && review.citation_decision === 'SUITABLE'
  }).length ?? 0
  const nextTask = !state || !material ? null
    : qualityBusy || referenceBusy ? { title: '확인 내용을 저장하고 있어요', description: '잠시만 기다려 주세요.', target: null, action: '' }
    : locked ? { title: '작성 중인 답변 검토를 마쳐 주세요', description: '작성한 내용을 저장하거나 입력을 취소해 주세요.', target: 'rag-case-review', action: '작성 중인 질문 보기' }
    : referenceDirty ? { title: '작성 중인 평가 기준 확인을 마쳐 주세요', description: '기준 확인을 마친 뒤 저장해 주세요.', target: 'rag-reference-review', action: '작성 중인 기준 확인 보기' }
    : !state.reference_review.approved ? { title: '공고와 평가 기준이 맞는지 확인해 주세요', description: '질문마다 공고 내용과 기준을 살펴본 뒤 확인 결과를 저장해 주세요.', target: 'rag-reference-review', action: '평가 기준 확인' }
    : reviewedCount < material.cases.length ? { title: '확인하지 않은 질문이 있어요', description: '공고 내용과 답변을 비교하고 각 질문의 검토 결과를 저장해 주세요.', target: 'rag-case-review', action: '확인할 질문 보기' }
    : suitableCount < material.cases.length ? { title: '다시 확인할 답변이 있어요', description: '최종 결과에서 확인이 필요한 내용을 살펴보세요.', target: 'rag-quality-review', action: '최종 결과 확인' }
    : !state.quality.is_current ? { title: '최종 결과를 확인해 주세요', description: '저장된 검토로 최종 결과를 확인해 주세요.', target: 'rag-quality-review', action: '최종 결과 확인' }
    : state.quality.status === 'FAIL' ? { title: '최종 결과에서 확인할 내용이 있어요', description: '결과와 이유를 확인하고 필요한 내용을 다시 검토해 주세요.', target: 'rag-quality-review', action: '최종 결과 확인' }
    : state.quality.status === 'PASS' ? { title: '답변 검토를 마쳤어요', description: state.baseline.selected ? '이 결과는 다음 평가의 비교 기준으로 지정되어 있어요.' : '비교 기준 지정은 선택 사항이에요.', target: null, action: '' }
    : { title: '최종 결과를 확인해 주세요', description: '결과와 확인이 필요한 내용을 살펴보세요.', target: 'rag-quality-review', action: '최종 결과 확인' }
  const selectCase = (index: number) => { setSelected(index); setSaved(false) }
  const openSection = (id: string) => {
    const section = document.getElementById(id)
    if (section instanceof HTMLDetailsElement) {
      section.open = true
      section.querySelector('summary')?.focus()
      section.scrollIntoView?.({ block: 'start' })
    }
  }

  return <section className={styles.card} aria-label="RAG 사례 검토 자료" aria-busy={busy}>
    <EvaluationHelp label="답변과 근거 검토" title={<h2 className={styles.cardTitle}>답변 확인</h2>}><p>질문마다 공고 내용과 답변을 비교해요. 자료를 열어도 AI를 다시 호출하지 않아요.</p></EvaluationHelp>
    <button type="button" className={`${material ? styles.secondaryButton : styles.primaryButton} min-h-11 !text-sm justify-center self-start`} disabled={busy || locked || qualityBusy || referenceDirty || referenceBusy} onClick={() => void read()}>{busy ? '불러오는 중…' : material ? '검토 자료 새로고침' : '검토 자료 보기'}</button>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {state && material && item && <div className="space-y-4">
      <section aria-label="RAG 검토 진행 안내" className="grid gap-3 rounded-xl border border-brand-primary/20 bg-[#f3f7f5] p-5 text-sm">
        {nextTask && <>
          <h3 className="text-base font-bold">{nextTask.title}</h3>
          <p>{nextTask.description}</p>
          <nav aria-label="RAG 검토 위치" className="grid justify-items-start gap-3">
            {nextTask.target && nextTask.target !== 'rag-reference-review' && <a href={`#${nextTask.target}`} onClick={() => {
              if (nextTask.target === 'rag-case-review' && !locked && !qualityBusy && !referenceBusy) {
                const nextIndex = material.cases.findIndex((value) => !currentReview(value.case_id))
                if (nextIndex >= 0) selectCase(nextIndex)
              }
              if (nextTask.target) openSection(nextTask.target)
            }} className={`${styles.primaryButton} min-h-11 !text-sm justify-center`}>{nextTask.action}</a>}
            <details><summary className="cursor-pointer font-semibold">다른 검토 항목 보기</summary><div className="mt-3 flex flex-wrap gap-3">
              {nextTask.target !== 'rag-case-review' && <a href="#rag-case-review" className={`${styles.secondaryButton} min-h-11 !text-sm justify-center`}>질문 확인</a>}
              {nextTask.target !== 'rag-reference-review' && <a href="#rag-reference-review" onClick={() => openSection('rag-reference-review')} className={`${styles.secondaryButton} min-h-11 !text-sm justify-center`}>평가 기준 확인</a>}
              {nextTask.target !== 'rag-quality-review' && <a href="#rag-quality-review" onClick={() => openSection('rag-quality-review')} className={`${styles.secondaryButton} min-h-11 !text-sm justify-center`}>최종 결과 확인</a>}
            </div></details>
          </nav>
        </>}
        <details className="group rounded-xl border border-line bg-white">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary [&::-webkit-details-marker]:hidden"><span>전체 검토 상태 보기</span><span aria-hidden="true" className="shrink-0 text-xs text-brand-primary"><span className="group-open:hidden">펼치기 +</span><span className="hidden group-open:inline">접기 −</span></span></summary>
          <dl className="mx-4 mb-2 divide-y divide-line border-t border-line">{([
            ['평가 기준', referenceStatus],
            ['현재 자료로 검토한 질문', `${reviewedCount} / ${material.cases.length}개`],
            ['검색·답변·근거가 모두 문제없는 질문', `${suitableCount} / ${material.cases.length}개`],
            ['최종 결과', qualityStatus],
            ['비교 기준 (선택)', state.baseline.selected ? '지정됨' : '지정 전'],
          ] as [string, string][]).map(([label, value]) => <div key={label} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 py-3"><dt className="text-ink-muted [overflow-wrap:anywhere]">{label}</dt><dd className="min-w-0 text-right font-semibold whitespace-nowrap">{value}</dd></div>)}</dl>
        </details>
      </section>
      <details id="rag-reference-review" open={referenceOpen} onToggle={(event) => setReferenceOpen(event.currentTarget.open)} className="group scroll-mt-28 rounded-xl border border-line bg-white">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 flex-wrap items-center gap-2"><span>평가 기준 확인</span><span className={workspaceTagClassName(referenceStatus === '확인 완료' ? 'ok' : referenceStatus === '수정 필요' ? 'danger' : 'info')}>{referenceStatus}</span></span>
          <span aria-hidden="true" className="shrink-0 text-xs text-brand-primary"><span className="group-open:hidden">펼치기 +</span><span className="hidden group-open:inline">접기 −</span></span>
        </summary>
        <div className="border-t border-line p-3"><RagReferenceReviewPanel key={`${runId}:${state.review_version}:${material.fixture_sha256}`} runId={runId} state={state} disabled={locked || qualityBusy} onDirty={setReferenceDirty} onBusy={setReferenceBusy} onSaved={(value) => { setState(value); setReferenceDirty(false); setReferenceBusy(false); setSaved(false); onReviewChanged?.() }} onExpired={onExpired} /></div>
      </details>
      <details className="text-sm text-ink-muted"><summary className="cursor-pointer font-semibold">이 평가의 자료와 범위</summary>
        {material.data_type === 'official-html-snapshot' && <p>실제 공고의 저장된 HTML 본문입니다. 첨부파일은 포함하지 않습니다. 공고를 문단별로 나누어 사용했습니다. 다른 답변의 검토 승인은 여기에 적용되지 않습니다.</p>}
        <p>이번 답변: {origins[material.candidate_measurement_kind]} · 비교 답변: {origins[material.reference_measurement_kind]}</p>
      </details>
      <section id="rag-case-review" aria-label="현재 질문" className="scroll-mt-28 space-y-3 rounded-xl border border-line p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">지금 확인할 질문</h3><span className="text-sm text-ink-muted" aria-live="polite">{locked ? '작성 중' : currentReview(item.case_id) ? '검토 저장됨' : '아직 검토하지 않음'}</span></div>
        {material.cases.length > 1 && <>
          <label className="block text-sm font-semibold">확인할 질문
            <select className="mt-1 min-h-11 w-full rounded-lg border border-line p-2" value={selected} disabled={locked || qualityBusy || referenceBusy} onChange={(event) => selectCase(Number(event.target.value))}>
              {material.cases.map((value, index) => <option key={value.case_id} value={index}>{value.case_id} · {currentReview(value.case_id) ? '검토 저장됨' : '미검토'} · {value.question}</option>)}
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={`${styles.secondaryButton} min-h-11 !text-sm justify-center`} disabled={locked || qualityBusy || referenceBusy || selected === 0} onClick={() => selectCase(selected - 1)}>이전 질문</button>
            <span className="text-sm tabular-nums">{selected + 1} / {material.cases.length}번째 질문</span>
            <button type="button" className={`${styles.secondaryButton} min-h-11 !text-sm justify-center`} disabled={locked || qualityBusy || referenceBusy || selected === material.cases.length - 1} onClick={() => selectCase(selected + 1)}>다음 질문</button>
          </div>
          {locked && <p className="text-sm text-ink-muted" role="status">작성한 검토를 저장하거나 입력 취소한 뒤 다른 질문을 선택해 주세요.</p>}
        </>}
        <p className="font-semibold whitespace-pre-wrap [overflow-wrap:anywhere]">{item.question}</p>
      </section>
      <Observation label="후보" value={item.candidate} item={item} />
      <details><summary className="cursor-pointer font-semibold">비교할 답변 보기</summary><div className="mt-3"><Observation label="비교" value={item.reference} item={item} /></div></details>
      <details><summary className="cursor-pointer font-semibold">공고 원문 보기</summary>
        {item.source_collected_at && <p className="text-sm">공고를 가져온 시각: {item.source_collected_at}</p>}
        <p className="break-all text-xs">원본 주소: {item.source_url}</p>
        <p className="break-all text-xs">원문 SHA-256: {item.content_sha256}</p>
        <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words p-3 text-sm">{item.content}</pre>
      </details>
      <details><summary className="cursor-pointer font-semibold">공고에서 찾은 근거 보기</summary><p className="text-xs text-ink-muted">자료 버전: {item.chunk_version}</p>
        {item.chunks.map((chunk) => <details key={chunk.id} className="border-b border-line py-2">
          <summary className="cursor-pointer text-sm">근거 {chunk.order + 1} · {([
            ['이번 답변', item.candidate], ['비교 답변', item.reference],
          ] as const).map(([label, value]) => `${label}: ${value.retrieved_chunk_ids === null ? '찾았는지 확인 불가' : value.retrieved_chunk_ids.includes(chunk.id) ? '찾음' : '찾지 못함'} / ${value.cited_chunk_ids === null ? '사용 여부 확인 불가' : value.cited_chunk_ids.includes(chunk.id) ? '사용함' : '사용하지 않음'}`).join(' · ')}</summary>
          <p className="break-all text-xs">{chunk.id}</p><p className="whitespace-pre-wrap break-words text-sm">{chunk.text}</p>
        </details>)}
      </details>
      <details><summary className="cursor-pointer font-semibold">AI가 작성한 평가 기준</summary>
        <p className="text-sm">예상 상태: {statuses[item.expected_status]}</p>
        {item.expected_evidence.length ? item.expected_evidence.map((expected, index) => <blockquote key={index} className="my-2 border-l-2 pl-3 text-sm">
          <p className="break-all text-xs">공고 내용 번호: {expected.chunk_id}</p><p className="whitespace-pre-wrap">{expected.quote}</p>
        </blockquote>) : <p className="text-sm">정해진 근거가 없어요.</p>}
      </details>
      {saved && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-brand-primary">검토를 저장했어요. 최종 결과는 별도로 확인해 주세요.</p>}
      <RagCaseReviewForm key={`${item.case_id}:${state.review_version}:${material.material_sha256}`} runId={runId} item={item} state={state} disabled={qualityBusy || referenceDirty || referenceBusy} onExpired={onExpired} onLock={(value) => { setLocked(value); if (value) setSaved(false) }} onSaved={(value) => { setState(value); setSaved(true); onReviewChanged?.() }} />
      <details id="rag-quality-review" className="group scroll-mt-28 rounded-xl border border-line bg-white">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 flex-wrap items-center gap-2"><span>최종 결과</span><span className={workspaceTagClassName(state.quality.is_current && state.quality.status === 'PASS' ? 'ok' : state.quality.is_current && state.quality.status === 'FAIL' ? 'danger' : 'info')}>{qualityStatus}</span></span>
          <span aria-hidden="true" className="shrink-0 text-xs text-brand-primary"><span className="group-open:hidden">펼치기 +</span><span className="hidden group-open:inline">접기 −</span></span>
        </summary>
        <div className="border-t border-line p-3"><RagQualityPanel key={`${runId}:${state.quality.input_sha256}`} runId={runId} state={state} disabled={locked || busy || referenceDirty || referenceBusy} onBusy={setQualityBusy} onSaved={(value) => { setState(value); setQualityBusy(false); setSaved(false); onReviewChanged?.() }} onExpired={onExpired} /></div>
      </details>
      <details className="break-all text-xs"><summary className="cursor-pointer">관리자용 자료 정보</summary>
        <p>검토 자료: {material.material_sha256}</p><p>평가 자료: {material.fixture_sha256}</p>
        <p>후보 캡처: {material.candidate_capture_sha256}</p><p>비교 캡처: {material.reference_capture_sha256}</p>
      </details>
    </div>}
  </section>
}

export function RagMaterialPanel(props: Props) {
  return <Material key={props.runId} {...props} />
}
