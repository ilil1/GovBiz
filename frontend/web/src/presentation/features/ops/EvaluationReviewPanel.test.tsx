// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as opsApi from '../../../data/ops/opsApi'
import type { EvaluationReview } from '../../../data/ops/opsApi'
import { EvaluationReviewPanel } from './EvaluationReviewPanel'

const material = {
  capture_sha256: 'capture', fixture_sha256: 'fixture',
  cases: [{ case_id: 'E01', question: '지원 대상은?', document_title: '공고',
    evidence: [{ order: 0, text: '서울 기업' }], answer: '서울 기업입니다.', answer_status: 'ANSWERED', cited_orders: [0],
    reference_answer: '서울 기업', expected_status: 'ANSWERED', expected_citation_orders: [0], reference_facts: [], forbidden_claims: [] }],
}
const quality = { status: 'NOT_EVALUATED', is_current: false, current_id: null, input_sha256: 'input',
  policy: null, fixture_version: 0, fixture_rubric_version: 'v1', fixture_reviews: [], blocked_reason: '', history: [] }
const state = { quality, material, material_error: '', review_version: 0, can_approve: false,
  approval_current: false, baseline_requires_review: false, rubric: { version: 'v1', criteria: [] }, case_reviews: [],
  is_baseline: false, can_promote: false, baseline_version: 0, baseline_history: [], reviews: [] } as unknown as EvaluationReview

beforeEach(() => { Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() }) })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('평가 기준을 바로 보고 질문의 답변을 선택하면 해당 영역으로 이동한다', async () => {
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(state)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  await screen.findByRole('button', { name: '이 질문의 답변 보기' })
  expect(screen.queryByRole('button', { name: '평가 기준 확인하기' })).toBeNull()
  const panel = screen.getByText('질문과 답변 검토하기').closest('details')!
  expect(panel.open).toBe(false)
  const fixture = document.getElementById('fixture-review') as HTMLDetailsElement
  expect(panel.open).toBe(false)
  expect(panel.contains(fixture)).toBe(false)
  expect(fixture.open).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '이 질문의 답변 보기' }))
  await waitFor(() => expect(document.activeElement?.id).toBe('case-review-E01'))
  expect(panel.open).toBe(true)
})

it('평가 기준 양식에서 질문별 공고와 기준을 비교해도 작성 중인 판단은 보존된다', async () => {
  const value = structuredClone(state)
  const first = value.material!.cases[0]
  first.reference_facts = ['첫 질문의 확인할 사실']
  first.forbidden_claims = ['첫 질문의 주의할 주장']
  value.material!.cases.push({ ...first, case_id: 'E02', question: '신청 기간은?',
    evidence: [{ order: 0, text: '7월까지 신청' }], reference_facts: ['두 번째 질문의 확인할 사실'],
    forbidden_claims: ['두 번째 질문의 주의할 주장'] })
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  const save = vi.spyOn(opsApi, 'saveFixtureReview')
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  await screen.findByRole('button', { name: '이 질문의 답변 보기' })
  const fixture = document.getElementById('fixture-review')!
  const section = within(fixture).getByRole('region', { name: '기준을 확인할 자료' })
  expect(within(section).getByText('지원 대상은?')).toBeTruthy()
  expect(within(section).getByText('서울 기업')).toBeTruthy()
  expect(within(section).getByText(/첫 질문의 확인할 사실/)).toBeTruthy()
  expect(within(section).getByText(/첫 질문의 주의할 주장/)).toBeTruthy()
  const confirmed = within(fixture).getByRole('checkbox', { name: '모든 질문의 공고 내용과 평가 기준을 확인했어요.' })
  expect(confirmed).toHaveProperty('checked', false)
  fireEvent.change(within(fixture).getByLabelText('평가 기준이 맞나요?'), { target: { value: 'DEFERRED' } })
  fireEvent.change(within(fixture).getByLabelText('기준을 확인한 이유'), { target: { value: '검토 중인 의견' } })
  const select = within(fixture).getByLabelText('기준을 확인할 질문')
  const secondOption = within(select).getByRole('option', { name: /신청 기간은\?/ })
  fireEvent.change(select, { target: { value: (secondOption as HTMLOptionElement).value } })
  expect(within(section).getByText('신청 기간은?')).toBeTruthy()
  expect(within(section).getByText('7월까지 신청')).toBeTruthy()
  expect(within(section).getByText(/두 번째 질문의 확인할 사실/)).toBeTruthy()
  expect(within(section).getByText(/두 번째 질문의 주의할 주장/)).toBeTruthy()
  expect(within(section).queryByText('서울 기업')).toBeNull()
  expect(within(fixture).getByLabelText('평가 기준이 맞나요?')).toHaveProperty('value', 'DEFERRED')
  expect(within(fixture).getByLabelText('기준을 확인한 이유')).toHaveProperty('value', '검토 중인 의견')
  expect(confirmed).toHaveProperty('checked', false)
  expect(save).not.toHaveBeenCalled()
})

