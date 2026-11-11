// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

function review(decision: 'SUITABLE' | 'UNSUITABLE' | 'DEFERRED', overrides: Partial<EvaluationReview['case_reviews'][number]> = {}): EvaluationReview['case_reviews'][number] {
  return { id: 1, version: 1, case_id: 'E01', decision, comment: '확인', capture_sha256: 'capture', fixture_sha256: 'fixture', rubric_version: 'v1', reviewed_by: 'admin', created_at: '2026-10-03T00:00:00Z', ...overrides }
}

function approveFixture(value: EvaluationReview) {
  value.quality!.fixture_reviews = [{ id: 1, version: 1, decision: 'APPROVED', comment: '', fixture_sha256: value.material!.fixture_sha256, case_ids: value.material!.cases.map((item) => item.case_id), rubric_version: value.quality!.fixture_rubric_version, reviewed_by: 'admin', created_at: '2026-10-03T00:00:00Z' }]
  value.quality!.fixture_version = 1
  return value
}

function reviewArea(name: '평가 기준' | '답변 확인' | '전체·비교') {
  return within(screen.getByRole('navigation', { name: '답변 검토 영역' })).getByRole('button', { name: new RegExp(`^${name}`) })
}

function withQualityResult(status: 'PASS' | 'FAIL' | 'NEEDS_REVIEW', reasons: { code: string; case_id: string | null; message: string }[] = []) {
  const value = structuredClone(state)
  value.quality!.status = status
  value.quality!.is_current = true
  value.quality!.current_id = 1
  value.quality!.history = [{ id: 1, status, policy: { definition: { version: 'v1' } }, policy_sha256: 'policy', input_sha256: 'input', assessed_by: 'admin', created_at: '2026-10-03T00:00:00Z', reasons }]
  return value
}

function setCurrentQualityResult(value: EvaluationReview, status: 'PASS' | 'FAIL' | 'NEEDS_REVIEW') {
  const result = withQualityResult(status).quality!
  value.quality!.status = result.status
  value.quality!.is_current = true
  value.quality!.current_id = result.current_id
  value.quality!.history = result.history
  return value
}

it.each(['PASS', 'FAIL', 'NEEDS_REVIEW'] as const)('이미 현재 %s 결과가 있으면 판정을 반복하지 않는다', async (status) => {
  const value = withQualityResult(status)
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  const assess = vi.spyOn(opsApi, 'assessEvaluationQuality')
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^전체·비교/ }))
  const result = document.getElementById('quality-review')!
  expect(within(result).queryByRole('button', { name: /결과 .*판정하기/ })).toBeNull()
  expect(assess).not.toHaveBeenCalled()
})

it('오래된 결과는 이전 기록을 보존하고 사용자가 눌렀을 때만 다시 판정한다', async () => {
  const value = withQualityResult('FAIL', [{ code: 'STATUS_MISMATCH', case_id: 'E01', message: '답변 상태가 다릅니다.' }])
  value.quality!.is_current = false
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  const assess = vi.spyOn(opsApi, 'assessEvaluationQuality').mockResolvedValue(value)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^전체·비교/ }))
  const result = document.getElementById('quality-review')!
  expect(within(result).getByText('다시 판정 필요')).toBeTruthy()
  fireEvent.click(within(result).getByText('결과 확인 이력 · 1건'))
  expect(within(result).getByText(/답변 상태가 다릅니다/)).toBeTruthy()
  const button = within(result).getByRole('button', { name: '결과 다시 판정하기' })
  expect(assess).not.toHaveBeenCalled()
  fireEvent.click(button)
  await waitFor(() => expect(assess).toHaveBeenCalledExactlyOnceWith('run', 'input'))
})

it.each([true, false])('기존 비교 기준 여부 %s에 따라 재판정 영향을 안내한다', async (baseline) => {
  const value = withQualityResult('PASS')
  value.quality!.is_current = false
  value.is_baseline = baseline
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  const assess = vi.spyOn(opsApi, 'assessEvaluationQuality')
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^전체·비교/ }))
  const result = document.getElementById('quality-review')!
  expect(!!within(result).queryByText('판정 결과에 따라 현재 비교 기준이 해제될 수 있어요.')).toBe(baseline)
  expect(within(result).getByRole('button', { name: '결과 다시 판정하기' })).toBeTruthy()
  expect(assess).not.toHaveBeenCalled()
})

it('현재 확인 필요 결과에 사유가 누락되면 이유를 추측하지 않고 새로고침을 안내한다', async () => {
  const value = withQualityResult('NEEDS_REVIEW')
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  const assess = vi.spyOn(opsApi, 'assessEvaluationQuality')
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^전체·비교/ }))
  const result = document.getElementById('quality-review')!
  expect(within(result).getByText('확인할 내용을 불러오지 못했어요. 검토를 새로고침해 주세요.')).toBeTruthy()
  expect(within(result).queryByRole('button', { name: /결과 .*판정하기/ })).toBeNull()
  expect(assess).not.toHaveBeenCalled()
})

it.each([
  ['FIXTURE_REVIEW_REQUIRED', null, '평가 기준 확인하기', 'fixture-review'],
  ['CASE_REVIEW_REQUIRED', 'E01', 'E01 답변 확인하기', 'case-review-E01'],
] as const)('현재 확인 필요 결과의 %s 사유에서 해당 검토로 이동한다', async (code, caseId, label, target) => {
  const value = withQualityResult('NEEDS_REVIEW', [{ code, case_id: caseId, message: '확인이 필요합니다.' }])
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  const assess = vi.spyOn(opsApi, 'assessEvaluationQuality')
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^전체·비교/ }))
  const result = document.getElementById('quality-review')!
  expect(within(result).getByText('확인 필요')).toBeTruthy()
  expect(within(result).getByText('판정은 끝났지만 확인할 내용이 남았어요.')).toBeTruthy()
  expect(result.textContent).toContain(code === 'FIXTURE_REVIEW_REQUIRED' ? '평가 기준을 확인해 주세요.' : '답변을 아직 확인하지 않았거나 판단을 보류했어요.')
  expect(within(result).queryByRole('button', { name: '결과 판정하기' })).toBeNull()
  fireEvent.click(within(result).getByRole('button', { name: label }))
  await waitFor(() => expect(document.activeElement?.id).toBe(target))
  expect(assess).not.toHaveBeenCalled()
})

it('존재하지 않는 질문의 결과 사유는 표시하되 이동 버튼은 만들지 않는다', async () => {
  const value = withQualityResult('NEEDS_REVIEW', [{ code: 'CASE_REVIEW_REQUIRED', case_id: 'missing', message: '알 수 없는 질문 확인이 필요합니다.' }])
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^전체·비교/ }))
  const result = document.getElementById('quality-review')!
  expect(result.textContent).toContain('답변을 아직 확인하지 않았거나 판단을 보류했어요.')
  expect(within(result).queryByRole('button', { name: /missing 답변 확인하기/ })).toBeNull()
})

it.each([
  ['CASE_UNSUITABLE', '답변에 문제가 있다고 확인했어요.'],
  ['STATUS_MISMATCH', '답변했는지 또는 보류했는지가 평가 기준과 달라요.'],
  ['EXPECTED_CITATION_MISSING', '답변에 표시해야 할 공고 근거가 빠졌어요.'],
])('불합격 사유 %s에서 해당 질문으로 이동한다', async (code, description) => {
  const value = withQualityResult('FAIL', [{ code, case_id: 'E01', message: '이 질문을 확인해 주세요.' }])
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  const assess = vi.spyOn(opsApi, 'assessEvaluationQuality')
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^전체·비교/ }))
  const result = document.getElementById('quality-review')!
  expect(result.textContent).toContain(description)
  fireEvent.click(within(result).getByRole('button', { name: 'E01 답변 확인하기' }))
  await waitFor(() => expect(document.activeElement?.id).toBe('case-review-E01'))
  expect(assess).not.toHaveBeenCalled()
})

it('알 수 없는 사유는 원문을 보존하고 질문 번호가 있어도 임의 이동을 만들지 않는다', async () => {
  const value = withQualityResult('NEEDS_REVIEW', [{ code: 'UNKNOWN', case_id: 'E01', message: '새로 추가된 사유입니다.' }])
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^전체·비교/ }))
  const result = document.getElementById('quality-review')!
  expect(result.textContent).toContain('새로 추가된 사유입니다.')
  expect(within(result).queryByRole('button', { name: 'E01 답변 확인하기' })).toBeNull()
})

it('같은 질문의 불합격 사유는 모두 보여주고 질문 이동은 한 번만 제공한다', async () => {
  const value = withQualityResult('FAIL', [
    { code: 'STATUS_MISMATCH', case_id: 'E01', message: '상태가 다릅니다.' },
    { code: 'EXPECTED_CITATION_MISSING', case_id: 'E01', message: '근거가 빠졌습니다.' },
  ])
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^전체·비교/ }))
  const result = document.getElementById('quality-review')!
  expect(result.textContent).toContain('답변했는지 또는 보류했는지가 평가 기준과 달라요.')
  expect(result.textContent).toContain('답변에 표시해야 할 공고 근거가 빠졌어요.')
  expect(within(result).getAllByRole('button', { name: 'E01 답변 확인하기' })).toHaveLength(1)
})

it('검토할 질문이 없으면 결과를 판정할 수 없고 서버에 요청하지 않는다', async () => {
  const value = structuredClone(state)
  value.material!.cases = []
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  const assess = vi.spyOn(opsApi, 'assessEvaluationQuality')
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^전체·비교/ }))
  const result = document.getElementById('quality-review')!
  expect(within(result).getByText('확인 불가')).toBeTruthy()
  const button = within(result).queryByRole('button', { name: '결과 판정하기' })
  if (button) {
    expect(button).toHaveProperty('disabled', true)
    fireEvent.click(button)
  }
  expect(assess).not.toHaveBeenCalled()
})

it.each(['id', 'status', 'hash'] as const)('현재 결과의 기록 %s가 맞지 않으면 확정 상태나 반복 판정을 표시하지 않는다', async (field) => {
  const value = withQualityResult('PASS')
  if (field === 'id') value.quality!.current_id = 2
  if (field === 'status') value.quality!.history[0].status = 'FAIL'
  if (field === 'hash') value.quality!.history[0].input_sha256 = 'old'
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  const assess = vi.spyOn(opsApi, 'assessEvaluationQuality')
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^전체·비교/ }))
  const result = document.getElementById('quality-review')!
  expect(within(result).getByText('확인 불가')).toBeTruthy()
  expect(within(result).getByText(/결과 기록을 확인할 수 없어요/)).toBeTruthy()
  expect(within(result).queryByRole('button', { name: /결과 .*판정하기/ })).toBeNull()
  expect(assess).not.toHaveBeenCalled()
})

it.each([
  ['PASS', '합격'], ['FAIL', '불합격'], ['NEEDS_REVIEW', '확인 필요'],
] as const)('사용자가 판정한 %s 결과를 별도 성공 배너 없이 알린다', async (status, label) => {
  const result = withQualityResult(status, status === 'NEEDS_REVIEW' ? [{ code: 'CASE_REVIEW_REQUIRED', case_id: 'E01', message: '확인이 필요합니다.' }] : [])
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(structuredClone(state))
  const assess = vi.spyOn(opsApi, 'assessEvaluationQuality').mockResolvedValue(result)
  const changed = vi.fn()
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={changed} />)
  fireEvent.click(await screen.findByRole('button', { name: /^전체·비교/ }))
  const area = document.getElementById('quality-review')!
  expect(assess).not.toHaveBeenCalled()
  const button = within(area).getByRole('button', { name: '결과 판정하기' })
  button.focus()
  fireEvent.click(button)
  await waitFor(() => expect(changed).toHaveBeenCalledOnce())
  expect(assess).toHaveBeenCalledExactlyOnceWith('run', 'input')
  expect(within(area).getByText(label)).toBeTruthy()
  expect(screen.queryByText('결과를 확인했어요.')).toBeNull()
  expect(within(area.parentElement!).getByRole('status').textContent).toContain(`판정 결과: ${label}`)
  expect(document.activeElement).toBe(area)
})

it('판정 중에는 중복 요청을 막고 대기 상태를 표시한다', async () => {
  let resolve!: (value: EvaluationReview) => void
  const pending = new Promise<EvaluationReview>((done) => { resolve = done })
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(structuredClone(state))
  const assess = vi.spyOn(opsApi, 'assessEvaluationQuality').mockReturnValue(pending)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^전체·비교/ }))
  const area = document.getElementById('quality-review')!
  const button = within(area).getByRole('button', { name: '결과 판정하기' })
  fireEvent.click(button)
  const pendingButton = within(area).getByRole('button', { name: '판정 중…' })
  expect(pendingButton).toHaveProperty('disabled', true)
  fireEvent.click(pendingButton)
  expect(assess).toHaveBeenCalledTimes(1)
  await act(async () => { resolve(withQualityResult('PASS')); await pending })
})

