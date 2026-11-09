import type { EvaluationReview } from '../../../data/ops/opsApi'
import { workspacePageStyles as styles } from '../../shared/workspace/WorkspacePage.styles'

// Navigation only. The existing API remains responsible for approval and promotion.
export function EvaluationReviewProgress({ data, hasDrafts, draftCaseId, disabled, onNavigate }: {
  data: EvaluationReview; hasDrafts: boolean; draftCaseId?: string; disabled: boolean; onNavigate: (target: string) => void
}) {
  const material = data.material
  const quality = data.quality
  if (disabled) return null
  if (!material?.cases.length || !quality || !quality.input_sha256) return <section aria-label="검토 진행 안내" className="rounded-xl bg-slate-50 p-4 text-sm">
    <h3 className="font-semibold">검토 상태를 확인할 수 없어요</h3>
    <p>검토 자료와 결과를 확인해 주세요.</p>
  </section>
  const fixture = quality.fixture_reviews[0]
  const fixtureCurrent = !!fixture && fixture.fixture_sha256 === material.fixture_sha256
    && fixture.rubric_version === quality.fixture_rubric_version
    && fixture.case_ids.length === material.cases.length
    && fixture.case_ids.every((id, index) => id === material.cases[index].case_id)
  const fixtureApproved = fixtureCurrent && fixture.decision === 'APPROVED'
  const cases = material.cases.map((item) => {
    const review = data.case_reviews.find((row) => row.case_id === item.case_id)
    const current = review?.capture_sha256 === material.capture_sha256
      && review?.fixture_sha256 === material.fixture_sha256 && review?.rubric_version === data.rubric.version
    return { id: item.case_id, question: item.question, reviewed: !!current, suitable: current && review.decision === 'SUITABLE',
      state: current ? { SUITABLE: '문제없음', UNSUITABLE: '문제 있음', DEFERRED: '판단 보류' }[review.decision] : review ? '다시 확인 필요' : '확인 전' }
  })
  const remaining = cases.filter((item) => !item.suitable)
  const qualityPassed = quality.is_current && quality.status === 'PASS'
  const baselineCurrent = data.is_baseline && !data.baseline_requires_review && data.can_promote
    && fixtureApproved && remaining.length === 0 && data.approval_current && qualityPassed
  const latestReview = data.reviews[0]
  const steps = [
    { label: '평가 기준', value: fixtureApproved ? '확인 완료' : fixtureCurrent ? fixture.decision === 'DEFERRED' ? '판단 보류' : '수정 필요' : fixture ? '다시 확인 필요' : '확인 전' },
    { label: '현재 자료로 검토한 질문', value: `${cases.filter((item) => item.reviewed).length} / ${cases.length}개` },
    { label: '문제없는 답변', value: `${cases.length - remaining.length} / ${cases.length}개` },
    { label: '전체 검토', value: data.approval_current ? '승인 완료' : latestReview?.decision === 'CHANGES_REQUESTED' ? '저장된 기록: 수정 필요' : latestReview?.decision === 'APPROVED' ? '다시 확인 필요' : '승인 전' },
    { label: '최종 결과', value: quality.is_current ? { PASS: '합격', FAIL: '불합격', NEEDS_REVIEW: '확인 필요', NOT_EVALUATED: '확인 전' }[quality.status] : quality.history.length ? '다시 확인 필요' : '확인 전' },
    { label: '비교 기준 (선택)', value: baselineCurrent ? '지정됨' : data.is_baseline ? '다시 확인 필요' : '지정 전' },
  ]
  const next = hasDrafts ? { title: '작성 중인 답변을 저장해 주세요', description: '작성한 내용을 확인하고 저장해 주세요.', target: draftCaseId ? `case-review-${draftCaseId}` : null, label: '작성 중인 답변으로 이동' }
    : !fixtureApproved ? { title: fixture ? '평가 기준을 다시 확인해 주세요' : '먼저 평가 기준을 확인해 주세요', description: '바로 아래에서 공고 내용과 평가 기준을 비교하고 저장해 주세요.', target: null, label: '' }
    : remaining.length ? { title: remaining[0].state === '확인 전' ? '확인할 답변이 남아 있어요' : '답변을 다시 확인해 주세요', description: remaining[0].state === '확인 전' ? '공고 내용과 답변을 비교한 뒤 결과를 저장해 주세요.' : `이전에 저장한 상태: ${remaining[0].state}. 공고 내용과 답변을 다시 확인해 주세요.`, question: remaining[0].question, target: `case-review-${remaining[0].id}`, label: '답변 확인하기' }
    : !data.approval_current ? { title: '전체 검토를 저장해 주세요', description: '확인한 답변을 바탕으로 전체 의견을 남겨 주세요.', target: 'overall-review', label: '전체 검토 확인하기' }
    : !qualityPassed ? { title: '최종 결과를 확인해 주세요', description: quality.is_current && quality.status === 'FAIL' ? '확인 결과와 이유를 살펴보고 필요한 내용을 다시 검토해 주세요.' : '저장한 검토를 바탕으로 최종 결과를 확인해 주세요.', target: 'quality-review', label: '최종 결과 확인하기' }
    : !data.is_baseline && data.can_promote ? { title: '검토가 끝났어요', description: '필요하면 이 결과를 다음 평가의 비교 기준으로 사용할 수 있어요. 선택 사항이에요.', target: 'overall-review', label: '비교 기준 설정 확인하기' }
    : data.is_baseline && !baselineCurrent ? { title: '검토가 끝났어요', description: '기존 비교 기준의 상태를 확인해 주세요.', target: 'overall-review', label: '비교 기준 상태 확인하기' }
    : { title: '검토가 끝났어요', description: baselineCurrent ? '이 결과는 다음 평가의 비교 기준으로 지정되어 있어요.' : '검토와 최종 결과를 확인했어요.', target: null, label: '' }
  return <section aria-label="검토 진행 안내" className="grid gap-3 rounded-xl border border-brand-primary/20 bg-[#f3f7f5] p-5 text-sm">
    <h3 className="text-base font-bold">{next.title}</h3>
    <p>{next.description}</p>
    {'question' in next && next.question && <p className="rounded-lg bg-white p-3 font-semibold [overflow-wrap:anywhere]">{next.question}</p>}
    {next.target && <button type="button" className={`${styles.primaryButton} min-h-11 !text-sm justify-self-start`} onClick={() => onNavigate(next.target!)}>{next.label}</button>}
    <details className="group min-w-0 rounded-xl border border-line bg-white">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary [&::-webkit-details-marker]:hidden">
        <span>전체 검토 상태 보기</span><span aria-hidden="true" className="shrink-0 text-xs text-brand-primary"><span className="group-open:hidden">펼치기 +</span><span className="hidden group-open:inline">접기 −</span></span>
      </summary>
      <div className="border-t border-line px-4 pb-4">
        <dl className="divide-y divide-line">{steps.map((step) => <div key={step.label} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 py-3"><dt className="text-ink-muted">{step.label}</dt><dd className="text-right font-semibold">{step.value}</dd></div>)}</dl>
        {remaining.length > 0 && <div className="mt-3"><p className="font-semibold">확인이 필요한 질문</p><ul className="mt-2 grid gap-2">{remaining.map((item) => <li key={item.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3"><span className="[overflow-wrap:anywhere]">{item.question}</span><span className="text-right text-ink-muted">{item.state}</span></li>)}</ul></div>}
      </div>
    </details>
  </section>
}