it('검토를 닫았다 다시 열어도 작성 중인 판단을 유지한다', async () => {
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(state)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  const summary = await screen.findByText('질문과 답변 검토하기')
  fireEvent.click(summary)
  fireEvent.change(screen.getByLabelText('E01 판단'), { target: { value: 'DEFERRED' } })
  fireEvent.change(screen.getByLabelText('E01 확인한 이유'), { target: { value: '내용 확인 중' } })
  fireEvent.click(summary)
  fireEvent.click(summary)
  expect(screen.getByLabelText('E01 판단')).toHaveProperty('value', 'DEFERRED')
  expect(screen.getByLabelText('E01 확인한 이유')).toHaveProperty('value', '내용 확인 중')
})

it('질문 검토와 전체 검토를 따로 열어도 작성한 내용을 보존한다', async () => {
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(state)
  const save = vi.spyOn(opsApi, 'saveEvaluationCaseReview')
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  const questionSummary = await screen.findByText('질문과 답변 검토하기')
  const questionPanel = questionSummary.closest('details')!
  const overallSummary = screen.getByText('전체 검토와 비교 기준')
  const overallPanel = overallSummary.closest('details')!
  expect(questionPanel.contains(overallPanel)).toBe(false)
  expect(questionPanel.open).toBe(false)
  expect(overallPanel.open).toBe(false)
  fireEvent.click(questionSummary)
  fireEvent.change(screen.getByLabelText('E01 판단'), { target: { value: 'DEFERRED' } })
  fireEvent.change(screen.getByLabelText('E01 확인한 이유'), { target: { value: '자료를 확인하는 중' } })
  fireEvent.click(questionSummary)
  fireEvent.click(overallSummary)
  expect(overallPanel.open).toBe(true)
  expect(questionPanel.open).toBe(false)
  fireEvent.change(screen.getByLabelText('검토 의견'), { target: { value: '전체 의견 초안' } })
  fireEvent.click(overallSummary)
  fireEvent.click(questionSummary)
  expect(screen.getByLabelText('E01 판단')).toHaveProperty('value', 'DEFERRED')
  expect(screen.getByLabelText('E01 확인한 이유')).toHaveProperty('value', '자료를 확인하는 중')
  fireEvent.click(overallSummary)
  expect(screen.getByLabelText('검토 의견')).toHaveProperty('value', '전체 의견 초안')
  expect(save).not.toHaveBeenCalled()
})