it('판정 중 다른 곳으로 이동하면 완료 후 초점을 빼앗지 않는다', async () => {
  let resolve!: (value: EvaluationReview) => void
  const pending = new Promise<EvaluationReview>((done) => { resolve = done })
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(structuredClone(state))
  vi.spyOn(opsApi, 'assessEvaluationQuality').mockReturnValue(pending)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^전체·비교/ }))
  const area = document.getElementById('quality-review')!
  const button = within(area).getByRole('button', { name: '결과 판정하기' })
  button.focus()
  fireEvent.click(button)
  const other = screen.getByRole('heading', { name: '답변 검토' })
  other.setAttribute('tabindex', '-1')
  other.focus()
  await act(async () => { resolve(withQualityResult('PASS')); await pending })
  expect(document.activeElement).toBe(other)
})

it.each([false, true])('판정 중 비활성 버튼에서 초점이 이탈할 때 사용자 조작 여부 %s를 고려한다', async (interacted) => {
  let resolve!: (value: EvaluationReview) => void
  const pending = new Promise<EvaluationReview>((done) => { resolve = done })
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(structuredClone(state))
  vi.spyOn(opsApi, 'assessEvaluationQuality').mockReturnValue(pending)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^전체·비교/ }))
  const area = document.getElementById('quality-review')!
  const button = within(area).getByRole('button', { name: '결과 판정하기' })
  button.focus()
  fireEvent.click(button)
  document.body.tabIndex = -1
  document.body.focus()
  document.body.removeAttribute('tabindex')
  expect(document.activeElement).toBe(document.body)
  if (interacted) fireEvent.keyDown(document.body, { key: 'Tab' })
  await act(async () => { resolve(withQualityResult('PASS')); await pending })
  expect(document.activeElement).toBe(interacted ? document.body : area)
})

it.each([200, 409, 500, 401, 403])('판정 요청 오류 %s 이후 인증 만료를 제외하고 결과 영역으로 초점을 복원한다', async (status) => {
  let reject!: (reason: Error) => void
  const pending = new Promise<EvaluationReview>((_resolve, fail) => { reject = fail })
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(structuredClone(state))
  vi.spyOn(opsApi, 'assessEvaluationQuality').mockReturnValue(pending)
  const expired = vi.fn()
  render(<EvaluationReviewPanel runId="run" onExpired={expired} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^전체·비교/ }))
  const area = document.getElementById('quality-review')!
  const button = within(area).getByRole('button', { name: '결과 판정하기' })
  button.focus()
  fireEvent.click(button)
  document.body.tabIndex = -1
  document.body.focus()
  document.body.removeAttribute('tabindex')
  await act(async () => { reject(new opsApi.OpsApiError('판정 실패', status)); try { await pending } catch { /* 화면에서 오류를 처리한다. */ } })
  expect(document.activeElement).toBe(status === 401 || status === 403 ? document.body : area)
  expect(expired).toHaveBeenCalledTimes(status === 401 || status === 403 ? 1 : 0)
})

it.each(['missing', 'id', 'status', 'record hash', 'request hash'] as const)('판정 응답의 %s가 잘못되면 오류를 알리고 입력을 보존하며 새로고침 전 저장을 막는다', async (field) => {
  const result = withQualityResult('PASS')
  if (field === 'missing') result.quality = null
  if (field === 'id') result.quality!.current_id = 99
  if (field === 'status') result.quality!.history[0].status = 'FAIL'
  if (field === 'record hash') result.quality!.history[0].input_sha256 = 'old'
  if (field === 'request hash') { result.quality!.input_sha256 = 'different'; result.quality!.history[0].input_sha256 = 'different' }
  const previous = withQualityResult('FAIL', [{ code: 'STATUS_MISMATCH', case_id: 'E01', message: '이전 판정 이력' }])
  previous.quality!.is_current = false
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(previous)
  const assess = vi.spyOn(opsApi, 'assessEvaluationQuality').mockResolvedValue(result)
  const changed = vi.fn()
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={changed} />)
  fireEvent.click(await screen.findByRole('button', { name: /^전체·비교/ }))
  fireEvent.change(screen.getByLabelText('검토 의견'), { target: { value: '저장하지 않은 의견' } })
  const area = document.getElementById('quality-review')!
  fireEvent.click(within(area).getByRole('button', { name: '결과 다시 판정하기' }))
  expect((await within(area.parentElement!).findByRole('alert')).textContent).toContain('결과를 확인할 수 없어요. 검토를 새로고침해 주세요.')
  expect(changed).not.toHaveBeenCalled()
  expect(screen.queryByText('결과를 확인했어요.')).toBeNull()
  expect(within(area).getByRole('button', { name: '결과 다시 판정하기' })).toHaveProperty('disabled', true)
  expect(assess).toHaveBeenCalledTimes(1)
  fireEvent.click(within(area).getByText('결과 확인 이력 · 1건'))
  expect(within(area).getByText(/이전 판정 이력/)).toBeTruthy()
  fireEvent.click(reviewArea('전체·비교'))
  expect(screen.getByLabelText('검토 의견')).toHaveProperty('value', '저장하지 않은 의견')
  expect(screen.getByRole('button', { name: '수정 필요 저장' })).toHaveProperty('disabled', true)
})

it('성공 HTTP 응답의 형식이 잘못되어도 결과를 확정하지 않고 저장을 잠근다', async () => {
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(structuredClone(state))
  vi.spyOn(opsApi, 'assessEvaluationQuality').mockRejectedValue(new opsApi.OpsApiError('응답 형식 오류', 200))
  const changed = vi.fn()
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={changed} />)
  fireEvent.click(await screen.findByRole('button', { name: /^전체·비교/ }))
  const area = document.getElementById('quality-review')!
  fireEvent.click(within(area).getByRole('button', { name: '결과 판정하기' }))
  expect((await within(area.parentElement!).findByRole('alert')).textContent).toContain('검토를 새로고침해 주세요.')
  expect(within(area).getByRole('button', { name: '결과 판정하기' })).toHaveProperty('disabled', true)
  expect(changed).not.toHaveBeenCalled()
})

it.each([401, 403])('판정 요청에서 인증 오류 %s가 발생하면 세션 만료를 알린다', async (status) => {
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(structuredClone(state))
  vi.spyOn(opsApi, 'assessEvaluationQuality').mockRejectedValue(new opsApi.OpsApiError('접근할 수 없습니다', status))
  const expired = vi.fn()
  const changed = vi.fn()
  render(<EvaluationReviewPanel runId="run" onExpired={expired} onChanged={changed} />)
  fireEvent.click(await screen.findByRole('button', { name: /^전체·비교/ }))
  fireEvent.click(screen.getByRole('button', { name: '결과 판정하기' }))
  await waitFor(() => expect(expired).toHaveBeenCalledOnce())
  expect(changed).not.toHaveBeenCalled()
})

it.each([409, 500])('판정 요청 실패 %s를 오류로 표시하고 기존 결과 이력을 유지한다', async (status) => {
  const input = withQualityResult('FAIL', [{ code: 'STATUS_MISMATCH', case_id: 'E01', message: '이전 결과' }])
  input.quality!.is_current = false
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(input)
  vi.spyOn(opsApi, 'assessEvaluationQuality').mockRejectedValue(new opsApi.OpsApiError('판정 요청 실패', status))
  const changed = vi.fn()
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={changed} />)
  fireEvent.click(await screen.findByRole('button', { name: /^전체·비교/ }))
  const area = document.getElementById('quality-review')!
  fireEvent.click(within(area).getByRole('button', { name: '결과 다시 판정하기' }))
  expect((await within(area.parentElement!).findByRole('alert')).textContent).toContain('판정 요청 실패')
  expect(changed).not.toHaveBeenCalled()
  fireEvent.click(within(area).getByText('결과 확인 이력 · 1건'))
  expect(within(area).getByText(/이전 결과/)).toBeTruthy()
  if (status === 409) expect(within(area).getByRole('button', { name: '결과 다시 판정하기' })).toHaveProperty('disabled', true)
})

it('검토하지 않은 질문은 선택란만 보여주고 저장된 판단 문구를 표시하지 않는다', async () => {
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(structuredClone(state))
  const save = vi.spyOn(opsApi, 'saveEvaluationCaseReview')
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^답변 확인 ·/ }))
  expect(screen.getByLabelText('E01 판단')).toHaveProperty('value', '')
  expect(screen.queryByText(/저장된 판단|이전에 저장한 판단/)).toBeNull()
  fireEvent.change(screen.getByLabelText('E01 판단'), { target: { value: 'SUITABLE' } })
  expect(screen.queryByText(/저장된 판단|이전에 저장한 판단/)).toBeNull()
  expect(save).not.toHaveBeenCalled()
})

it.each([
  ['SUITABLE', '문제없음', 'DEFERRED'],
  ['UNSUITABLE', '문제 있음', 'SUITABLE'],
  ['DEFERRED', '판단 보류', 'SUITABLE'],
] as const)('현재 저장된 %s 판단은 선택값으로 보이고 변경 중에만 이전 판단을 표시한다', async (decision, label, changed) => {
  const value = structuredClone(state)
  value.case_reviews = [review(decision)]
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^답변 확인 ·/ }))
  const select = screen.getByLabelText('E01 판단')
  expect(select).toHaveProperty('value', decision)
  expect(screen.queryByText(/저장된 판단/)).toBeNull()
  fireEvent.change(select, { target: { value: changed } })
  expect(screen.getByText(`이전에 저장한 판단: ${label}`)).toBeTruthy()
  fireEvent.change(select, { target: { value: decision } })
  expect(screen.queryByText(/이전에 저장한 판단/)).toBeNull()
})

it.each(['capture_sha256', 'fixture_sha256', 'rubric_version'] as const)('%s이 달라진 최신 판단은 미검토로 숨기지 않고 다시 확인하도록 안내한다', async (field) => {
  const value = structuredClone(state)
  value.case_reviews = [review('SUITABLE', { id: 2, version: 2, [field]: 'old' }), review('SUITABLE')]
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^답변 확인 ·/ }))
  expect(screen.getByText('자료나 평가 기준이 바뀌어 다시 확인해야 해요.')).toBeTruthy()
  expect(screen.getByLabelText('E01 판단')).toHaveProperty('value', '')
  expect(screen.queryByText(/저장된 판단|이전에 저장한 판단/)).toBeNull()
})

it.each([500, 409])('저장 오류 %s 후에도 작성 중인 판단과 이전에 저장한 판단을 유지한다', async (status) => {
  const value = structuredClone(state)
  value.case_reviews = [review('SUITABLE')]
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  vi.spyOn(opsApi, 'saveEvaluationCaseReview').mockRejectedValue(new opsApi.OpsApiError('저장 실패', status))
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^답변 확인 ·/ }))
  fireEvent.change(screen.getByLabelText('E01 판단'), { target: { value: 'UNSUITABLE' } })
  fireEvent.change(screen.getByLabelText('E01 어떤 문제가 있나요?'), { target: { value: '내용이 빠졌어요' } })
  fireEvent.click(screen.getByRole('button', { name: 'E01 검토 저장' }))
  await screen.findByText('저장 실패')
  expect(screen.getByText('이전에 저장한 판단: 문제없음')).toBeTruthy()
  expect(screen.getByLabelText('E01 판단')).toHaveProperty('value', 'UNSUITABLE')
  expect(screen.getByLabelText('E01 어떤 문제가 있나요?')).toHaveProperty('value', '내용이 빠졌어요')
  expect(screen.getByRole('button', { name: 'E01 검토 저장' })).toHaveProperty('disabled', status === 409)
})

it('답변 확인 기준은 알려진 기준을 쉽게 설명하고 새 기준은 그대로 보여준다', async () => {
  const value = structuredClone(state)
  value.rubric.criteria = [
    '신청 조건·예외·제외 사유를 누락하거나 근거에 없는 조건을 추가하지 않았는가',
    '답변의 각 주장이 제공한 근거와 일치하고, 근거가 부족하면 부족하다고 답했는가',
    '인용한 청크가 답변을 뒷받침하며 필요한 인용이 빠지지 않았는가',
    '서버에서 새로 추가한 확인 기준',
    'constructor',
  ]
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  const save = vi.spyOn(opsApi, 'saveEvaluationCaseReview')
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^답변 확인 ·/ }))
  fireEvent.change(screen.getByLabelText('E01 판단'), { target: { value: 'DEFERRED' } })
  fireEvent.change(screen.getByLabelText('E01 무엇을 더 확인해야 하나요?'), { target: { value: '확인할 내용 초안' } })
  const summary = screen.getByText('답변 확인 기준')
  const details = summary.closest('details')!
  expect(details.open).toBe(false)
  fireEvent.click(summary)
  expect(details.open).toBe(true)
  expect(within(details).getByText('신청 조건과 예외·제외 사유가 빠지지 않았나요? 제공된 공고 내용에 없는 조건을 추가하지 않았나요?')).toBeTruthy()
  expect(within(details).getByText('답변이 제공된 공고 내용과 맞나요? 근거가 부족할 때는 부족하다고 밝혔나요?')).toBeTruthy()
  expect(within(details).getByText('답변에 표시한 공고 내용이 답변을 뒷받침하나요? 필요한 근거가 빠지지 않았나요?')).toBeTruthy()
  expect(within(details).getByText('서버에서 새로 추가한 확인 기준')).toBeTruthy()
  expect(within(details).getByText('constructor')).toBeTruthy()
  fireEvent.click(summary)
  expect(details.open).toBe(false)
  expect(screen.getByLabelText('E01 무엇을 더 확인해야 하나요?')).toHaveProperty('value', '확인할 내용 초안')
  expect(save).not.toHaveBeenCalled()
})

