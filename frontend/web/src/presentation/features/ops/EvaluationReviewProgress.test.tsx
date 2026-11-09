// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { EvaluationReview } from '../../../data/ops/opsApi'
import { EvaluationReviewProgress } from './EvaluationReviewProgress'

afterEach(cleanup)
function state(): EvaluationReview {
  return {
    material: { fixture_sha256: 'fixture', capture_sha256: 'capture', cases: [{ case_id: 'E01', question: '대상?', document_title: '가상 공고', evidence: [], answer: '법인', answer_status: 'ANSWERED', cited_orders: [], reference_answer: '법인', expected_status: 'ANSWERED', expected_citation_orders: [], reference_facts: [], forbidden_claims: [] }] },
    material_error: '', is_baseline: false, baseline_requires_review: false, baseline_version: 0, baseline_history: [],
    review_version: 0, can_approve: false, approval_current: false, can_promote: false, case_reviews: [], reviews: [],
    rubric: { version: 'answer-v1', criteria: [] },
    quality: { status: 'NOT_EVALUATED', is_current: false, current_id: null, input_sha256: 'input', blocked_reason: '', policy: null,
      fixture_version: 0, fixture_rubric_version: 'fixture-v1', fixture_reviews: [], history: [] },
  }
}
function approvedFixture(data: EvaluationReview) {
  data.quality!.fixture_reviews = [{ id: 1, version: 1, decision: 'APPROVED', comment: '자료 확인', fixture_sha256: 'fixture', case_ids: ['E01'], rubric_version: 'fixture-v1', reviewed_by: 'admin', created_at: '2026-10-03T00:00:00Z' }]
  return data
}
function suitableCases(data: EvaluationReview) {
  data.can_approve = true
  data.case_reviews = [{ id: 1, version: 1, case_id: 'E01', decision: 'SUITABLE', comment: '답변 확인', capture_sha256: 'capture', fixture_sha256: 'fixture', rubric_version: 'answer-v1', reviewed_by: 'admin', created_at: '2026-10-03T00:00:00Z' }]
  return data
}
function status(label: string) {
  const details = screen.getByText('전체 검토 상태 보기').closest('details')!
  return within(details).getByText(label).nextElementSibling?.textContent
}
function show(data: EvaluationReview, hasDrafts = false, disabled = false) {
  const navigate = vi.fn()
  render(<EvaluationReviewProgress data={data} hasDrafts={hasDrafts} disabled={disabled} onNavigate={navigate} />)
  return navigate
}

it('처음에는 다음 할 일만 보이고 전체 진행 상황은 필요할 때 펼친다', () => {
  show(state())
  expect(screen.getByRole('heading', { name: '먼저 평가 기준을 확인해 주세요' })).toBeTruthy()
  expect(screen.queryByRole('progressbar')).toBeNull()
  expect(screen.queryByText(/단계 완료/)).toBeNull()
  const details = screen.getByText('전체 검토 상태 보기').closest('details')!
  expect(details.open).toBe(false)
  fireEvent.click(screen.getByText('전체 검토 상태 보기'))
  expect(details.open).toBe(true)
  expect(status('비교 기준 (선택)')).toBe('지정 전')
})

it('미검토 상태의 다음 위치만 안내하며 이동 전에는 아무 동작도 하지 않는다', () => {
  const navigate = show(state())
  expect(status('문제없는 답변')).toBe('0 / 1개')
  expect(within(screen.getByText('전체 검토 상태 보기').closest('details')!).getAllByText('확인 전')[0]).toBeTruthy()
  expect(navigate).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: '평가 기준 확인하기' })).toBeNull()
})

it.each(['fixture_sha256', 'rubric_version', 'case_ids'] as const)('기준 자료 승인의 %s가 현재 자료와 다르면 재검토를 안내한다', (field) => {
  const data = approvedFixture(state())
  if (field === 'case_ids') data.quality!.fixture_reviews[0].case_ids = ['E02']
  else data.quality!.fixture_reviews[0][field] = 'old'
  show(data)
  expect(status('평가 기준')).toBe('다시 확인 필요')
  expect(screen.queryByRole('button', { name: '평가 기준 확인하기' })).toBeNull()
})

it.each(['CHANGES_REQUESTED', 'DEFERRED'] as const)('기준 자료 %s는 승인으로 표시하지 않는다', (decision) => {
  const data = approvedFixture(state())
  data.quality!.fixture_reviews[0].decision = decision
  show(data)
  expect(status('평가 기준')).toBe(decision === 'DEFERRED' ? '판단 보류' : '수정 필요')
  expect(screen.queryByRole('button', { name: '평가 기준 확인하기' })).toBeNull()
})

it.each(['capture_sha256', 'fixture_sha256', 'rubric_version'] as const)('사례 적합의 %s가 바뀌면 과거 적합 기록을 합산하지 않는다', (field) => {
  const data = suitableCases(approvedFixture(state()))
  data.case_reviews[0][field] = 'old'
  show(data)
  expect(status('현재 자료로 검토한 질문')).toBe('0 / 1개')
  expect(status('문제없는 답변')).toBe('0 / 1개')
  expect(within(screen.getByText('전체 검토 상태 보기').closest('details')!).getByText('다시 확인 필요')).toBeTruthy()
  expect(screen.getByRole('button', { name: '답변 확인하기' })).toBeTruthy()
  expect(screen.getAllByText('대상?').length).toBeGreaterThan(0)
})