it('작성 중인 답변으로 이동하면 닫힌 검토를 열고 초안이 있는 질문으로 돌아간다', async () => {
  const value = structuredClone(state)
  value.material!.cases.push({ ...value.material!.cases[0], case_id: 'E02', question: '다른 질문은?' })
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  const save = vi.spyOn(opsApi, 'saveEvaluationCaseReview')
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  const summary = await screen.findByText('질문과 답변 검토하기')
  fireEvent.click(summary)
  fireEvent.change(screen.getByLabelText('E01 판단'), { target: { value: 'DEFERRED' } })
  fireEvent.change(screen.getByLabelText('E01 확인한 이유'), { target: { value: '검토 중인 내용' } })
  fireEvent.change(screen.getByLabelText('확인할 질문'), { target: { value: 'E02' } })
  expect(screen.getByLabelText('E02 판단')).toBeTruthy()
  fireEvent.click(summary)
  expect(summary.closest('details')).toHaveProperty('open', false)
  fireEvent.click(screen.getByRole('button', { name: '작성 중인 답변으로 이동' }))
  await waitFor(() => expect(document.activeElement?.id).toBe('case-review-E01'))
  expect(summary.closest('details')).toHaveProperty('open', true)
  expect(screen.getByLabelText('E01 판단')).toHaveProperty('value', 'DEFERRED')
  expect(screen.getByLabelText('E01 확인한 이유')).toHaveProperty('value', '검토 중인 내용')
  expect(save).not.toHaveBeenCalled()
})

function readyForOverall(approved = false): EvaluationReview {
  const value = structuredClone(state)
  value.can_approve = true
  value.approval_current = approved
  value.quality!.fixture_reviews = [{ id: 1, version: 1, decision: 'APPROVED', comment: '확인', fixture_sha256: 'fixture', case_ids: ['E01'], rubric_version: 'v1', reviewed_by: 'admin', created_at: '2026-10-03T00:00:00Z' }]
  value.case_reviews = [{ id: 1, version: 1, case_id: 'E01', decision: 'SUITABLE', comment: '확인', capture_sha256: 'capture', fixture_sha256: 'fixture', rubric_version: 'v1', reviewed_by: 'admin', created_at: '2026-10-03T00:00:00Z' }]
  return value
}

it.each(['미검토', '보류', '수정 필요', '이전 자료', '이전 기준', '이전 질문', '현재 승인'] as const)('평가 기준이 %s일 때 필요한 상태로 열려 있다', async (status) => {
  const value = readyForOverall()
  const fixture = value.quality!.fixture_reviews[0]
  if (status === '미검토') value.quality!.fixture_reviews = []
  if (status === '보류') fixture.decision = 'DEFERRED'
  if (status === '수정 필요') fixture.decision = 'CHANGES_REQUESTED'
  if (status === '이전 자료') fixture.fixture_sha256 = 'old'
  if (status === '이전 기준') fixture.rubric_version = 'old'
  if (status === '이전 질문') fixture.case_ids = ['E02']
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  const save = vi.spyOn(opsApi, 'saveFixtureReview')
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  await screen.findByText('질문과 답변 검토하기')
  const details = document.getElementById('fixture-review') as HTMLDetailsElement
  expect(details.open).toBe(status !== '현재 승인')
  expect(screen.queryByRole('button', { name: '평가 기준 확인하기' })).toBeNull()
  expect(save).not.toHaveBeenCalled()
})