it('출처와 답변 기준이 기록되지 않은 자료는 빈 상태를 표시한다', async () => {
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(structuredClone(state))
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^답변 확인 ·/ }))
  const source = screen.getByText('자료 출처와 변경 내용')
  const criteria = screen.getByText('답변 확인 기준')
  expect(source.closest('details')!.open).toBe(false)
  expect(criteria.closest('details')!.open).toBe(false)
  fireEvent.click(source)
  fireEvent.click(criteria)
  expect(screen.getByText('자료 출처와 변경 내용이 기록되지 않았어요.')).toBeTruthy()
  expect(screen.getByText('답변 확인 기준이 기록되지 않았어요.')).toBeTruthy()
})

it('가상 평가 자료는 실제 공고로 표시하지 않는다', async () => {
  const value = structuredClone(state)
  value.material!.data_type = 'synthetic'
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^답변 확인 ·/ }))
  fireEvent.click(screen.getByText('자료 출처와 변경 내용'))
  expect(screen.getByText('가상으로 만든 평가 자료예요.')).toBeTruthy()
  expect(screen.queryByText(/실제 공고에서 저장한 본문/)).toBeNull()
})

it('문제없는 답변은 이유를 묻지 않고 빈 이유로 저장한다', async () => {
  const value = structuredClone(state)
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  const save = vi.spyOn(opsApi, 'saveEvaluationCaseReview').mockResolvedValue(value)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^답변 확인 ·/ }))
  expect(screen.queryByLabelText(/^E01 (어떤 문제가 있나요|무엇을 더 확인해야 하나요)\?$/)).toBeNull()
  expect(screen.getByRole('button', { name: 'E01 검토 저장' })).toHaveProperty('disabled', true)
  fireEvent.change(screen.getByLabelText('E01 판단'), { target: { value: 'DEFERRED' } })
  fireEvent.change(screen.getByLabelText('E01 무엇을 더 확인해야 하나요?'), { target: { value: '이전 판단의 초안' } })
  fireEvent.change(screen.getByLabelText('E01 판단'), { target: { value: 'SUITABLE' } })
  expect(screen.queryByLabelText(/^E01 (어떤 문제가 있나요|무엇을 더 확인해야 하나요)\?$/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'E01 검토 저장' }))
  await waitFor(() => expect(save).toHaveBeenCalledExactlyOnceWith('run', 'E01', 'SUITABLE', '', expect.objectContaining({ review_version: 0 })))
})

it.each([
  ['UNSUITABLE', 'E01 어떤 문제가 있나요?'],
  ['DEFERRED', 'E01 무엇을 더 확인해야 하나요?'],
] as const)('%s 판단은 관련된 질문으로 이유를 받고 공백만으로 저장하지 않는다', async (decision, label) => {
  const value = structuredClone(state)
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  const save = vi.spyOn(opsApi, 'saveEvaluationCaseReview').mockResolvedValue(value)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^답변 확인 ·/ }))
  fireEvent.change(screen.getByLabelText('E01 판단'), { target: { value: decision } })
  const reason = screen.getByLabelText(label)
  const button = screen.getByRole('button', { name: 'E01 검토 저장' })
  expect(button).toHaveProperty('disabled', true)
  fireEvent.change(reason, { target: { value: '  \n  ' } })
  expect(button).toHaveProperty('disabled', true)
  fireEvent.change(reason, { target: { value: '  확인할 내용  ' } })
  fireEvent.click(button)
  await waitFor(() => expect(save).toHaveBeenCalledExactlyOnceWith('run', 'E01', decision, '확인할 내용', expect.objectContaining({ review_version: 0 })))
})

it('판단을 바꿔 이유가 잠시 감춰져도 다시 돌아오면 초안을 유지한다', async () => {
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(structuredClone(state))
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^답변 확인 ·/ }))
  const decision = screen.getByLabelText('E01 판단')
  fireEvent.change(decision, { target: { value: 'UNSUITABLE' } })
  fireEvent.change(screen.getByLabelText('E01 어떤 문제가 있나요?'), { target: { value: '기간이 빠졌어요' } })
  fireEvent.change(decision, { target: { value: 'SUITABLE' } })
  expect(screen.queryByLabelText(/^E01 (어떤 문제가 있나요|무엇을 더 확인해야 하나요)\?$/)).toBeNull()
  fireEvent.change(decision, { target: { value: 'DEFERRED' } })
  expect(screen.getByLabelText('E01 무엇을 더 확인해야 하나요?')).toHaveProperty('value', '기간이 빠졌어요')
})

it('기존에 저장한 적합 사유는 입력란 없이 검토 이력에서 확인할 수 있다', async () => {
  const value = structuredClone(state)
  value.case_reviews = [review('SUITABLE', { comment: '이전에 작성한 확인 내용' })]
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^답변 확인 ·/ }))
  expect(screen.queryByLabelText(/^E01 (어떤 문제가 있나요|무엇을 더 확인해야 하나요)\?$/)).toBeNull()
  fireEvent.click(screen.getByText('E01 검토 이력 · 1건'))
  expect(screen.getByText('이전에 작성한 확인 내용')).toBeTruthy()
})

it.each([
  ['기준 미승인', false, null, '평가 기준'],
  ['답변 미확인', true, null, '답변 확인'],
  ['답변 보류', true, 'DEFERRED', '답변 확인'],
  ['답변 부적합', true, 'UNSUITABLE', '답변 확인'],
  ['답변 적합', true, 'SUITABLE', '답변 확인'],
] as const)('처음 열 때 %s 상태에 필요한 영역을 선택한다', async (_, approved, decision, selected) => {
  const value = structuredClone(state)
  if (approved) approveFixture(value)
  if (decision) value.case_reviews = [review(decision)]
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  await screen.findByRole('navigation', { name: '답변 검토 영역' })
  for (const name of ['평가 기준', '답변 확인', '전체·비교'] as const) {
    expect(reviewArea(name).getAttribute('aria-pressed')).toBe(String(name === selected))
  }
})

it.each(['MISSING', 'STALE', 'DEFERRED'] as const)('처음 열 때 이미 확인한 질문보다 %s 질문을 먼저 보여준다', async (scenario) => {
  const value = structuredClone(state)
  value.material!.cases.push({ ...value.material!.cases[0], case_id: 'E02', question: '신청 기간은?' })
  approveFixture(value)
  value.case_reviews = [review('SUITABLE')]
  if (scenario !== 'MISSING') value.case_reviews.unshift(review(scenario === 'DEFERRED' ? 'DEFERRED' : 'SUITABLE', { id: 2, case_id: 'E02', capture_sha256: scenario === 'STALE' ? 'old' : 'capture' }))
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  expect(await screen.findByLabelText('확인할 질문')).toHaveProperty('value', 'E02')
  expect(reviewArea('답변 확인').getAttribute('aria-pressed')).toBe('true')
})

it('보류 질문이 앞에 있어도 아직 확인하지 않은 질문을 먼저 선택한다', async () => {
  const value = structuredClone(state)
  value.material!.cases.push({ ...value.material!.cases[0], case_id: 'E02', question: '신청 기간은?' })
  approveFixture(value)
  value.case_reviews = [review('DEFERRED')]
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  expect(await screen.findByLabelText('확인할 질문')).toHaveProperty('value', 'E02')
})

it('재조회 응답이 늦어도 사용자가 선택한 영역을 덮어쓰지 않는다', async () => {
  let resolve!: (value: EvaluationReview) => void
  const pending = new Promise<EvaluationReview>((done) => { resolve = done })
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValueOnce(structuredClone(state)).mockReturnValueOnce(pending)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  await screen.findByRole('navigation', { name: '답변 검토 영역' })
  fireEvent.click(screen.getByRole('button', { name: '검토 새로고침' }))
  fireEvent.click(reviewArea('전체·비교'))
  await act(async () => { resolve(approveFixture(structuredClone(state))); await pending })
  expect(reviewArea('전체·비교').getAttribute('aria-pressed')).toBe('true')
})

it('영역은 한 번 선택하면 열리며 다른 영역의 입력과 선택을 유지한다', async () => {
  const value = structuredClone(state)
  value.material!.cases.push({ ...value.material!.cases[0], case_id: 'E02', question: '신청 기간은?' })
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  const saveCase = vi.spyOn(opsApi, 'saveEvaluationCaseReview')
  const saveOverall = vi.spyOn(opsApi, 'saveEvaluationReview')
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  await screen.findByRole('navigation', { name: '답변 검토 영역' })
  fireEvent.click(reviewArea('답변 확인'))
  fireEvent.change(screen.getByLabelText('확인할 질문'), { target: { value: 'E02' } })
  fireEvent.change(screen.getByLabelText('E02 판단'), { target: { value: 'DEFERRED' } })
  fireEvent.change(screen.getByLabelText(/^E02 (어떤 문제가 있나요|무엇을 더 확인해야 하나요)\?$/), { target: { value: '확인 중인 이유' } })
  fireEvent.click(reviewArea('전체·비교'))
  fireEvent.change(screen.getByLabelText('검토 의견'), { target: { value: '저장하지 않은 의견' } })
  fireEvent.click(screen.getByLabelText('모든 질문과 공고 내용, 답변을 확인했어요.'))
  fireEvent.click(reviewArea('답변 확인'))
  expect(reviewArea('답변 확인').getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByLabelText('확인할 질문')).toHaveProperty('value', 'E02')
  expect(screen.getByLabelText('E02 판단')).toHaveProperty('value', 'DEFERRED')
  expect(screen.getByLabelText(/^E02 (어떤 문제가 있나요|무엇을 더 확인해야 하나요)\?$/)).toHaveProperty('value', '확인 중인 이유')
  fireEvent.click(reviewArea('전체·비교'))
  expect(screen.getByLabelText('검토 의견')).toHaveProperty('value', '저장하지 않은 의견')
  expect(screen.getByLabelText('모든 질문과 공고 내용, 답변을 확인했어요.')).toHaveProperty('checked', true)
  expect(saveCase).not.toHaveBeenCalled()
  expect(saveOverall).not.toHaveBeenCalled()
})

it('저장하는 동안 영역 전환을 막고 실패해도 입력을 유지한다', async () => {
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(structuredClone(state))
  let reject!: (reason: Error) => void
  const pending = new Promise<EvaluationReview>((_, fail) => { reject = fail })
  vi.spyOn(opsApi, 'saveFixtureReview').mockReturnValue(pending)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.change(await screen.findByLabelText('평가 기준이 맞나요?'), { target: { value: 'DEFERRED' } })
  fireEvent.change(screen.getByLabelText('판단하기 어려운 이유'), { target: { value: '근거 확인 중' } })
  fireEvent.click(screen.getByLabelText('모든 질문의 공고 내용과 평가 기준을 확인했어요.'))
  fireEvent.click(screen.getByRole('button', { name: '평가 기준 저장' }))
  expect(reviewArea('답변 확인')).toHaveProperty('disabled', true)
  fireEvent.click(reviewArea('답변 확인'))
  expect(reviewArea('평가 기준').getAttribute('aria-pressed')).toBe('true')
  reject(new Error('저장 실패'))
  await screen.findByText('저장 실패')
  expect(reviewArea('답변 확인')).toHaveProperty('disabled', false)
  expect(screen.getByLabelText('판단하기 어려운 이유')).toHaveProperty('value', '근거 확인 중')
  expect(screen.getByLabelText('모든 질문의 공고 내용과 평가 기준을 확인했어요.')).toHaveProperty('checked', true)
})