it.each(['UNSUITABLE', 'DEFERRED'] as const)('새 %s 판단 뒤에 남은 과거 적합 기록으로 진행하지 않는다', (decision) => {
  const data = suitableCases(approvedFixture(state()))
  data.case_reviews.unshift({ ...data.case_reviews[0], id: 2, version: 2, decision })
  show(data)
  expect(status('문제없는 답변')).toBe('0 / 1개')
  expect(screen.getByRole('button', { name: '답변 확인하기' })).toBeTruthy()
})

it('보류한 답변은 상태와 실제 질문을 보여 주고 해당 질문으로 이동한다', () => {
  const data = suitableCases(approvedFixture(state()))
  data.case_reviews[0].decision = 'DEFERRED'
  const navigate = show(data)
  expect(screen.getByRole('heading', { name: '답변을 다시 확인해 주세요' })).toBeTruthy()
  expect(screen.getByText(/이전에 저장한 상태: 판단 보류/)).toBeTruthy()
  expect(screen.getAllByText('대상?').length).toBeGreaterThan(0)
  fireEvent.click(screen.getByRole('button', { name: '답변 확인하기' }))
  expect(navigate).toHaveBeenCalledExactlyOnceWith('case-review-E01')
})

it('비교 기준으로 지정할 수 없으면 선택 버튼을 제시하지 않는다', () => {
  const data = suitableCases(approvedFixture(state()))
  data.approval_current = true; data.quality!.status = 'PASS'; data.quality!.is_current = true
  show(data)
  expect(screen.getByRole('heading', { name: '검토가 끝났어요' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: '비교 기준 설정 확인하기' })).toBeNull()
})

it('자료·사례 검토 후 전체 승인, 유효한 품질 판정, 기준 지정을 순서대로 안내한다', () => {
  const data = suitableCases(approvedFixture(state()))
  const navigate = vi.fn()
  const view = render(<EvaluationReviewProgress data={data} hasDrafts={false} disabled={false} onNavigate={navigate} />)
  expect(screen.getByRole('button', { name: '전체 검토 확인하기' })).toBeTruthy()
  data.approval_current = true
  view.rerender(<EvaluationReviewProgress data={data} hasDrafts={false} disabled={false} onNavigate={navigate} />)
  expect(screen.getByRole('button', { name: '최종 결과 확인하기' })).toBeTruthy()
  data.quality!.status = 'PASS'; data.quality!.is_current = true; data.can_promote = true
  view.rerender(<EvaluationReviewProgress data={data} hasDrafts={false} disabled={false} onNavigate={navigate} />)
  expect(screen.getByRole('heading', { name: '검토가 끝났어요' })).toBeTruthy()
  expect(screen.getByText(/선택 사항이에요/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '비교 기준 설정 확인하기' }))
  expect(navigate).toHaveBeenCalledExactlyOnceWith('overall-review')
  data.is_baseline = true
  view.rerender(<EvaluationReviewProgress data={data} hasDrafts={false} disabled={false} onNavigate={navigate} />)
  expect(status('비교 기준 (선택)')).toBe('지정됨')
  expect(screen.queryByRole('button')).toBeNull()
})

it('기존 비교 기준의 상태를 확인해야 할 때 이미 지정된 기준을 새로 정하라고 하지 않는다', () => {
  const data = suitableCases(approvedFixture(state()))
  data.approval_current = true; data.quality!.status = 'PASS'; data.quality!.is_current = true
  data.is_baseline = true; data.baseline_requires_review = true; data.can_promote = true
  const navigate = show(data)
  expect(screen.queryByRole('button', { name: '비교 기준 설정 확인하기' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '비교 기준 상태 확인하기' }))
  expect(navigate).toHaveBeenCalledExactlyOnceWith('overall-review')
})

it('기존 기준에 과거 합격이 있어도 최신 판정이 아니면 완료로 표시하지 않는다', () => {
  const data = suitableCases(approvedFixture(state()))
  data.is_baseline = true; data.baseline_requires_review = true; data.approval_current = true
  data.quality!.status = 'PASS'; data.quality!.is_current = false
  show(data)
  expect(status('비교 기준 (선택)')).not.toBe('지정됨')
  expect(screen.getByRole('button', { name: '최종 결과 확인하기' })).toBeTruthy()
})

it('현재 불합격은 기준 지정 대신 판정 사유 확인으로 안내한다', () => {
  const data = suitableCases(approvedFixture(state()))
  data.approval_current = true; data.quality!.status = 'FAIL'; data.quality!.is_current = true
  show(data)
  expect(status('최종 결과')).toBe('불합격')
  expect(screen.getByRole('button', { name: '최종 결과 확인하기' })).toBeTruthy()
})