it('기준과 최종 결과는 같은 형태로 열고 닫으며 작성 내용을 유지한다', async () => {
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(state)
  const save = vi.spyOn(opsApi, 'saveFixtureReview')
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  await screen.findByLabelText('평가 기준이 맞나요?')
  const fixture = document.getElementById('fixture-review') as HTMLDetailsElement
  const final = document.getElementById('quality-review') as HTMLDetailsElement
  const fixtureSummary = fixture.querySelector('summary')!
  const finalSummary = final.querySelector('summary')!
  expect(fixture.open).toBe(true)
  expect(final.open).toBe(false)
  for (const summary of [fixtureSummary, finalSummary]) {
    expect(summary.className).toContain('min-h-11')
    expect(summary.textContent).toContain('펼치기')
    expect(summary.textContent).toContain('접기')
    summary.focus()
    expect(document.activeElement).toBe(summary)
  }
  fireEvent.change(within(fixture).getByLabelText('평가 기준이 맞나요?'), { target: { value: 'DEFERRED' } })
  fireEvent.change(within(fixture).getByLabelText('기준을 확인한 이유'), { target: { value: '확인 중' } })
  fireEvent.click(fixtureSummary)
  expect(fixture.open).toBe(false)
  fireEvent.click(finalSummary)
  expect(final.open).toBe(true)
  fireEvent.click(finalSummary)
  expect(final.open).toBe(false)
  fireEvent.click(fixtureSummary)
  expect(fixture.open).toBe(true)
  expect(within(fixture).getByLabelText('평가 기준이 맞나요?')).toHaveProperty('value', 'DEFERRED')
  expect(within(fixture).getByLabelText('기준을 확인한 이유')).toHaveProperty('value', '확인 중')
  expect(within(fixture).getByRole('checkbox')).toHaveProperty('checked', false)
  expect(save).not.toHaveBeenCalled()
})

it('과거 기준 승인과 오래된 합격 결과는 다시 확인할 상태로 표시한다', async () => {
  const value = readyForOverall(true)
  value.quality!.fixture_reviews[0].fixture_sha256 = 'old'
  value.quality!.status = 'PASS'
  value.quality!.is_current = false
  value.quality!.current_id = 1
  value.quality!.history = [{ id: 1, status: 'PASS', policy: { definition: { version: 'v1' } }, policy_sha256: 'policy', input_sha256: 'old', assessed_by: 'admin', created_at: '2026-10-03T00:00:00Z', reasons: [] }]
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  await screen.findByText('질문과 답변 검토하기')
  const fixture = document.getElementById('fixture-review') as HTMLDetailsElement
  const final = document.getElementById('quality-review') as HTMLDetailsElement
  expect(fixture.open).toBe(true)
  expect(fixture.querySelector('summary')!.textContent).toContain('다시 확인 필요')
  expect(final.querySelector('summary')!.textContent).toContain('다시 확인 필요')
  expect(final.querySelector('summary')!.textContent).not.toContain('합격')
})

it('현재 기준 승인과 최종 합격은 각각의 상태로 표시한다', async () => {
  const value = readyForOverall(true)
  value.quality!.status = 'PASS'
  value.quality!.is_current = true
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  await screen.findByText('질문과 답변 검토하기')
  const fixture = document.getElementById('fixture-review') as HTMLDetailsElement
  const final = document.getElementById('quality-review') as HTMLDetailsElement
  expect(fixture.open).toBe(false)
  expect(fixture.querySelector('summary')!.textContent).toContain('확인 완료')
  expect(final.querySelector('summary')!.textContent).toContain('합격')
})

it.each(['DEFERRED', 'CHANGES_REQUESTED'] as const)('기준을 %s로 저장해도 승인된 것처럼 안내하지 않는다', async (decision) => {
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(state)
  const save = vi.spyOn(opsApi, 'saveFixtureReview').mockResolvedValue(structuredClone(state))
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  const select = await screen.findByLabelText('평가 기준이 맞나요?')
  const fixture = document.getElementById('fixture-review') as HTMLDetailsElement
  const submit = within(fixture).getByRole('button', { name: '평가 기준 확인 저장' })
  expect(submit).toHaveProperty('disabled', true)
  fireEvent.change(select, { target: { value: decision } })
  fireEvent.change(within(fixture).getByLabelText('기준을 확인한 이유'), { target: { value: '다시 확인해야 해요' } })
  expect(submit).toHaveProperty('disabled', true)
  fireEvent.click(within(fixture).getByRole('checkbox'))
  expect(submit).toHaveProperty('disabled', false)
  fireEvent.click(submit)
  expect(await screen.findByText('평가 기준 확인 결과를 저장했어요.')).toBeTruthy()
  expect(save).toHaveBeenCalledTimes(1)
  expect(screen.queryByText(/이제 사례별 후보 답변을 검토/)).toBeNull()
})