it('기준 저장 충돌은 초안을 보존하고 이전 결과를 다시 확인하도록 표시한다', async () => {
  const value = approveFixture(structuredClone(state))
  setCurrentQualityResult(value, 'PASS')
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  const save = vi.spyOn(opsApi, 'saveFixtureReview').mockRejectedValue(new opsApi.OpsApiError('다른 검토가 있습니다.', 409))
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  await screen.findByRole('navigation', { name: '답변 검토 영역' })
  fireEvent.click(reviewArea('평가 기준'))
  fireEvent.change(screen.getByLabelText('평가 기준이 맞나요?'), { target: { value: 'DEFERRED' } })
  fireEvent.change(screen.getByLabelText('판단하기 어려운 이유'), { target: { value: '근거 재확인' } })
  fireEvent.click(screen.getByLabelText('모든 질문의 공고 내용과 평가 기준을 확인했어요.'))
  fireEvent.click(screen.getByRole('button', { name: '평가 기준 저장' }))
  await screen.findByText(/다른 검토나 자료 변경이 있습니다/)
  expect(reviewArea('평가 기준').textContent).toContain('작성 중')
  fireEvent.click(reviewArea('답변 확인'))
  expect(document.getElementById('quality-review')!.textContent).toContain('다시 확인 필요')
  fireEvent.click(reviewArea('평가 기준'))
  expect(screen.getByLabelText('판단하기 어려운 이유')).toHaveProperty('value', '근거 재확인')
  expect(screen.getByRole('button', { name: '평가 기준 저장' })).toHaveProperty('disabled', true)
  expect(save).toHaveBeenCalledTimes(1)
})

it.each([
  ['SUITABLE', 'capture', '확인 완료'],
  ['UNSUITABLE', 'capture', '문제 있음'],
  ['DEFERRED', 'capture', '판단 보류'],
  ['SUITABLE', 'old', '다시 확인 필요'],
] as const)('답변 검토 머리말에 최신 %s 판단과 자료 유효 상태를 반영한다', async (decision, capture, expected) => {
  const value = structuredClone(state)
  value.case_reviews = [review(decision, { version: 2, capture_sha256: capture }), review('SUITABLE')]
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  const summary = await screen.findByRole('button', { name: /^답변 확인 ·/ })
  expect(within(summary).getByText(expected)).toBeTruthy()
})

it('일부 질문만 확인했거나 자료가 없는 상태를 완료로 표시하지 않는다', async () => {
  const value = structuredClone(state)
  value.material!.cases.push({ ...value.material!.cases[0], case_id: 'E02', question: '신청 기간은?' })
  value.case_reviews = [review('SUITABLE')]
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  const view = render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  let summary = await screen.findByRole('button', { name: /^답변 확인 ·/ })
  expect(within(summary).getByText('확인 중')).toBeTruthy()
  view.unmount()
  const unavailable = structuredClone(state)
  unavailable.material = null; unavailable.quality!.input_sha256 = null
  vi.mocked(opsApi.getEvaluationReview).mockResolvedValue(unavailable)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  summary = await screen.findByRole('button', { name: /^답변 확인 ·/ })
  expect(within(summary).getByText('확인 불가')).toBeTruthy()
  expect(within(reviewArea('평가 기준')).getByText('확인 불가')).toBeTruthy()
  fireEvent.click(reviewArea('전체·비교'))
  expect(within(document.getElementById('quality-review')!).getByText('확인 불가')).toBeTruthy()
})

it('질문·전체 검토의 작성 상태와 오래된 비교 기준을 구분한다', async () => {
  const value = structuredClone(state)
  value.is_baseline = true; value.baseline_requires_review = true
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  const answer = await screen.findByRole('button', { name: /^답변 확인 ·/ })
  const overall = reviewArea('전체·비교')
  expect(within(answer).getByText('확인 전')).toBeTruthy()
  expect(within(overall).getByText('기준 재확인 필요')).toBeTruthy()
  fireEvent.click(answer)
  expect(screen.queryByText('비교 기준 다시 확인 필요')).toBeNull()
  expect(screen.getByText(/이전에 지정한 비교 기준을 다시 검토해야 합니다/)).toBeTruthy()
  fireEvent.change(screen.getByLabelText('E01 판단'), { target: { value: 'DEFERRED' } })
  expect(within(answer).getByText('작성 중')).toBeTruthy()
  fireEvent.click(overall)
  expect(within(screen.getByRole('region', { name: '다음 평가의 비교 기준' })).getByText('비교 기준을 다시 확인해야 해요.')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('검토 의견'), { target: { value: '저장 전 의견' } })
  expect(within(overall).getByText('작성 중')).toBeTruthy()
})

it('유효한 비교 기준만 사용 중으로 표시하고 없는 경우 선택으로 표시한다', async () => {
  const value = structuredClone(state)
  value.is_baseline = true; value.baseline_requires_review = false; value.approval_current = true; value.can_promote = true
  value.quality!.is_current = true; value.quality!.status = 'PASS'
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  const view = render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  let summary = await screen.findByRole('button', { name: /^전체·비교/ })
  expect(within(summary).getByText('비교 기준 사용 중')).toBeTruthy()
  view.unmount()
  vi.mocked(opsApi.getEvaluationReview).mockResolvedValue(structuredClone(state))
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  summary = await screen.findByRole('button', { name: /^전체·비교/ })
  expect(within(summary).getByText('선택')).toBeTruthy()
})

it('전체 답변 결과는 전체 비교 안에 있고 별도 결과 탭은 없다', async () => {
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(state)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  const answer = await screen.findByRole('button', { name: /^답변 확인 ·/ })
  const fixture = reviewArea('평가 기준')
  const overall = reviewArea('전체·비교')
  expect(fixture.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(answer.compareDocumentPosition(overall) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(within(screen.getByRole('navigation', { name: '답변 검토 영역' })).queryByRole('button', { name: /^최종 결과/ })).toBeNull()
  fireEvent.click(answer)
  const result = document.getElementById('quality-review')!
  expect(result.closest('[hidden]')).not.toBeNull()
  fireEvent.click(overall)
  expect(result.closest('[hidden]')).toBeNull()
  expect(result.compareDocumentPosition(screen.getByRole('heading', { name: /^전체 검토$/ })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

it('기준 확인과 결과 판정은 각각 별도의 저장을 실행한다', async () => {
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(state)
  const saveFixture = vi.spyOn(opsApi, 'saveFixtureReview').mockResolvedValue(structuredClone(state))
  const assess = vi.spyOn(opsApi, 'assessEvaluationQuality').mockResolvedValue(structuredClone(state))
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  const select = await screen.findByLabelText('평가 기준이 맞나요?')
  fireEvent.change(select, { target: { value: 'APPROVED' } })
  fireEvent.click(screen.getByRole('checkbox', { name: '모든 질문의 공고 내용과 평가 기준을 확인했어요.' }))
  fireEvent.click(screen.getByRole('button', { name: '평가 기준 저장' }))
  await waitFor(() => expect(saveFixture).toHaveBeenCalledTimes(1))
  expect(assess).not.toHaveBeenCalled()
  const result = document.getElementById('quality-review')!
  fireEvent.click(reviewArea('전체·비교'))
  const assessButton = within(result).getByRole('button', { name: '결과 판정하기' })
  await waitFor(() => expect(assessButton).toHaveProperty('disabled', false))
  fireEvent.click(assessButton)
  await waitFor(() => expect(assess).toHaveBeenCalledWith('run', 'input'))
  expect(saveFixture).toHaveBeenCalledTimes(1)
})

it.each(['DEFERRED', 'MISSING', 'ALL_REVIEWED'] as const)('기준 승인 뒤 확인이 필요한 질문부터 이동한다: %s', async (scenario) => {
  const initial = structuredClone(state)
  initial.material!.cases.push({ ...initial.material!.cases[0], case_id: 'E02', question: '신청 기간은?' })
  initial.case_reviews = scenario === 'MISSING' ? [review('SUITABLE')]
    : [review(scenario === 'DEFERRED' ? 'DEFERRED' : 'UNSUITABLE', { id: 2, version: 2, case_id: 'E02' }), review('SUITABLE')]
  const approved = approveFixture(structuredClone(initial))
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(initial)
  const saveFixture = vi.spyOn(opsApi, 'saveFixtureReview').mockResolvedValue(approved)
  const saveCase = vi.spyOn(opsApi, 'saveEvaluationCaseReview')
  const assess = vi.spyOn(opsApi, 'assessEvaluationQuality')
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  const select = await screen.findByLabelText('평가 기준이 맞나요?')
  fireEvent.change(select, { target: { value: 'APPROVED' } })
  fireEvent.click(screen.getByRole('checkbox', { name: '모든 질문의 공고 내용과 평가 기준을 확인했어요.' }))
  fireEvent.click(screen.getByRole('button', { name: '평가 기준 저장' }))
  const criterion = screen.getByRole('region', { name: '평가 기준' })
  await within(criterion).findByText('평가 기준 확인 결과를 저장했어요.')
  if (scenario === 'ALL_REVIEWED') {
    expect(within(criterion).queryByRole('button', { name: '전체 답변 결과 보기' })).toBeNull()
    expect(saveCase).not.toHaveBeenCalled()
    expect(assess).not.toHaveBeenCalled()
    return
  }
  const next = await within(criterion).findByRole('button', { name: '답변 확인하기' })
  expect(saveFixture).toHaveBeenCalledTimes(1)
  fireEvent.click(next)
  const target = 'case-review-E02'
  await waitFor(() => expect(document.activeElement?.id).toBe(target))
  expect(document.getElementById(target)?.scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
  expect(screen.getByLabelText('확인할 질문')).toHaveProperty('value', 'E02')
  expect(saveCase).not.toHaveBeenCalled()
  expect(assess).not.toHaveBeenCalled()
})

it('기준 저장이 실패하면 답변 확인 이동을 제안하지 않는다', async () => {
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(structuredClone(state))
  vi.spyOn(opsApi, 'saveFixtureReview').mockRejectedValue(new Error('저장 실패'))
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.change(await screen.findByLabelText('평가 기준이 맞나요?'), { target: { value: 'APPROVED' } })
  fireEvent.click(screen.getByRole('checkbox', { name: '모든 질문의 공고 내용과 평가 기준을 확인했어요.' }))
  fireEvent.click(screen.getByRole('button', { name: '평가 기준 저장' }))
  const criterion = screen.getByRole('region', { name: '평가 기준' })
  expect(await within(criterion).findByRole('alert')).toHaveProperty('textContent', '저장 실패')
  expect(within(criterion).queryByRole('button', { name: '답변 확인하기' })).toBeNull()
})

it.each(['CHANGES_REQUESTED', 'DEFERRED'] as const)('기준 %s 저장에는 답변 확인 이동을 제안하지 않는다', async (decision) => {
  const saved = approveFixture(structuredClone(state))
  saved.quality!.fixture_reviews[0].decision = decision
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(structuredClone(state))
  vi.spyOn(opsApi, 'saveFixtureReview').mockResolvedValue(saved)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.change(await screen.findByLabelText('평가 기준이 맞나요?'), { target: { value: decision } })
  fireEvent.change(screen.getByLabelText(decision === 'DEFERRED' ? '판단하기 어려운 이유' : '어떤 점을 고쳐야 하나요?'), { target: { value: '확인한 내용' } })
  fireEvent.click(screen.getByRole('checkbox', { name: '모든 질문의 공고 내용과 평가 기준을 확인했어요.' }))
  fireEvent.click(screen.getByRole('button', { name: '평가 기준 저장' }))
  const criterion = screen.getByRole('region', { name: '평가 기준' })
  expect(await within(criterion).findByText('평가 기준 확인 결과를 저장했어요.')).toBeTruthy()
  expect(within(criterion).queryByRole('button', { name: '답변 확인하기' })).toBeNull()
})

it('기준 승인 후 새로 판단을 입력하면 이전 이동 안내를 숨긴다', async () => {
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(structuredClone(state))
  vi.spyOn(opsApi, 'saveFixtureReview').mockResolvedValue(approveFixture(structuredClone(state)))
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  const select = await screen.findByLabelText('평가 기준이 맞나요?')
  fireEvent.change(select, { target: { value: 'APPROVED' } })
  fireEvent.click(screen.getByRole('checkbox', { name: '모든 질문의 공고 내용과 평가 기준을 확인했어요.' }))
  fireEvent.click(screen.getByRole('button', { name: '평가 기준 저장' }))
  const criterion = screen.getByRole('region', { name: '평가 기준' })
  await within(criterion).findByRole('button', { name: '답변 확인하기' })
  fireEvent.change(select, { target: { value: 'DEFERRED' } })
  expect(within(criterion).queryByRole('button', { name: '답변 확인하기' })).toBeNull()
})

it('문제 있는 답변을 저장해도 결과 판정은 선택 사항으로 남는다', async () => {
  const initial = approveFixture(structuredClone(state))
  const saved = structuredClone(initial)
  saved.case_reviews = [review('UNSUITABLE')]
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(initial)
  const saveCase = vi.spyOn(opsApi, 'saveEvaluationCaseReview').mockResolvedValue(saved)
  const assess = vi.spyOn(opsApi, 'assessEvaluationQuality')
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^답변 확인 ·/ }))
  fireEvent.change(screen.getByLabelText('E01 판단'), { target: { value: 'UNSUITABLE' } })
  fireEvent.change(screen.getByLabelText(/^E01 (어떤 문제가 있나요|무엇을 더 확인해야 하나요)\?$/), { target: { value: '답변 내용 확인' } })
  fireEvent.click(screen.getByRole('button', { name: 'E01 검토 저장' }))
  const article = document.getElementById('case-review-E01')!
  await within(article).findByText('저장했어요.')
  expect(within(article).queryByRole('button', { name: '전체 답변 결과 보기' })).toBeNull()
  expect(saveCase).toHaveBeenCalledTimes(1)
  expect(within(reviewArea('답변 확인')).getByText('문제 있음')).toBeTruthy()
  fireEvent.click(reviewArea('전체·비교'))
  expect(document.getElementById('quality-review')!.closest('[hidden]')).toBeNull()
  expect(assess).not.toHaveBeenCalled()
})

it.each(['DEFERRED', 'MISSING'] as const)('보류 또는 확인 전 질문이 남으면 결과 판정 이동을 제안하지 않는다: %s', async (scenario) => {
  const initial = structuredClone(state)
  if (scenario === 'MISSING') initial.material!.cases.push({ ...initial.material!.cases[0], case_id: 'E02', question: '신청 기간은?' })
  approveFixture(initial)
  const saved = structuredClone(initial)
  saved.case_reviews = [review(scenario === 'DEFERRED' ? 'DEFERRED' : 'SUITABLE')]
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(initial)
  vi.spyOn(opsApi, 'saveEvaluationCaseReview').mockResolvedValue(saved)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^답변 확인 ·/ }))
  fireEvent.change(screen.getByLabelText('E01 판단'), { target: { value: scenario === 'DEFERRED' ? 'DEFERRED' : 'SUITABLE' } })
  if (scenario === 'DEFERRED') fireEvent.change(screen.getByLabelText(/^E01 (어떤 문제가 있나요|무엇을 더 확인해야 하나요)\?$/), { target: { value: '확인한 내용' } })
  fireEvent.click(screen.getByRole('button', { name: 'E01 검토 저장' }))
  const article = document.getElementById('case-review-E01')!
  await within(article).findByText('저장했어요.')
  expect(within(article).queryByRole('button', { name: '전체 답변 결과 보기' })).toBeNull()
  if (scenario === 'MISSING') {
    fireEvent.click(within(article).getByRole('button', { name: '확인이 필요한 질문으로 이동' }))
    await waitFor(() => expect(document.activeElement?.id).toBe('case-review-E02'))
  } else expect(within(article).queryByRole('button', { name: '확인이 필요한 질문으로 이동' })).toBeNull()
})

it.each([
  ['E01', 'DEFERRED', 'E02'],
  ['E02', 'SUITABLE', 'E01'],
] as const)('질문 %s 저장 뒤 다른 미완료 질문 %s로 안내한다', async (currentId, decision, nextId) => {
  const initial = structuredClone(state)
  initial.material!.cases.push({ ...initial.material!.cases[0], case_id: 'E02', question: '신청 기간은?' })
  approveFixture(initial)
  const saved = structuredClone(initial)
  saved.case_reviews = [review(decision, { case_id: currentId })]
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(initial)
  const saveCase = vi.spyOn(opsApi, 'saveEvaluationCaseReview').mockResolvedValue(saved)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^답변 확인 ·/ }))
  if (currentId !== 'E01') fireEvent.change(screen.getByLabelText('확인할 질문'), { target: { value: currentId } })
  fireEvent.change(screen.getByLabelText(`${currentId} 판단`), { target: { value: decision } })
  if (decision !== 'SUITABLE') fireEvent.change(screen.getByLabelText(new RegExp(`^${currentId} (어떤 문제가 있나요|무엇을 더 확인해야 하나요)\\?$`)), { target: { value: '확인한 내용' } })
  fireEvent.click(screen.getByRole('button', { name: `${currentId} 검토 저장` }))
  const article = document.getElementById(`case-review-${currentId}`)!
  fireEvent.click(await within(article).findByRole('button', { name: '확인이 필요한 질문으로 이동' }))
  await waitFor(() => expect(document.activeElement?.id).toBe(`case-review-${nextId}`))
  expect(saveCase).toHaveBeenCalledTimes(1)
})