it('작성한 답변 검토은 완료로 계산하거나 다음 단계를 안내하지 않는다', () => {
  show(approvedFixture(state()), true)
  expect(status('문제없는 답변')).toBe('0 / 1개')
  expect(screen.getByRole('heading', { name: '작성 중인 답변을 저장해 주세요' })).toBeTruthy()
  expect(screen.queryByRole('button')).toBeNull()
})

it('저장된 검토와 문제없는 답변을 구분하고 보류와 이전 기록도 표시한다', () => {
  const data = suitableCases(approvedFixture(state()))
  const initial = data.material!.cases[0]
  data.material!.cases.push(
    { ...initial, case_id: 'E02', question: '두 번째 질문' },
    { ...initial, case_id: 'E03', question: '세 번째 질문' },
    { ...initial, case_id: 'E04', question: '네 번째 질문' },
    { ...initial, case_id: 'E05', question: '다섯 번째 질문' },
  )
  const original = data.case_reviews[0]
  data.case_reviews.push(
    { ...original, id: 2, case_id: 'E02', decision: 'UNSUITABLE' },
    { ...original, id: 3, case_id: 'E03', decision: 'DEFERRED' },
    { ...original, id: 4, case_id: 'E04', capture_sha256: 'old' },
  )
  show(data)
  expect(status('현재 자료로 검토한 질문')).toBe('3 / 5개')
  expect(status('문제없는 답변')).toBe('1 / 5개')
  const details = screen.getByText('전체 검토 상태 보기').closest('details')!
  const item = (question: string) => within(details).getByText(question).closest('li')!
  expect(item('두 번째 질문').textContent).toContain('문제 있음')
  expect(item('세 번째 질문').textContent).toContain('판단 보류')
  expect(item('네 번째 질문').textContent).toContain('다시 확인 필요')
  expect(item('다섯 번째 질문').textContent).toContain('확인 전')
})

it('이전 전체 검토의 수정 요청을 현재 판정이 아닌 저장된 기록으로 표시한다', () => {
  const data = suitableCases(approvedFixture(state()))
  data.reviews = [{ id: 1, decision: 'CHANGES_REQUESTED', comment: '이전 기록', capture_sha256: 'old', fixture_sha256: 'old', rubric_version: 'old', version: 1, case_review_ids: [], reviewed_by: 'admin', created_at: '2026-10-03T00:00:00Z' }]
  show(data)
  expect(status('전체 검토')).toBe('저장된 기록: 수정 필요')
  expect(screen.getByRole('button', { name: '전체 검토 확인하기' })).toBeTruthy()
})

it('이전 승인은 현재 승인으로 표시하지 않는다', () => {
  const data = suitableCases(approvedFixture(state()))
  data.reviews = [{ id: 1, decision: 'APPROVED', comment: '이전 기록', capture_sha256: 'old', fixture_sha256: 'old', rubric_version: 'old', version: 1, case_review_ids: [], reviewed_by: 'admin', created_at: '2026-10-03T00:00:00Z' }]
  show(data)
  expect(status('전체 검토')).toBe('다시 확인 필요')
})

it.each([
  ['PASS', true, '합격'], ['FAIL', true, '불합격'], ['NEEDS_REVIEW', true, '확인 필요'],
  ['NOT_EVALUATED', true, '확인 전'], ['PASS', false, '확인 전'],
] as const)('최종 결과 %s의 최신 여부 %s를 %s로 표시한다', (value, current, expected) => {
  const data = suitableCases(approvedFixture(state()))
  data.quality!.status = value; data.quality!.is_current = current
  show(data)
  expect(status('최종 결과')).toBe(expected)
})

it('상태 접기를 키보드로 포커스하고 다시 그려져도 열린 상태를 보존한다', () => {
  const data = approvedFixture(state())
  const navigate = vi.fn()
  const view = render(<EvaluationReviewProgress data={data} hasDrafts={false} disabled={false} onNavigate={navigate} />)
  const summary = screen.getByText('전체 검토 상태 보기').closest('summary')!
  const details = summary.closest('details')!
  expect(details.open).toBe(false)
  summary.focus()
  expect(document.activeElement).toBe(summary)
  fireEvent.click(summary)
  expect(details.open).toBe(true)
  view.rerender(<EvaluationReviewProgress data={data} hasDrafts={false} disabled={false} onNavigate={navigate} />)
  expect(details.open).toBe(true)
  fireEvent.click(summary)
  expect(details.open).toBe(false)
  expect(navigate).not.toHaveBeenCalled()
})

it.each(['material', 'quality', 'input', 'empty', 'disabled'])('%s를 확인할 수 없으면 진행 완료를 추정하지 않는다', (missing) => {
  const data = suitableCases(approvedFixture(state()))
  if (missing === 'material') data.material = null
  if (missing === 'quality') data.quality = null
  if (missing === 'input') data.quality!.input_sha256 = null
  if (missing === 'empty') data.material!.cases = []
  show(data, false, missing === 'disabled')
  if (missing === 'disabled') expect(screen.queryByRole('region', { name: '검토 진행 안내' })).toBeNull()
  else expect(screen.getByText('검토 상태를 확인할 수 없어요')).toBeTruthy()
  expect(screen.queryByRole('button')).toBeNull()
})