it('현재 승인된 기준이 자료 변경으로 오래되면 다시 열어 확인하도록 한다', async () => {
  const initial = readyForOverall()
  const changed = structuredClone(initial)
  changed.quality!.fixture_reviews[0].fixture_sha256 = 'old'
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(initial)
  vi.spyOn(opsApi, 'saveEvaluationCaseReview').mockResolvedValue(changed)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  const summary = await screen.findByText('질문과 답변 검토하기')
  const details = document.getElementById('fixture-review') as HTMLDetailsElement
  expect(details.open).toBe(false)
  fireEvent.click(summary)
  fireEvent.change(screen.getByLabelText('E01 판단'), { target: { value: 'DEFERRED' } })
  fireEvent.change(screen.getByLabelText('E01 확인한 이유'), { target: { value: '자료 변경 확인' } })
  fireEvent.click(screen.getByRole('button', { name: 'E01 검토 저장' }))
  await waitFor(() => expect(details.open).toBe(true))
  expect(screen.queryByRole('button', { name: '평가 기준 확인하기' })).toBeNull()
})

it('평가 기준을 수동으로 접었다 열어도 작성 중인 내용이 보존된다', async () => {
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(state)
  const save = vi.spyOn(opsApi, 'saveFixtureReview')
  const view = render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  const input = await screen.findByLabelText('평가 기준이 맞나요?')
  const details = document.getElementById('fixture-review') as HTMLDetailsElement
  const summary = details.querySelector('summary')!
  fireEvent.change(input, { target: { value: 'DEFERRED' } })
  fireEvent.change(screen.getByLabelText('기준을 확인한 이유'), { target: { value: '확인 중인 기준' } })
  fireEvent.click(summary)
  expect(details.open).toBe(false)
  view.rerender(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  expect(details.open).toBe(false)
  fireEvent.click(summary)
  expect(details.open).toBe(true)
  expect(screen.getByLabelText('평가 기준이 맞나요?')).toHaveProperty('value', 'DEFERRED')
  expect(screen.getByLabelText('기준을 확인한 이유')).toHaveProperty('value', '확인 중인 기준')
  expect(screen.getByRole('checkbox', { name: '모든 질문의 공고 내용과 평가 기준을 확인했어요.' })).toHaveProperty('checked', false)
  expect(save).not.toHaveBeenCalled()
})

it('질문이 하나면 질문 선택은 감추고 다음 단계는 접어 둔다', async () => {
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(state)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByText('질문과 답변 검토하기'))
  expect(screen.queryByRole('region', { name: '사례 선택' })).toBeNull()
  expect(screen.queryByRole('button', { name: '이전 질문' })).toBeNull()
  expect(screen.queryByRole('button', { name: '다음 질문' })).toBeNull()
  expect(screen.getByLabelText('E01 판단')).toBeTruthy()
  expect((document.getElementById('quality-review') as HTMLDetailsElement).open).toBe(false)
  expect((document.getElementById('overall-review') as HTMLDetailsElement).open).toBe(false)
})

it('전체 검토로 이동하면 해당 단계만 열고, 접었다 열어도 의견이 남는다', async () => {
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(readyForOverall())
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: '전체 검토 확인하기' }))
  const overall = document.getElementById('overall-review') as HTMLDetailsElement
  await waitFor(() => expect(document.activeElement).toBe(overall))
  expect(overall.open).toBe(true)
  const questionPanel = screen.getByText('질문과 답변 검토하기').closest('details')!
  expect(questionPanel.open).toBe(false)
  expect(questionPanel.contains(overall)).toBe(false)
  expect((document.getElementById('quality-review') as HTMLDetailsElement).open).toBe(false)
  fireEvent.change(screen.getByLabelText('검토 의견'), { target: { value: '확인 중인 의견' } })
  fireEvent.click(screen.getByText('전체 검토와 비교 기준'))
  fireEvent.click(screen.getByText('전체 검토와 비교 기준'))
  expect(screen.getByLabelText('검토 의견')).toHaveProperty('value', '확인 중인 의견')
})