it.each(['OTHER_DRAFT', 'FIXTURE_DRAFT', 'NO_INPUT', 'FIXTURE_NOT_APPROVED'] as const)('판정이 잠기는 상태에서는 결과 이동을 제안하지 않는다: %s', async (scenario) => {
  const initial = structuredClone(state)
  initial.material!.cases.push({ ...initial.material!.cases[0], case_id: 'E02', question: '신청 기간은?' })
  approveFixture(initial)
  initial.case_reviews = [review('SUITABLE', { id: 2, version: 2, case_id: 'E02' })]
  const saved = structuredClone(initial)
  saved.case_reviews.unshift(review('SUITABLE', { id: 3, version: 3 }))
  if (scenario === 'NO_INPUT') saved.quality!.input_sha256 = null
  if (scenario === 'FIXTURE_NOT_APPROVED') saved.quality!.fixture_reviews[0].decision = 'DEFERRED'
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(initial)
  vi.spyOn(opsApi, 'saveEvaluationCaseReview').mockResolvedValue(saved)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^답변 확인 ·/ }))
  if (scenario === 'OTHER_DRAFT') {
    fireEvent.change(screen.getByLabelText('확인할 질문'), { target: { value: 'E02' } })
    fireEvent.change(screen.getByLabelText('E02 판단'), { target: { value: 'DEFERRED' } })
    fireEvent.change(screen.getByLabelText(/^E02 (어떤 문제가 있나요|무엇을 더 확인해야 하나요)\?$/), { target: { value: '남겨 둘 초안' } })
    fireEvent.change(screen.getByLabelText('확인할 질문'), { target: { value: 'E01' } })
  }
  fireEvent.change(screen.getByLabelText('E01 판단'), { target: { value: 'SUITABLE' } })
  fireEvent.click(screen.getByRole('button', { name: 'E01 검토 저장' }))
  const article = document.getElementById('case-review-E01')!
  await within(article).findByText('저장했어요.')
  if (scenario === 'FIXTURE_DRAFT') {
    fireEvent.click(reviewArea('평가 기준'))
    const fixture = document.getElementById('fixture-review') as HTMLDetailsElement
    fireEvent.click(fixture.querySelector('summary')!)
    fireEvent.change(within(fixture).getByLabelText('평가 기준이 맞나요?'), { target: { value: 'DEFERRED' } })
  }
  expect(within(article).queryByRole('button', { name: '전체 답변 결과 보기' })).toBeNull()
})

it('평가 기준을 확인하면서 같은 질문의 답변을 이동 없이 펼쳐 본다', async () => {
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(state)
  const saveFixture = vi.spyOn(opsApi, 'saveFixtureReview')
  const saveCase = vi.spyOn(opsApi, 'saveEvaluationCaseReview')
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  const answerToggle = await screen.findByText('이 질문의 답변 보기')
  expect(screen.queryByRole('button', { name: '평가 기준 확인하기' })).toBeNull()
  const panel = reviewArea('답변 확인')
  expect(panel.getAttribute('aria-pressed')).toBe('false')
  const fixture = document.getElementById('fixture-review')!
  expect(panel.contains(fixture)).toBe(false)
  expect(reviewArea('평가 기준').getAttribute('aria-pressed')).toBe('true')
  const answer = answerToggle.closest('details')!
  expect(within(fixture).getByRole('region', { name: '기준을 확인할 자료' }).contains(answer)).toBe(true)
  expect(answer.open).toBe(false)
  fireEvent.click(answerToggle)
  expect(answer.open).toBe(true)
  expect(within(answer).getByText('서울 기업입니다.')).toBeTruthy()
  expect(panel.getAttribute('aria-pressed')).toBe('false')
  expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled()
  expect(saveFixture).not.toHaveBeenCalled()
  expect(saveCase).not.toHaveBeenCalled()
  fireEvent.click(answerToggle)
  expect(answer.open).toBe(false)
})

it.each(['', '   \n'])('저장된 답변이 비었을 때 안내한다', async (text) => {
  const value = structuredClone(state)
  value.material!.cases[0].answer = text
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByText('이 질문의 답변 보기'))
  expect(within(screen.getByRole('region', { name: '기준을 확인할 자료' })).getByText('저장된 답변이 없어요.')).toBeTruthy()
})

it('긴 답변의 줄바꿈을 유지하며 검토 초안이 있어도 확인할 수 있다', async () => {
  const value = structuredClone(state)
  const text = `첫 줄\n${'긴답변'.repeat(200)}\n마지막 줄`
  value.material!.cases[0].answer = text
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  const save = vi.spyOn(opsApi, 'saveEvaluationCaseReview')
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^답변 확인 ·/ }))
  fireEvent.change(screen.getByLabelText('E01 판단'), { target: { value: 'DEFERRED' } })
  const toggle = screen.getByText('이 질문의 답변 보기')
  fireEvent.click(toggle)
  const answer = toggle.closest('details')!
  expect(answer.querySelector('p')?.textContent).toBe(text)
  expect(answer.querySelector('p')?.className).toContain('[overflow-wrap:anywhere]')
  expect(screen.getByLabelText('E01 판단')).toHaveProperty('value', 'DEFERRED')
  expect(save).not.toHaveBeenCalled()
})

it.each([
  ['admin-authored', '관리자가 작성한 답변 기준'],
  ['ai-authored', 'AI가 작성한 답변 기준'],
  [undefined, '답변 기준'],
] as const)('기준 출처 %s를 하나의 제목으로 표시한다', async (source, heading) => {
  const value = structuredClone(state)
  value.material!.reference_source = source
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  const section = await screen.findByRole('region', { name: '기준을 확인할 자료' })
  expect(within(section).getByRole('heading', { name: heading })).toBeTruthy()
  expect(within(section).queryByText('관리자가 작성한 기준')).toBeNull()
  expect(within(section).getByText('답변 가능 여부').nextElementSibling?.textContent).toBe('공고 내용으로 답변 가능')
  expect(within(section).getByText('답변에 표시할 공고 내용 번호').nextElementSibling?.textContent).toBe('1')
  expect(within(section).getByText('답변에 포함할 내용').nextElementSibling?.textContent).toBe('지정된 내용 없음')
  expect(within(section).getByText('답변에 포함하면 안 되는 내용').nextElementSibling?.textContent).toBe('지정된 내용 없음')
})

it('평가 기준 양식에서 질문별 공고와 기준을 비교해도 작성 중인 판단은 보존된다', async () => {
  const value = structuredClone(state)
  const first = value.material!.cases[0]
  first.reference_facts = ['첫 질문의 확인할 사실']
  first.forbidden_claims = ['첫 질문의 주의할 주장']
  const longQuestion = '신청 기간과 함께 제출해야 할 서류는 무엇이며, 신청 전에 따로 확인해야 하는 조건이 있나요?'
  value.material!.cases.push({ ...first, case_id: 'E02', question: longQuestion,
    evidence: [{ order: 0, text: '7월까지 신청' }], reference_facts: ['두 번째 질문의 확인할 사실'],
    forbidden_claims: ['두 번째 질문의 주의할 주장'], answer: '두 번째 질문의 답변입니다.' })
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  const save = vi.spyOn(opsApi, 'saveFixtureReview')
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  await screen.findByText('이 질문의 답변 보기')
  const fixture = document.getElementById('fixture-review')!
  const section = within(fixture).getByRole('region', { name: '기준을 확인할 자료' })
  expect(within(section).getByText('지원 대상은?')).toBeTruthy()
  expect(within(section).getByText('서울 기업')).toBeTruthy()
  expect(within(section).getByText(/첫 질문의 확인할 사실/)).toBeTruthy()
  expect(within(section).getByText(/첫 질문의 주의할 주장/)).toBeTruthy()
  const confirmed = within(fixture).getByRole('checkbox', { name: '모든 질문의 공고 내용과 평가 기준을 확인했어요.' })
  expect(confirmed).toHaveProperty('checked', false)
  fireEvent.change(within(fixture).getByLabelText('평가 기준이 맞나요?'), { target: { value: 'DEFERRED' } })
  fireEvent.change(within(fixture).getByLabelText('판단하기 어려운 이유'), { target: { value: '검토 중인 의견' } })
  fireEvent.click(within(section).getByText('이 질문의 답변 보기'))
  expect(within(section).getByText('서울 기업입니다.')).toBeTruthy()
  const select = within(fixture).getByLabelText('질문 선택')
  expect(within(select).getByRole('option', { name: '1번째 질문' })).toBeTruthy()
  const secondOption = within(select).getByRole('option', { name: '2번째 질문' })
  expect(within(section).getAllByText('지원 대상은?')).toHaveLength(1)
  expect(within(section).getByRole('button', { name: '기준의 이전 질문' })).toHaveProperty('disabled', true)
  expect(within(section).getByRole('button', { name: '기준의 다음 질문' })).toHaveProperty('disabled', false)
  fireEvent.click(within(section).getByRole('button', { name: '기준의 다음 질문' }))
  expect(within(section).getAllByText(longQuestion)).toHaveLength(1)
  const secondAnswer = within(section).getByText('이 질문의 답변 보기').closest('details')!
  expect(secondAnswer.open).toBe(false)
  fireEvent.click(within(section).getByText('이 질문의 답변 보기'))
  expect(within(secondAnswer).getByText('두 번째 질문의 답변입니다.')).toBeTruthy()
  expect(within(section).queryByText('서울 기업입니다.')).toBeNull()
  expect(within(section).getByText('7월까지 신청')).toBeTruthy()
  expect(within(section).getByText(/두 번째 질문의 확인할 사실/)).toBeTruthy()
  expect(within(section).getByText(/두 번째 질문의 주의할 주장/)).toBeTruthy()
  expect(within(section).queryByText('서울 기업')).toBeNull()
  expect(within(section).getByRole('button', { name: '기준의 이전 질문' })).toHaveProperty('disabled', false)
  expect(within(section).getByRole('button', { name: '기준의 다음 질문' })).toHaveProperty('disabled', true)
  expect(within(fixture).getByLabelText('평가 기준이 맞나요?')).toHaveProperty('value', 'DEFERRED')
  expect(within(fixture).getByLabelText('판단하기 어려운 이유')).toHaveProperty('value', '검토 중인 의견')
  expect(confirmed).toHaveProperty('checked', false)
  fireEvent.click(confirmed)
  fireEvent.click(within(section).getByRole('button', { name: '기준의 이전 질문' }))
  expect(within(section).getAllByText('지원 대상은?')).toHaveLength(1)
  fireEvent.change(select, { target: { value: (secondOption as HTMLOptionElement).value } })
  expect(within(section).getAllByText(longQuestion)).toHaveLength(1)
  expect(confirmed).toHaveProperty('checked', true)
  expect(within(fixture).getByLabelText('판단하기 어려운 이유')).toHaveProperty('value', '검토 중인 의견')
  expect(save).not.toHaveBeenCalled()
})