it('최종 결과로 이동하면 해당 단계가 열리고 초점이 이동한다', async () => {
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(readyForOverall(true))
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: '최종 결과 확인하기' }))
  const final = document.getElementById('quality-review') as HTMLDetailsElement
  await waitFor(() => expect(document.activeElement).toBe(final))
  expect(final.open).toBe(true)
  const questionPanel = screen.getByText('질문과 답변 검토하기').closest('details')!
  expect(questionPanel.open).toBe(false)
  expect(questionPanel.contains(final)).toBe(false)
  expect((document.getElementById('overall-review') as HTMLDetailsElement).open).toBe(false)
  expect(screen.getByRole('button', { name: '최종 결과 확인하고 저장' })).toBeTruthy()
})

it('답변에 쓴 공고 내용과 평가 조건을 같은 1번부터 보여준다', async () => {
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(state)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByText('질문과 답변 검토하기'))
  expect(screen.getByText('공고 내용 1 · 답변에서 사용함')).toBeTruthy()
  expect(screen.getByText(/답변에 표시한 공고 내용 번호: 1/)).toBeTruthy()
  fireEvent.click(screen.getByText('AI가 작성한 평가 조건'))
  expect(screen.getByText(/인용해야 할 근거 번호: 1/)).toBeTruthy()
})

it('전체 검토와 다음 평가 기준의 버튼을 구분하고 같은 간격으로 배치한다', async () => {
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(readyForOverall())
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByText('전체 검토와 비교 기준'))
  const saveGroup = screen.getByRole('group', { name: '전체 검토 저장' })
  const approval = within(saveGroup).getByRole('button', { name: '검토 승인 저장' })
  const changes = within(saveGroup).getByRole('button', { name: '수정 필요 저장' })
  const baseline = screen.getByRole('button', { name: '비교 기준으로 지정' })
  expect(saveGroup.className).toContain('gap-3')
  expect(baseline.parentElement?.className).toContain('gap-3')
  expect(saveGroup.contains(baseline)).toBe(false)
  for (const button of [approval, changes, baseline]) {
    expect(button.className).toContain('min-h-11')
    expect(button.className).toContain('!text-sm')
  }
})


it('평가 기준 도움말은 필요한 때 열리고 선택한 값은 유지된다', async () => {
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(state)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  await screen.findByRole('button', { name: '이 질문의 답변 보기' })
  const help = screen.getByRole('button', { name: '평가 기준 도움말' })
  expect(help.getAttribute('aria-expanded')).toBe('false')
  expect(screen.queryByText(/답변 자체의 검토와는 별도로 저장/)).toBeNull()
  fireEvent.change(screen.getByLabelText('평가 기준이 맞나요?'), { target: { value: 'DEFERRED' } })
  fireEvent.click(help)
  expect(help.getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByText(/답변 자체의 검토와는 별도로 저장/)).toBeTruthy()
  fireEvent.click(help)
  expect(screen.getByLabelText('평가 기준이 맞나요?')).toHaveProperty('value', 'DEFERRED')
})

it('비교 기준의 교체 안내는 보이고 상세 설명은 도움말로 연다', async () => {
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(readyForOverall())
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: '전체 검토 확인하기' }))
  expect(await screen.findByText('새 기준을 지정하면 기존 기준이 바뀌어요.')).toBeTruthy()
  const help = screen.getByRole('button', { name: '비교 기준 도움말' })
  expect(help.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(help)
  expect(screen.getByText(/이미 접수한 평가는 바뀌지 않아요/)).toBeTruthy()
  expect(help.getAttribute('aria-expanded')).toBe('true')
})