it('검토를 닫았다 다시 열어도 작성 중인 판단을 유지한다', async () => {
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(state)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  const summary = await screen.findByRole('button', { name: /^답변 확인 ·/ })
  fireEvent.click(summary)
  fireEvent.change(screen.getByLabelText('E01 판단'), { target: { value: 'DEFERRED' } })
  fireEvent.change(screen.getByLabelText(/^E01 (어떤 문제가 있나요|무엇을 더 확인해야 하나요)\?$/), { target: { value: '내용 확인 중' } })
  fireEvent.click(summary)
  fireEvent.click(summary)
  expect(screen.getByLabelText('E01 판단')).toHaveProperty('value', 'DEFERRED')
  expect(screen.getByLabelText(/^E01 (어떤 문제가 있나요|무엇을 더 확인해야 하나요)\?$/)).toHaveProperty('value', '내용 확인 중')
})

it('질문 검토와 전체 검토를 따로 열어도 작성한 내용을 보존한다', async () => {
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(state)
  const save = vi.spyOn(opsApi, 'saveEvaluationCaseReview')
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  const questionSummary = await screen.findByRole('button', { name: /^답변 확인 ·/ })
  const overallSummary = reviewArea('전체·비교')
  expect(questionSummary.getAttribute('aria-pressed')).toBe('false')
  expect(overallSummary.getAttribute('aria-pressed')).toBe('false')
  fireEvent.click(questionSummary)
  fireEvent.change(screen.getByLabelText('E01 판단'), { target: { value: 'DEFERRED' } })
  fireEvent.change(screen.getByLabelText(/^E01 (어떤 문제가 있나요|무엇을 더 확인해야 하나요)\?$/), { target: { value: '자료를 확인하는 중' } })
  fireEvent.click(overallSummary)
  expect(overallSummary.getAttribute('aria-pressed')).toBe('true')
  expect(questionSummary.getAttribute('aria-pressed')).toBe('false')
  fireEvent.change(screen.getByLabelText('검토 의견'), { target: { value: '전체 의견 초안' } })
  fireEvent.click(questionSummary)
  expect(screen.getByLabelText('E01 판단')).toHaveProperty('value', 'DEFERRED')
  expect(screen.getByLabelText(/^E01 (어떤 문제가 있나요|무엇을 더 확인해야 하나요)\?$/)).toHaveProperty('value', '자료를 확인하는 중')
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
  const summary = await screen.findByRole('button', { name: /^답변 확인 ·/ })
  fireEvent.click(summary)
  fireEvent.change(screen.getByLabelText('E01 판단'), { target: { value: 'DEFERRED' } })
  fireEvent.change(screen.getByLabelText(/^E01 (어떤 문제가 있나요|무엇을 더 확인해야 하나요)\?$/), { target: { value: '검토 중인 내용' } })
  fireEvent.change(screen.getByLabelText('확인할 질문'), { target: { value: 'E02' } })
  expect(screen.getByLabelText('E02 판단')).toBeTruthy()
  fireEvent.click(reviewArea('평가 기준'))
  expect(summary.getAttribute('aria-pressed')).toBe('false')
  fireEvent.click(screen.getByRole('button', { name: '작성 중인 답변으로 이동' }))
  await waitFor(() => expect(document.activeElement?.id).toBe('case-review-E01'))
  expect(summary.getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByLabelText('E01 판단')).toHaveProperty('value', 'DEFERRED')
  expect(screen.getByLabelText(/^E01 (어떤 문제가 있나요|무엇을 더 확인해야 하나요)\?$/)).toHaveProperty('value', '검토 중인 내용')
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

it.each([
  ['미검토', false, false, '확인 전'],
  ['일부 확인', true, false, '확인 중'],
  ['모두 확인', true, true, '확인 완료'],
] as const)('답변 %s와 전체 검토 승인 전을 각 영역에 구분해 표시한다', async (_name, firstReviewed, secondReviewed, questionStatus) => {
  const value = structuredClone(state)
  value.material!.cases.push({ ...value.material!.cases[0], case_id: 'E02', question: '신청 방법은?' })
  value.case_reviews = [
    ...(firstReviewed ? [review('SUITABLE')] : []),
    ...(secondReviewed ? [review('SUITABLE', { id: 2, case_id: 'E02' })] : []),
  ]
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  const save = vi.spyOn(opsApi, 'saveEvaluationCaseReview')
  const approve = vi.spyOn(opsApi, 'saveEvaluationReview')
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  const answer = await screen.findByRole('button', { name: /^답변 확인 ·/ })
  expect(within(answer).getByText(questionStatus)).toBeTruthy()
  fireEvent.click(answer)
  const questionArea = within(screen.getByRole('region', { name: '질문과 답변 검토하기' }))
  expect(questionArea.queryByText('미검토')).toBeNull()
  expect(questionArea.queryByText('승인 전')).toBeNull()
  fireEvent.click(reviewArea('전체·비교'))
  expect(within(screen.getByRole('region', { name: '전체 검토' })).getByText('승인 전')).toBeTruthy()
  expect(save).not.toHaveBeenCalled()
  expect(approve).not.toHaveBeenCalled()
})

it.each([
  [false, '이 결과를 비교 기준으로 사용 중이에요.'],
  [true, '비교 기준을 다시 확인해야 해요.'],
] as const)('전체 승인과 비교 기준 상태를 독립적으로 보여준다: 재확인 %s', async (stale, baselineText) => {
  const value = readyForOverall(true)
  value.is_baseline = true
  value.baseline_requires_review = stale
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^답변 확인 ·/ }))
  const answers = within(screen.getByRole('region', { name: '질문과 답변 검토하기' }))
  expect(answers.queryByText('검토 승인')).toBeNull()
  expect(answers.queryByText('지금 비교에 쓰는 결과')).toBeNull()
  fireEvent.click(reviewArea('전체·비교'))
  expect(within(screen.getByRole('region', { name: '전체 검토' })).getByText('승인 완료')).toBeTruthy()
  expect(within(screen.getByRole('region', { name: '다음 평가의 비교 기준' })).getByText(baselineText)).toBeTruthy()
})

it('이전 전체 승인 기록은 질문 상태와 구분하고 전체 검토에서 재확인을 안내한다', async () => {
  const value = readyForOverall()
  value.reviews = [{ id: 1, version: 1, decision: 'APPROVED', comment: '이전 승인', capture_sha256: 'old', fixture_sha256: 'old', rubric_version: 'old', case_review_ids: [], reviewed_by: 'admin', created_at: '2026-10-03T00:00:00Z' }]
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^답변 확인 ·/ }))
  expect(within(screen.getByRole('region', { name: '질문과 답변 검토하기' })).queryByText(/이전 승인/)).toBeNull()
  fireEvent.click(reviewArea('전체·비교'))
  const overall = within(screen.getByRole('region', { name: '전체 검토' }))
  expect(overall.getByText('다시 확인 필요')).toBeTruthy()
  fireEvent.click(overall.getByText('검토 이력 · 1건'))
  expect(overall.getByText('이전 승인')).toBeTruthy()
})

it('저장 충돌에서는 전체 검토를 다시 확인하도록 표시하고 답변 초안을 보존한다', async () => {
  const value = readyForOverall(true)
  value.is_baseline = true
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  vi.spyOn(opsApi, 'saveEvaluationCaseReview').mockRejectedValue(new opsApi.OpsApiError('저장 충돌', 409))
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^답변 확인 ·/ }))
  fireEvent.change(screen.getByLabelText('E01 판단'), { target: { value: 'UNSUITABLE' } })
  fireEvent.change(screen.getByLabelText('E01 어떤 문제가 있나요?'), { target: { value: '확인할 내용' } })
  fireEvent.click(screen.getByRole('button', { name: 'E01 검토 저장' }))
  await screen.findByText('저장 충돌')
  fireEvent.click(reviewArea('전체·비교'))
  expect(within(screen.getByRole('region', { name: '전체 검토' })).getByText('다시 확인 필요')).toBeTruthy()
  const baseline = within(screen.getByRole('region', { name: '다음 평가의 비교 기준' }))
  expect(baseline.getByText('비교 기준 상태를 다시 확인해 주세요.')).toBeTruthy()
  expect(baseline.queryByText('이 결과를 비교 기준으로 사용 중이에요.')).toBeNull()
  fireEvent.click(reviewArea('답변 확인'))
  expect(screen.getByLabelText('E01 판단')).toHaveProperty('value', 'UNSUITABLE')
  expect(screen.getByLabelText('E01 어떤 문제가 있나요?')).toHaveProperty('value', '확인할 내용')
})

it('전체 검토와 비교 기준을 구분하고 차단된 이유를 해당 작업에 보여준다', async () => {
  const value = readyForOverall()
  value.can_approve = false
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  const save = vi.spyOn(opsApi, 'saveEvaluationReview')
  const promote = vi.spyOn(opsApi, 'promoteEvaluationBaseline')
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^전체·비교/ }))
  const overall = within(screen.getByRole('region', { name: '전체 검토' }))
  const baseline = within(screen.getByRole('region', { name: '다음 평가의 비교 기준' }))
  expect(overall.getByText('승인하려면 모든 답변을 문제없음으로 저장해 주세요.')).toBeTruthy()
  expect(overall.getByRole('button', { name: '검토 승인 저장' })).toHaveProperty('disabled', true)
  expect(baseline.getByText('전체 검토를 승인한 뒤 지정할 수 있어요.')).toBeTruthy()
  expect(baseline.getByRole('button', { name: '비교 기준으로 지정' })).toHaveProperty('disabled', true)
  expect(save).not.toHaveBeenCalled()
  expect(promote).not.toHaveBeenCalled()
})

it('기준 해제 이유는 전체 의견과 분리하고 명시적인 해제에만 전송한다', async () => {
  const value = readyForOverall()
  value.is_baseline = true
  value.baseline_version = 3
  const result = { ...value, is_baseline: false, baseline_version: 4 }
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  const clear = vi.spyOn(opsApi, 'clearEvaluationBaseline').mockResolvedValue(result)
  const save = vi.spyOn(opsApi, 'saveEvaluationReview')
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^전체·비교/ }))
  fireEvent.change(screen.getByLabelText('검토 의견'), { target: { value: '전체 의견 초안' } })
  fireEvent.click(screen.getByText('비교 기준 해제하기'))
  fireEvent.change(screen.getByLabelText('기준 해제 이유'), { target: { value: '기준 수정 필요' } })
  fireEvent.click(reviewArea('답변 확인'))
  fireEvent.click(reviewArea('전체·비교'))
  expect(screen.getByLabelText('검토 의견')).toHaveProperty('value', '전체 의견 초안')
  expect(screen.getByLabelText('기준 해제 이유')).toHaveProperty('value', '기준 수정 필요')
  expect(clear).not.toHaveBeenCalled()
  expect(save).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '비교 기준 해제' }))
  await waitFor(() => expect(clear).toHaveBeenCalledExactlyOnceWith('run', 3, '기준 수정 필요'))
  expect(screen.getByLabelText('검토 의견')).toHaveProperty('value', '전체 의견 초안')
})

it('전체 검토 저장으로 비교 기준이 해제돼도 작성 중이던 해제 이유를 보존한다', async () => {
  const value = readyForOverall()
  value.is_baseline = true
  const result = { ...value, is_baseline: false, approval_current: true }
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  const save = vi.spyOn(opsApi, 'saveEvaluationReview').mockResolvedValue(result)
  const clear = vi.spyOn(opsApi, 'clearEvaluationBaseline')
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^전체·비교/ }))
  fireEvent.change(screen.getByLabelText('검토 의견'), { target: { value: '전체 검토 의견' } })
  fireEvent.click(screen.getByLabelText('모든 질문과 공고 내용, 답변을 확인했어요.'))
  fireEvent.click(screen.getByText('비교 기준 해제하기'))
  fireEvent.change(screen.getByLabelText('기준 해제 이유'), { target: { value: '미완성 해제 이유' } })
  fireEvent.click(screen.getByRole('button', { name: '검토 승인 저장' }))
  await waitFor(() => expect(save).toHaveBeenCalledExactlyOnceWith('run', 'APPROVED', '전체 검토 의견', expect.objectContaining({ review_version: 0 })))
  expect(screen.getByLabelText('기준 해제 이유')).toHaveProperty('value', '미완성 해제 이유')
  expect(screen.getByText('비교 기준이 해제되어 작성 중이던 이유는 저장되지 않았어요.')).toBeTruthy()
  expect(clear).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '작성한 이유 지우기' }))
  expect(screen.queryByLabelText('기준 해제 이유')).toBeNull()
})

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
  await screen.findByRole('button', { name: /^답변 확인 ·/ })
  expect(reviewArea('평가 기준').getAttribute('aria-pressed')).toBe(String(status !== '현재 승인'))
  expect(screen.queryByRole('button', { name: '평가 기준 확인하기' })).toBeNull()
  expect(save).not.toHaveBeenCalled()
})

it('기준과 답변 확인을 전환해도 작성 내용을 유지한다', async () => {
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(state)
  const save = vi.spyOn(opsApi, 'saveFixtureReview')
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  await screen.findByLabelText('평가 기준이 맞나요?')
  const fixture = document.getElementById('fixture-review')!
  const fixtureSummary = reviewArea('평가 기준')
  const finalSummary = reviewArea('답변 확인')
  expect(fixtureSummary.getAttribute('aria-pressed')).toBe('true')
  expect(finalSummary.getAttribute('aria-pressed')).toBe('false')
  for (const summary of [fixtureSummary, finalSummary]) {
    expect(summary.className).toContain('min-h-11')
    summary.focus()
    expect(document.activeElement).toBe(summary)
  }
  fireEvent.change(within(fixture).getByLabelText('평가 기준이 맞나요?'), { target: { value: 'DEFERRED' } })
  fireEvent.change(within(fixture).getByLabelText('판단하기 어려운 이유'), { target: { value: '확인 중' } })
  fireEvent.click(finalSummary)
  expect(finalSummary.getAttribute('aria-pressed')).toBe('true')
  expect(fixtureSummary.getAttribute('aria-pressed')).toBe('false')
  fireEvent.click(fixtureSummary)
  expect(fixtureSummary.getAttribute('aria-pressed')).toBe('true')
  expect(within(fixture).getByLabelText('평가 기준이 맞나요?')).toHaveProperty('value', 'DEFERRED')
  expect(within(fixture).getByLabelText('판단하기 어려운 이유')).toHaveProperty('value', '확인 중')
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
  await screen.findByRole('button', { name: /^답변 확인 ·/ })
  expect(reviewArea('평가 기준').getAttribute('aria-pressed')).toBe('true')
  expect(reviewArea('평가 기준').textContent).toContain('다시 확인 필요')
  fireEvent.click(reviewArea('전체·비교'))
  const resultHeader = within(document.getElementById('quality-review')!).getByRole('heading', { name: '전체 답변 결과' }).parentElement!
  expect(resultHeader.textContent).toContain('다시 판정 필요')
  expect(resultHeader.textContent).not.toContain('합격')
})

it('현재 기준 승인과 최종 합격은 각각의 상태로 표시한다', async () => {
  const value = readyForOverall(true)
  setCurrentQualityResult(value, 'PASS')
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  await screen.findByRole('button', { name: /^답변 확인 ·/ })
  expect(reviewArea('평가 기준').getAttribute('aria-pressed')).toBe('false')
  expect(reviewArea('평가 기준').textContent).toContain('확인 완료')
  fireEvent.click(reviewArea('답변 확인'))
  expect(document.getElementById('quality-review')!.textContent).toContain('합격')
})

it('중복 안내 없이 필수 항목을 확인하고 승인에는 이유를 요구하지 않는다', async () => {
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(state)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  const select = await screen.findByLabelText('평가 기준이 맞나요?')
  const fixture = document.getElementById('fixture-review') as HTMLDetailsElement
  const confirm = within(fixture).getByRole('checkbox', { name: '모든 질문의 공고 내용과 평가 기준을 확인했어요.' })
  const save = within(fixture).getByRole('button', { name: '평가 기준 저장' })
  expect(within(fixture).queryByText(/확인 결과를 선택해 주세요|모든 질문 확인란을 선택해 주세요/)).toBeNull()
  expect(save).toHaveProperty('disabled', true)
  fireEvent.change(select, { target: { value: 'APPROVED' } })
  expect(within(fixture).queryByText(/모든 질문 확인란을 선택해 주세요/)).toBeNull()
  expect(save).toHaveProperty('disabled', true)
  fireEvent.click(confirm)
  expect(save).toHaveProperty('disabled', false)
  fireEvent.change(select, { target: { value: 'DEFERRED' } })
  expect(within(fixture).getByText('판단 이유를 적어 주세요.')).toBeTruthy()
  expect(within(fixture).getByRole('button', { name: '평가 기준 저장' })).toHaveProperty('disabled', true)
  fireEvent.change(within(fixture).getByLabelText('판단하기 어려운 이유'), { target: { value: '확인 중' } })
  expect(within(fixture).queryByText('판단 이유를 적어 주세요.')).toBeNull()
})

it.each([
  [{ has_active_baseline: false, has_quality_assessments: false }, null],
  [{ has_active_baseline: true, has_quality_assessments: false }, '저장하면 기존 비교 기준이 해제돼요.'],
  [{ has_active_baseline: false, has_quality_assessments: true }, '저장하면 이전 최종 결과를 다시 확인해야 해요.'],
  [{ has_active_baseline: true, has_quality_assessments: true }, '저장하면 기존 비교 기준이 해제돼요. 이전 최종 결과를 다시 확인해야 해요.'],
  [null, '저장하면 기존 비교 기준이 있다면 해제되고, 이전 최종 결과가 있다면 다시 확인해야 해요.'],
  [undefined, '저장하면 기존 비교 기준이 있다면 해제되고, 이전 최종 결과가 있다면 다시 확인해야 해요.'],
])('현재 확인한 영향에 따라 기준 저장 안내를 표시한다: %j', async (impact, expected) => {
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue({ ...state, fixture_review_impact: impact })
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  await screen.findByLabelText('평가 기준이 맞나요?')
  const fixture = document.getElementById('fixture-review') as HTMLDetailsElement
  if (expected) expect(within(fixture).getByText(expected)).toBeTruthy()
  else expect(within(fixture).queryByText(/^저장하면 /)).toBeNull()
})

it('검토 API 응답의 기준 저장 영향 정보를 소비하고 잘못된 형식은 거절한다', async () => {
  const impact = { has_active_baseline: true, has_quality_assessments: false }
  const fetch = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response(JSON.stringify({ ...state, fixture_review_impact: impact }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ...state, fixture_review_impact: { ...impact, has_active_baseline: 'yes' } }), { status: 200 }))
  expect((await opsApi.getEvaluationReview('run')).fixture_review_impact).toEqual(impact)
  await expect(opsApi.getEvaluationReview('run')).rejects.toBeInstanceOf(opsApi.OpsApiError)
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('기준을 승인할 때는 확인란 선택 후 이유 없이 저장할 수 있다', async () => {
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(state)
  const save = vi.spyOn(opsApi, 'saveFixtureReview').mockResolvedValue(structuredClone(state))
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  const select = await screen.findByLabelText('평가 기준이 맞나요?')
  const submit = screen.getByRole('button', { name: '평가 기준 저장' })
  expect(screen.queryByLabelText('판단하기 어려운 이유')).toBeNull()
  expect(screen.queryByLabelText('어떤 점을 고쳐야 하나요?')).toBeNull()
  fireEvent.change(select, { target: { value: 'DEFERRED' } })
  fireEvent.change(screen.getByLabelText('판단하기 어려운 이유'), { target: { value: '보류 중인 의견' } })
  fireEvent.change(select, { target: { value: 'APPROVED' } })
  expect(screen.queryByLabelText('판단하기 어려운 이유')).toBeNull()
  fireEvent.change(select, { target: { value: 'DEFERRED' } })
  expect(screen.getByLabelText('판단하기 어려운 이유')).toHaveProperty('value', '보류 중인 의견')
  fireEvent.change(select, { target: { value: 'APPROVED' } })
  expect(submit).toHaveProperty('disabled', true)
  fireEvent.click(screen.getByRole('checkbox', { name: '모든 질문의 공고 내용과 평가 기준을 확인했어요.' }))
  expect(submit).toHaveProperty('disabled', false)
  fireEvent.click(submit)
  await waitFor(() => expect(save).toHaveBeenCalledWith('run', expect.objectContaining({ decision: 'APPROVED', comment: '' })))
})

it.each(['DEFERRED', 'CHANGES_REQUESTED'] as const)('기준을 %s로 판단할 때 이유가 필요하다', async (decision) => {
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(state)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  const select = await screen.findByLabelText('평가 기준이 맞나요?')
  const reasonLabel = decision === 'CHANGES_REQUESTED' ? '어떤 점을 고쳐야 하나요?' : '판단하기 어려운 이유'
  const submit = screen.getByRole('button', { name: '평가 기준 저장' })
  fireEvent.click(screen.getByRole('checkbox', { name: '모든 질문의 공고 내용과 평가 기준을 확인했어요.' }))
  fireEvent.change(select, { target: { value: decision } })
  const reason = screen.getByLabelText(reasonLabel)
  expect(reason).toHaveProperty('required', true)
  fireEvent.change(reason, { target: { value: '   ' } })
  expect(submit).toHaveProperty('disabled', true)
  fireEvent.change(select, { target: { value: 'APPROVED' } })
  expect(screen.queryByLabelText(reasonLabel)).toBeNull()
  expect(submit).toHaveProperty('disabled', false)
  fireEvent.change(select, { target: { value: decision } })
  expect(submit).toHaveProperty('disabled', true)
  fireEvent.change(screen.getByLabelText(reasonLabel), { target: { value: '공고 내용을 더 확인해야 해요' } })
  expect(submit).toHaveProperty('disabled', false)
})

it('이유 없이 승인한 기록은 검토자만 표시한다', async () => {
  const value = readyForOverall()
  value.quality!.fixture_reviews[0].comment = ''
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByText('평가 기준 확인'))
  expect(screen.queryByText('이유 입력 없음')).toBeNull()
  expect(screen.getByText(/기준 자료 검토 승인 · admin/)).toBeTruthy()
})

it.each(['DEFERRED', 'CHANGES_REQUESTED'] as const)('기준을 %s로 저장해도 승인된 것처럼 안내하지 않는다', async (decision) => {
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(state)
  const save = vi.spyOn(opsApi, 'saveFixtureReview').mockResolvedValue(structuredClone(state))
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  const select = await screen.findByLabelText('평가 기준이 맞나요?')
  const fixture = document.getElementById('fixture-review') as HTMLDetailsElement
  const submit = within(fixture).getByRole('button', { name: '평가 기준 저장' })
  expect(submit).toHaveProperty('disabled', true)
  fireEvent.change(select, { target: { value: decision } })
  fireEvent.change(within(fixture).getByLabelText(decision === 'CHANGES_REQUESTED' ? '어떤 점을 고쳐야 하나요?' : '판단하기 어려운 이유'), { target: { value: '다시 확인해야 해요' } })
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
  const summary = await screen.findByRole('button', { name: /^답변 확인 ·/ })
  expect(reviewArea('평가 기준').getAttribute('aria-pressed')).toBe('false')
  fireEvent.click(summary)
  fireEvent.change(screen.getByLabelText('E01 판단'), { target: { value: 'DEFERRED' } })
  fireEvent.change(screen.getByLabelText(/^E01 (어떤 문제가 있나요|무엇을 더 확인해야 하나요)\?$/), { target: { value: '자료 변경 확인' } })
  fireEvent.click(screen.getByRole('button', { name: 'E01 검토 저장' }))
  await waitFor(() => expect(reviewArea('평가 기준').textContent).toContain('다시 확인 필요'))
  expect(reviewArea('답변 확인').getAttribute('aria-pressed')).toBe('true')
  expect(screen.queryByRole('button', { name: '평가 기준 확인하기' })).toBeNull()
})

it('다른 영역을 확인하고 돌아와도 작성 중인 평가 기준이 보존된다', async () => {
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(state)
  const save = vi.spyOn(opsApi, 'saveFixtureReview')
  const view = render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  const input = await screen.findByLabelText('평가 기준이 맞나요?')
  const summary = reviewArea('평가 기준')
  fireEvent.change(input, { target: { value: 'DEFERRED' } })
  fireEvent.change(screen.getByLabelText('판단하기 어려운 이유'), { target: { value: '확인 중인 기준' } })
  fireEvent.click(reviewArea('답변 확인'))
  expect(summary.getAttribute('aria-pressed')).toBe('false')
  view.rerender(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  expect(summary.getAttribute('aria-pressed')).toBe('false')
  fireEvent.click(summary)
  expect(summary.getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByLabelText('평가 기준이 맞나요?')).toHaveProperty('value', 'DEFERRED')
  expect(screen.getByLabelText('판단하기 어려운 이유')).toHaveProperty('value', '확인 중인 기준')
  expect(screen.getByRole('checkbox', { name: '모든 질문의 공고 내용과 평가 기준을 확인했어요.' })).toHaveProperty('checked', false)
  expect(save).not.toHaveBeenCalled()
})

it('질문이 하나면 질문 선택은 감추고 다음 단계는 접어 둔다', async () => {
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(state)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  await screen.findByRole('button', { name: /^답변 확인 ·/ })
  const fixture = document.getElementById('fixture-review')!
  const materialSection = within(fixture).getByRole('region', { name: '기준을 확인할 자료' })
  expect(within(materialSection).getAllByText('지원 대상은?')).toHaveLength(1)
  expect(within(materialSection).queryByLabelText('질문 선택')).toBeNull()
  expect(within(materialSection).queryByRole('button', { name: '기준의 이전 질문' })).toBeNull()
  expect(within(materialSection).queryByRole('button', { name: '기준의 다음 질문' })).toBeNull()
  fireEvent.click(reviewArea('답변 확인'))
  expect(screen.queryByRole('region', { name: '사례 선택' })).toBeNull()
  expect(screen.queryByRole('button', { name: '이전 질문' })).toBeNull()
  expect(screen.queryByRole('button', { name: '다음 질문' })).toBeNull()
  expect(screen.getByLabelText('E01 판단')).toBeTruthy()
  expect(reviewArea('전체·비교').getAttribute('aria-pressed')).toBe('false')
})

it('전체 검토로 이동하면 해당 단계만 열고, 접었다 열어도 의견이 남는다', async () => {
  const value = readyForOverall()
  setCurrentQualityResult(value, 'PASS')
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: '전체 검토 보기' }))
  const overall = document.getElementById('overall-review')!
  await waitFor(() => expect(document.activeElement).toBe(overall))
  expect(reviewArea('전체·비교').getAttribute('aria-pressed')).toBe('true')
  expect(reviewArea('답변 확인').getAttribute('aria-pressed')).toBe('false')
  fireEvent.change(screen.getByLabelText('검토 의견'), { target: { value: '확인 중인 의견' } })
  fireEvent.click(reviewArea('답변 확인'))
  fireEvent.click(reviewArea('전체·비교'))
  expect(screen.getByLabelText('검토 의견')).toHaveProperty('value', '확인 중인 의견')
})

it('결과로 이동하면 전체 비교가 열리고 전체 답변 결과에 초점이 이동한다', async () => {
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(readyForOverall(true))
  const assess = vi.spyOn(opsApi, 'assessEvaluationQuality')
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: '전체 답변 결과 보기 (선택)' }))
  const final = document.getElementById('quality-review')!
  await waitFor(() => expect(document.activeElement).toBe(final))
  expect(reviewArea('답변 확인').getAttribute('aria-pressed')).toBe('false')
  expect(reviewArea('전체·비교').getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByRole('button', { name: '결과 판정하기' })).toBeTruthy()
  expect(assess).not.toHaveBeenCalled()
})

it.each(['NOT_EVALUATED', 'STALE', 'FAIL'] as const)('비교 기준에 필요한 %s 결과를 해당 영역에서 확인할 수 있다', async (status) => {
  const value = readyForOverall(true)
  if (status === 'STALE') { setCurrentQualityResult(value, 'PASS'); value.quality!.is_current = false }
  if (status === 'FAIL') setCurrentQualityResult(value, 'FAIL')
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  const assess = vi.spyOn(opsApi, 'assessEvaluationQuality')
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^전체·비교/ }))
  const baseline = within(screen.getByRole('region', { name: '다음 평가의 비교 기준' }))
  expect(baseline.getByRole('button', { name: '비교 기준으로 지정' })).toHaveProperty('disabled', true)
  expect(baseline.getByText(status === 'NOT_EVALUATED' ? '전체 답변 결과를 먼저 판정해 주세요.' : status === 'STALE' ? '전체 답변 결과를 다시 판정해 주세요.' : '전체 답변 결과가 합격이어야 지정할 수 있어요.')).toBeTruthy()
  fireEvent.click(baseline.getByRole('button', { name: '전체 답변 결과로 이동' }))
  await waitFor(() => expect(document.activeElement?.id).toBe('quality-review'))
  expect(reviewArea('전체·비교').getAttribute('aria-pressed')).toBe('true')
  expect(assess).not.toHaveBeenCalled()
})

it('답변 확인 제목에 결과 바로가기는 없고 결과 상태는 전체 비교에서 보여준다', async () => {
  const input = withQualityResult('PASS')
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(input)
  const assess = vi.spyOn(opsApi, 'assessEvaluationQuality')
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^답변 확인 ·/ }))
  const heading = screen.getByRole('heading', { name: '질문과 답변 검토하기' })
  const header = heading.parentElement!.parentElement!
  expect(within(header).queryByRole('button', { name: '전체 답변 결과 보기' })).toBeNull()
  expect(header.textContent).not.toContain('합격')
  fireEvent.click(reviewArea('전체·비교'))
  expect(within(document.getElementById('quality-review')!).getByText('합격')).toBeTruthy()
  expect(assess).not.toHaveBeenCalled()
})

it('질문을 아직 확인하지 않아도 결과로 바로 이동하고 사용자가 누를 때만 판정한다', async () => {
  const input = structuredClone(state)
  const result = withQualityResult('NEEDS_REVIEW')
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(input)
  const assess = vi.spyOn(opsApi, 'assessEvaluationQuality').mockResolvedValue(result)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^답변 확인 ·/ }))
  expect(screen.getByLabelText('E01 판단')).toHaveProperty('value', '')
  fireEvent.click(reviewArea('전체·비교'))
  const final = document.getElementById('quality-review')!
  expect(final.closest('[hidden]')).toBeNull()
  expect(assess).not.toHaveBeenCalled()
  const button = within(final).getByRole('button', { name: '결과 판정하기' })
  expect(button).toHaveProperty('disabled', false)
  fireEvent.click(button)
  await waitFor(() => expect(assess).toHaveBeenCalledExactlyOnceWith('run', 'input'))
  expect(within(final).getByText('확인 필요')).toBeTruthy()
})

it.each(['material', 'quality'] as const)('%s 정보가 없어도 전체 결과 영역에 접근해 확인 불가를 본다', async (missing) => {
  const value = structuredClone(state)
  value[missing] = null
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  const assess = vi.spyOn(opsApi, 'assessEvaluationQuality')
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^답변 확인 ·/ }))
  fireEvent.click(reviewArea('전체·비교'))
  const final = document.getElementById('quality-review')!
  expect(final.closest('[hidden]')).toBeNull()
  expect(final.textContent).toContain(missing === 'quality' ? '결과를 확인할 수 없어요.' : '확인 불가')
  expect(assess).not.toHaveBeenCalled()
})

it('저장하지 않은 답변이 있으면 판정을 잠그고 그 이유를 결과 가까이에 표시한다', async () => {
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(structuredClone(state))
  const assess = vi.spyOn(opsApi, 'assessEvaluationQuality')
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^답변 확인 ·/ }))
  fireEvent.change(screen.getByLabelText('E01 판단'), { target: { value: 'DEFERRED' } })
  fireEvent.change(screen.getByLabelText('E01 무엇을 더 확인해야 하나요?'), { target: { value: '공고 내용 확인 중' } })
  fireEvent.click(reviewArea('전체·비교'))
  const final = document.getElementById('quality-review')!
  expect(within(final).getByRole('button', { name: '결과 판정하기' })).toHaveProperty('disabled', true)
  expect(within(final).getByText('작성 중인 답변은 결과에 반영되지 않았어요. 먼저 저장해 주세요.')).toBeTruthy()
  fireEvent.click(reviewArea('답변 확인'))
  expect(screen.getByLabelText('E01 무엇을 더 확인해야 하나요?')).toHaveProperty('value', '공고 내용 확인 중')
  expect(assess).not.toHaveBeenCalled()
})

it('답변 저장 중에는 비교 탭을 잠그고 저장 실패 후 초안을 유지한다', async () => {
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(structuredClone(state))
  let reject!: (reason: Error) => void
  const pending = new Promise<EvaluationReview>((_, fail) => { reject = fail })
  vi.spyOn(opsApi, 'saveEvaluationCaseReview').mockReturnValue(pending)
  const assess = vi.spyOn(opsApi, 'assessEvaluationQuality')
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^답변 확인 ·/ }))
  fireEvent.change(screen.getByLabelText('E01 판단'), { target: { value: 'DEFERRED' } })
  fireEvent.change(screen.getByLabelText('E01 무엇을 더 확인해야 하나요?'), { target: { value: '공고 확인 중' } })
  fireEvent.click(screen.getByRole('button', { name: 'E01 검토 저장' }))
  const jump = reviewArea('전체·비교')
  expect(jump).toHaveProperty('disabled', true)
  expect(assess).not.toHaveBeenCalled()
  await act(async () => { reject(new Error('저장 실패')); try { await pending } catch { /* 저장 실패는 화면에 표시된다. */ } })
  expect(jump).toHaveProperty('disabled', false)
  expect(screen.getByLabelText('E01 무엇을 더 확인해야 하나요?')).toHaveProperty('value', '공고 확인 중')
  fireEvent.click(jump)
  expect(document.getElementById('quality-review')!.closest('[hidden]')).toBeNull()
  expect(assess).not.toHaveBeenCalled()
})

it('답변에 쓴 공고 내용과 평가 조건을 같은 1번부터 보여준다', async () => {
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(state)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^답변 확인 ·/ }))
  expect(screen.getByText('공고 내용 1 · 답변에서 사용함')).toBeTruthy()
  expect(screen.getByText(/답변에 표시한 공고 내용 번호: 1/)).toBeTruthy()
  fireEvent.click(screen.getByText('AI가 작성한 평가 조건'))
  expect(screen.getByText(/인용해야 할 근거 번호: 1/)).toBeTruthy()
})

it('전체 검토와 다음 평가 기준의 버튼을 구분하고 같은 간격으로 배치한다', async () => {
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(readyForOverall())
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^전체·비교/ }))
  const saveGroup = screen.getByRole('group', { name: '전체 검토 저장' })
  const approval = within(saveGroup).getByRole('button', { name: '검토 승인 저장' })
  const changes = within(saveGroup).getByRole('button', { name: '수정 필요 저장' })
  const baseline = screen.getByRole('button', { name: '비교 기준으로 지정' })
  expect(saveGroup.className).toContain('gap-3')
  expect(baseline.closest('section')?.getAttribute('aria-label')).toBe('다음 평가의 비교 기준')
  expect(saveGroup.contains(baseline)).toBe(false)
  for (const button of [approval, changes, baseline]) {
    expect(button.className).toContain('min-h-11')
    expect(button.className).toContain('!text-sm')
  }
})


it('평가 기준 도움말은 필요한 때 열리고 선택한 값은 유지된다', async () => {
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(state)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  await screen.findByText('이 질문의 답변 보기')
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

it('비교 기준의 교체 안내는 지정할 수 있을 때 보이고 상세 설명은 도움말로 연다', async () => {
  const value = readyForOverall(true)
  value.can_promote = true
  value.quality!.status = 'PASS'
  value.quality!.is_current = true
  vi.spyOn(opsApi, 'getEvaluationReview').mockResolvedValue(value)
  render(<EvaluationReviewPanel runId="run" onExpired={vi.fn()} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /^전체·비교/ }))
  expect(await screen.findByText('새 기준을 지정하면 기존 기준이 바뀌어요.')).toBeTruthy()
  const help = screen.getByRole('button', { name: '비교 기준 도움말' })
  expect(help.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(help)
  expect(screen.getByText(/이미 접수한 평가는 바뀌지 않아요/)).toBeTruthy()
  expect(help.getAttribute('aria-expanded')).toBe('true')
})
