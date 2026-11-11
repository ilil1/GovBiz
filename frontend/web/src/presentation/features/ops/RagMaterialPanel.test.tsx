// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { RagMaterial, RagReviewState } from '../../../data/ops/opsApi'
import { RagMaterialPanel } from './RagMaterialPanel'
import { workspaceTagClassName } from '../../shared/workspace/WorkspacePage.styles'

const material: RagMaterial = {
  schema_version: 1, evaluation_scope: 'source-chunks-retrieval-answer',
  reference_source: 'ai-authored-not-human-reviewed', baseline_eligible: false,
  material_sha256: 'a'.repeat(64), fixture_sha256: 'b'.repeat(64),
  candidate_capture_sha256: 'c'.repeat(64), reference_capture_sha256: 'd'.repeat(64),
  candidate_measurement_kind: 'integration-stub-replay', reference_measurement_kind: 'synthetic-contract-check',
  cases: [{
    case_id: 'R01', question: '지원 대상은?', document_id: 'BIZINFO:TEST',
    source_url: 'javascript:alert(1)', content: '<script>원문</script>\n한글 공고', content_sha256: 'e'.repeat(64), chunk_version: 'v1',
    chunks: [{ id: 'chunk-a', order: 0, text: '청년 사업자' }, { id: 'chunk-b', order: 1, text: '신청 기한 없음' }],
    expected_status: 'ANSWERED', expected_evidence: [{ chunk_id: 'chunk-a', quote: '청년 사업자' }],
    candidate: { answer: null, answer_status: null, retrieved_chunk_ids: ['chunk-b', 'chunk-a'], context_chunk_ids: ['chunk-b', 'chunk-a'], cited_chunk_ids: null, trace_id: 'f'.repeat(32), failure: { stage: 'answer', code: 'timeout' } },
    reference: { answer: '<img src=x onerror=alert(1)> 근거가 부족합니다.', answer_status: 'INSUFFICIENT_EVIDENCE', retrieved_chunk_ids: ['chunk-a'], context_chunk_ids: ['chunk-a'], cited_chunk_ids: [], trace_id: null, failure: null },
  }],
}
const reviewState = (source = material): RagReviewState => ({
  baseline: { version: 0, run_id: null, assessment_id: null, selected: false, history: [] },
  material: source, reviewer_id: 'core:91', review_version: 0,
  reference_review: { rubric: { version: 'rag-reference-review-v1', scope: 'this-run-all-cases', description: '전체 사례의 원문과 기대 조건을 검토합니다.' }, fixture_sha256: source.fixture_sha256,
    case_ids: source.cases.map((item) => item.case_id), approved: false, current_id: null, can_revoke: false, history: [] },
  quality: { status: 'NOT_EVALUATED', is_current: false, current_id: null, input_sha256: '1'.repeat(64), baseline_eligible: false,
    policy: { definition: { version: 'rag-review-quality-v2', scope: 'source-chunks-retrieval-answer', pass_enabled: false, baseline_eligible: false, reference_review_supported: true }, code_sha256: '2'.repeat(64) }, history: [] },
  rubric: { version: 'rag-case-review-v1', criteria: [
    { key: 'retrieval', label: '검색 적합성', description: '질문에 맞는 근거 검색' },
    { key: 'answer', label: '답변 정확성', description: '원문과 일치하는 답변' },
    { key: 'citation', label: '인용 적합성', description: '주장을 뒷받침하는 인용' },
  ] }, case_reviews: [],
})
const session = { user: { id: 'core:91', username: 'reviewer@example.com' }, csrf_token: 'current-token', live_enabled: false, datasets: [] }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const findCurrentQuestion = async () => within(await screen.findByRole('region', { name: '현재 질문' })).getByText('지원 대상은?')
async function reviewSummary(id: 'rag-reference-review' | 'rag-quality-review') {
  await screen.findByRole('region', { name: 'RAG 검토 진행 안내' })
  return document.getElementById(id)!.querySelector('summary')!
}
async function openReviewPanels() {
  for (const id of ['rag-reference-review', 'rag-quality-review'] as const) {
    const summary = await reviewSummary(id)
    if (!summary.closest('details')?.open) fireEvent.click(summary)
  }
}

it('기준 확인은 처음부터 바로 보여 주고 다른 항목으로 이동할 수 있다', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(reviewState())))
  render(<RagMaterialPanel runId="run-a" onExpired={vi.fn()} />)
  const load = screen.getByRole('button', { name: '검토 자료 보기' })
  expect(load.className).toContain('min-h-11')
  expect(load.className).toContain('!text-sm')
  fireEvent.click(load)
  expect(await findCurrentQuestion()).toBeTruthy()
  expect(screen.queryByLabelText('확인할 질문')).toBeNull()
  expect(screen.queryByRole('button', { name: '이전 질문' })).toBeNull()
  expect(screen.queryByRole('button', { name: '다음 질문' })).toBeNull()
  const reference = await reviewSummary('rag-reference-review')
  const quality = await reviewSummary('rag-quality-review')
  expect(within(reference).getByText('평가 기준 확인')).toBeTruthy()
  expect(within(quality).getByText('최종 결과')).toBeTruthy()
  expect(within(reference).getByText('확인 전')).toBeTruthy()
  expect(within(quality).getByText('확인 전')).toBeTruthy()
  expect(reference.closest('details')).toHaveProperty('open', true)
  for (const item of [reference, quality]) {
    const summary = item.closest('summary')!
    expect(summary.className).toContain('min-h-11')
    expect(summary.className).toContain('focus-visible:outline-2')
    expect(item.closest('details')?.className).toContain('rounded-xl')
    expect(within(summary).getByText('펼치기 +')).toBeTruthy()
    expect(within(summary).getByText('접기 −')).toBeTruthy()
  }
  expect(screen.getByRole('region', { name: '평가 기준 살펴보기' })).toBeTruthy()
  expect(quality.closest('details')).toHaveProperty('open', false)
  const navigation = screen.getByRole('navigation', { name: 'RAG 검토 위치' })
  expect(navigation.className).toContain('gap-3')
  expect(within(navigation).queryByRole('link', { name: '평가 기준 확인' })).toBeNull()
  fireEvent.click(within(navigation).getByText('다른 검토 항목 보기'))
  fireEvent.click(within(navigation).getByRole('link', { name: '최종 결과 확인' }))
  expect(quality.closest('details')).toHaveProperty('open', true)
  expect(document.activeElement).toBe(quality.closest('summary'))
})

it('열린 기준 확인을 접었다가 다시 열어도 입력이 남고 자동 저장하지 않는다', async () => {
  const fetcher = vi.fn().mockResolvedValue(json(reviewState()))
  vi.stubGlobal('fetch', fetcher)
  render(<RagMaterialPanel runId="run-a" onExpired={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  const summary = await reviewSummary('rag-reference-review')
  expect(summary.closest('details')).toHaveProperty('open', true)
  fireEvent.change(screen.getByLabelText('평가 기준이 맞나요?'), { target: { value: 'DEFERRED' } })
  fireEvent.change(screen.getByLabelText('판단하기 어려운 이유'), { target: { value: '공고 확인 중' } })
  fireEvent.click(summary)
  expect(summary.closest('details')).toHaveProperty('open', false)
  fireEvent.click(summary)
  expect(summary.closest('details')).toHaveProperty('open', true)
  expect(screen.getByLabelText('평가 기준이 맞나요?')).toHaveProperty('value', 'DEFERRED')
  expect(screen.getByLabelText('판단하기 어려운 이유')).toHaveProperty('value', '공고 확인 중')
  expect(screen.getByRole('checkbox', { name: /모든 질문의 공고 내용/ })).toHaveProperty('checked', false)
  expect(fetcher.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true)
})

it('확인한 기준은 처음에 접고 필요할 때 다시 열 수 있다', async () => {
  const state = reviewState()
  state.reference_review.approved = true
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(state)))
  render(<RagMaterialPanel runId="run-a" onExpired={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  const summary = await reviewSummary('rag-reference-review')
  expect(summary.closest('details')).toHaveProperty('open', false)
  const navigation = screen.getByRole('navigation', { name: 'RAG 검토 위치' })
  fireEvent.click(within(navigation).getByText('다른 검토 항목 보기'))
  fireEvent.click(within(navigation).getByRole('link', { name: '평가 기준 확인' }))
  expect(summary.closest('details')).toHaveProperty('open', true)
  expect(document.activeElement).toBe(summary.closest('summary'))
  expect(screen.getByRole('region', { name: '평가 기준 살펴보기' })).toBeTruthy()
})

it('검토 질문의 설명은 도움말로 열고 미확인은 바로 알린다', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(reviewState())))
  render(<RagMaterialPanel runId="run-a" onExpired={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  await findCurrentQuestion()
  expect(screen.queryByText('질문에 맞는 근거 검색')).toBeNull()
  const help = screen.getByRole('button', { name: '필요한 공고 내용을 찾았나요? 도움말' })
  expect(help.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(help)
  expect(screen.getByText('질문에 맞는 근거 검색')).toBeTruthy()
  expect(help.getAttribute('aria-expanded')).toBe('true')
  expect(screen.getAllByText('확인할 내용이 없어 판단을 보류해요.')).toHaveLength(2)
})

it('실제 공고 출처와 미실행 비교 기록을 구분하고 기존 승인을 승계하지 않는다고 안내한다', async () => {
  const official = structuredClone(material)
  official.data_type = 'official-html-snapshot'
  official.cases[0].source_collected_at = '2026-09-06T15:13:00Z'
  official.cases[0].reference = {
    answer: null, answer_status: null, retrieved_chunk_ids: null, context_chunk_ids: null,
    cited_chunk_ids: null, trace_id: null, failure: { stage: 'not_started', code: 'NOT_STARTED' },
  }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(reviewState(official))))
  render(<RagMaterialPanel runId="official-rag" onExpired={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  await findCurrentQuestion()
  expect(screen.getByText(/실제 공고의 저장된 HTML 본문입니다/).textContent).toContain('다른 답변의 검토 승인은 여기에 적용되지 않습니다')
  expect(screen.getByText('저장한 공고 본문이에요. 첨부파일은 포함되지 않아요.')).toBeTruthy()
  expect(screen.getByText('공고를 가져온 시각: 2026-09-06T15:13:00Z')).toBeTruthy()
  fireEvent.click(screen.getByText('비교할 답변 보기'))
  const reference = within(screen.getByRole('article', { name: '비교 답변과 근거' }))
  expect(reference.getByText('아직 시작하지 않았어요.')).toBeTruthy()
  expect(reference.getByText('저장된 답변 없음')).toBeTruthy()
  expect(screen.queryByText('미실행 실패 · NOT_STARTED')).toBeNull()
})

it('버튼을 누른 뒤에만 GET으로 고정 자료를 읽고 실패·미확인·빈 인용을 구분한다', async () => {
  const fetcher = vi.fn().mockResolvedValue(json(reviewState()))
  vi.stubGlobal('fetch', fetcher)
  const { container } = render(<RagMaterialPanel runId="run-a" onExpired={vi.fn()} />)
  expect(fetcher).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  await findCurrentQuestion()
  expect(fetcher.mock.calls[0][0]).toBe('/api/v1/ops/evaluations/run-a/rag-reviews')
  expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store' })
  expect(fetcher.mock.calls[0][1].method).toBeUndefined()
  expect(screen.getByText('비교할 답변 보기').closest('details')).not.toHaveProperty('open', true)
  expect(screen.getByText('공고에서 찾은 근거 보기').closest('details')).not.toHaveProperty('open', true)
  const candidate = within(screen.getByRole('article', { name: '후보 답변과 근거' }))
  fireEvent.click(screen.getByText('비교할 답변 보기'))
  const reference = within(screen.getByRole('article', { name: '비교 답변과 근거' }))
  expect(candidate.getByText('답변 작성 중 문제가 생겼어요.')).toBeTruthy()
  expect(candidate.getByText(/답변 입력 순서:/).closest('p')?.textContent).toContain('근거 2 → 근거 1')
  expect(candidate.getByText(/인용 근거:/).closest('p')?.textContent).toContain('미실행 또는 미확인')
  expect(reference.getByText(/인용 근거:/).closest('p')?.textContent).toBe('인용 근거: 없음')
  expect(screen.getByText(/이번 답변: 찾음 \/ 사용 여부 확인 불가 · 비교 답변: 찾음 \/ 사용하지 않음/)).toBeTruthy()
  expect(screen.getByText('AI가 작성한 평가 기준', { selector: 'summary' })).toBeTruthy()
  expect(container.querySelector('script, img, a[href^="javascript:"]')).toBeNull()
  expect(screen.queryByRole('button', { name: /승인|판정|기준 지정/ })).toBeNull()
})

it('다른 사례를 선택하면 질문과 양쪽 근거를 함께 전환한다', async () => {
  const second = structuredClone(material.cases[0])
  second.case_id = 'R02'; second.question = '신청 기한은?'; second.content = '두 번째 원문'
  second.candidate = { ...second.candidate, retrieved_chunk_ids: null, context_chunk_ids: null, failure: { stage: 'search', code: 'unavailable' } }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(reviewState({ ...material, cases: [...material.cases, second] }))))
  render(<RagMaterialPanel runId="run-a" onExpired={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  const picker = await screen.findByLabelText('확인할 질문')
  const current = screen.getByRole('region', { name: '현재 질문' })
  expect(within(current).getByText('아직 검토하지 않음')).toBeTruthy()
  fillReview()
  expect(picker).toHaveProperty('disabled', true)
  expect(within(current).getByText('작성 중')).toBeTruthy()
  expect(within(current).getByText('작성한 검토를 저장하거나 입력 취소한 뒤 다른 질문을 선택해 주세요.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '입력 취소' }))
  expect(picker).toHaveProperty('disabled', false)
  fireEvent.change(picker, { target: { value: '1' } })
  expect(screen.getByText('내용 찾기 중 문제가 생겼어요.')).toBeTruthy()
  expect(screen.getByText('두 번째 원문')).toBeTruthy()
  expect(screen.getByText(/이번 답변: 찾았는지 확인 불가 \/ 사용 여부 확인 불가 · 비교 답변: 찾음/)).toBeTruthy()
  expect(screen.queryByText('답변 작성 중 문제가 생겼어요.')).toBeNull()
})

it.each([401, 403])('인증 오류 %s이면 로그인 처리를 요청하고 자료를 표시하지 않는다', async (status) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ detail: 'denied' }, status)))
  const onExpired = vi.fn()
  render(<RagMaterialPanel runId="run-a" onExpired={onExpired} />)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' })) })
  expect(onExpired).toHaveBeenCalledOnce()
  expect(screen.queryByText('지원 대상은?')).toBeNull()
})

it('손상된 자료 오류 뒤 재시도하고 새 응답 계약이 잘못되면 오래된 자료를 제거한다', async () => {
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(json({ code: 'RESULTS_UNAVAILABLE' }, 503))
    .mockResolvedValueOnce(json(reviewState()))
    .mockResolvedValueOnce(json({ ...reviewState(), material: { ...material, baseline_eligible: true } })))
  render(<RagMaterialPanel runId="run-a" onExpired={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  expect((await screen.findByRole('alert')).textContent).toContain('무결성을 확인할 수 없습니다')
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  await findCurrentQuestion()
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 새로고침' }))
  expect(screen.queryByText('지원 대상은?')).toBeNull()
  expect((await screen.findByRole('alert')).textContent).toContain('운영 서버 응답을 확인할 수 없습니다')
})

it('실행 이동 시 이전 요청을 중단하고 늦은 응답을 새 실행 자료로 표시하지 않는다', async () => {
  let resolve!: (response: Response) => void
  const fetcher = vi.fn().mockImplementation(() => new Promise<Response>((done) => { resolve = done }))
  vi.stubGlobal('fetch', fetcher)
  const onExpired = vi.fn()
  const view = render(<RagMaterialPanel runId="run-a" onExpired={onExpired} />)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  const signal = fetcher.mock.calls[0][1].signal as AbortSignal
  view.rerender(<RagMaterialPanel runId="run-b" onExpired={onExpired} />)
  expect(signal.aborted).toBe(true)
  await act(async () => { resolve(json(reviewState())) })
  expect(screen.queryByText('지원 대상은?')).toBeNull()
  expect(screen.getByRole('button', { name: '검토 자료 보기' })).toHaveProperty('disabled', false)
  expect(fetcher).toHaveBeenCalledOnce()
})

function fillReview() {
  fireEvent.change(screen.getByRole('combobox', { name: '필요한 공고 내용을 찾았나요?' }), { target: { value: 'UNSUITABLE' } })
  fireEvent.change(screen.getByLabelText('검토 근거'), { target: { value: '원문 조건을 찾지 못했고 답변은 미측정입니다.' } })
}

function savedState(): RagReviewState {
  return { ...reviewState(), quality: { ...reviewState().quality, input_sha256: '3'.repeat(64) }, review_version: 1, case_reviews: [{
    id: 1, case_id: 'R01', version: 1, retrieval_decision: 'UNSUITABLE', answer_decision: 'DEFERRED', citation_decision: 'DEFERRED',
    comment: '원문 조건을 찾지 못했고 답변은 미측정입니다.', material_sha256: material.material_sha256,
    fixture_sha256: material.fixture_sha256, candidate_capture_sha256: material.candidate_capture_sha256,
    reference_capture_sha256: material.reference_capture_sha256, execution_spec_sha256: 'e'.repeat(64),
    rubric_version: 'rag-case-review-v1', is_current: true, reviewed_by: 'reviewer@example.com', created_at: '2026-10-02T01:00:00Z',
  }] }
}

it('판단과 근거를 요구하고 미측정은 보류로 저장하며 최신 세션·CSRF·자료 버전을 전송한다', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(json(reviewState())).mockResolvedValueOnce(json(session)).mockResolvedValueOnce(json(savedState()))
  vi.stubGlobal('fetch', fetcher)
  render(<RagMaterialPanel runId="run-a" onExpired={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  const save = await screen.findByRole('button', { name: '사례 검토 저장' })
  expect(save).toHaveProperty('disabled', true)
  for (const label of ['답변이 공고 내용과 맞나요?', '답변에 표시한 근거가 맞나요?']) {
    const select = screen.getByRole('combobox', { name: label })
    expect(select).toHaveProperty('disabled', true)
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual(['판단 보류'])
  }
  fireEvent.change(screen.getByLabelText('검토 근거'), { target: { value: '원문 확인' } })
  expect(save).toHaveProperty('disabled', true)
  fillReview()
  expect(screen.getByRole('button', { name: '검토 자료 새로고침' })).toHaveProperty('disabled', true)
  fireEvent.click(save)
  expect((await screen.findByRole('status')).textContent).toContain('검토를 저장했어요')
  const history = screen.getByText('이 질문의 검토 이력 보기 · 1건')
  expect(history.closest('details')).toHaveProperty('open', false)
  fireEvent.click(history)
  expect(screen.getByRole('article', { name: '검토 이력 1' }).textContent).toContain('검색: 부적합 · 답변: 판단 보류 · 인용: 판단 보류')
  expect(fetcher.mock.calls[1][0]).toBe('/api/v1/ops/session')
  expect(fetcher.mock.calls[2][1].headers['X-CSRFToken']).toBe('current-token')
  expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({ case_id: 'R01', retrieval_decision: 'UNSUITABLE', answer_decision: 'DEFERRED', citation_decision: 'DEFERRED', comment: '원문 조건을 찾지 못했고 답변은 미측정입니다.', material_sha256: material.material_sha256, rubric_version: 'rag-case-review-v1', review_version: 0 })
  expect(screen.getByRole('button', { name: '검토 자료 새로고침' })).toHaveProperty('disabled', false)
  expect(screen.getByLabelText('검토 근거')).toHaveProperty('value', '')
  fireEvent.change(screen.getByLabelText('검토 근거'), { target: { value: '추가 검토 중' } })
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.getByRole('article', { name: '검토 이력 1' })).toBeTruthy()
})

it('측정된 답변도 적합을 미리 선택하지 않고 세 항목 모두 판단해야 저장한다', async () => {
  const source = structuredClone(material)
  source.cases[0].candidate.answer = '청년 사업자 대상입니다.'
  source.cases[0].candidate.cited_chunk_ids = ['chunk-a']
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(reviewState(source))))
  render(<RagMaterialPanel runId="run-a" onExpired={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  const save = await screen.findByRole('button', { name: '사례 검토 저장' })
  fillReview()
  expect(save).toHaveProperty('disabled', true)
  for (const label of ['답변이 공고 내용과 맞나요?', '답변에 표시한 근거가 맞나요?']) {
    const select = screen.getByRole('combobox', { name: label })
    expect(select).toHaveProperty('value', '')
    fireEvent.change(select, { target: { value: 'SUITABLE' } })
  }
  expect(save).toHaveProperty('disabled', false)
  fireEvent.click(screen.getByRole('button', { name: '입력 취소' }))
  expect(save).toHaveProperty('disabled', true)
  expect(screen.getByRole('button', { name: '검토 자료 새로고침' })).toHaveProperty('disabled', false)
})

it('충돌 시 입력을 보존하고 자동 재전송·버전 갱신 없이 취소 후 재조회를 요구한다', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(json(reviewState())).mockResolvedValueOnce(json(session)).mockResolvedValueOnce(json({ code: 'REVIEW_CONFLICT' }, 409)).mockResolvedValueOnce(json(savedState()))
  vi.stubGlobal('fetch', fetcher)
  render(<RagMaterialPanel runId="run-a" onExpired={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  await findCurrentQuestion(); fillReview()
  fireEvent.click(screen.getByRole('button', { name: '사례 검토 저장' }))
  await screen.findByRole('alert')
  expect(screen.getByLabelText('검토 근거')).toHaveProperty('value', '원문 조건을 찾지 못했고 답변은 미측정입니다.')
  expect(screen.getByRole('button', { name: '사례 검토 저장' })).toHaveProperty('disabled', true)
  expect(fetcher).toHaveBeenCalledTimes(3)
  fireEvent.click(screen.getByRole('button', { name: '입력 취소' }))
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 새로고침' }))
  fireEvent.click(await screen.findByText('이 질문의 검토 이력 보기 · 1건'))
  expect(screen.getByRole('article', { name: '검토 이력 1' })).toBeTruthy()
  expect(screen.getByLabelText('검토 근거')).toHaveProperty('value', '')
  expect(fetcher.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)
})

it('응답 유실 후 같은 본문·버전으로 재시도하고 중복 클릭은 요청 하나만 만든다', async () => {
  let resolve!: (value: Response) => void
  const fetcher = vi.fn().mockResolvedValueOnce(json(reviewState())).mockResolvedValueOnce(json(session)).mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce(json(session)).mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done }))
  vi.stubGlobal('fetch', fetcher)
  render(<RagMaterialPanel runId="run-a" onExpired={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  await findCurrentQuestion(); fillReview()
  fireEvent.click(screen.getByRole('button', { name: '사례 검토 저장' }))
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: '사례 검토 저장' }))
  fireEvent.submit(screen.getByLabelText('검토 근거').closest('form')!)
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(5))
  expect(fetcher.mock.calls[2][1].body).toBe(fetcher.mock.calls[4][1].body)
  await act(async () => { resolve(json(savedState())) })
  fireEvent.click(screen.getByText('이 질문의 검토 이력 보기 · 1건'))
  expect(screen.getAllByRole('article', { name: '검토 이력 1' })).toHaveLength(1)
})

it('검토 중 계정이 바뀌면 POST 전에 중단한다', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(json(reviewState())).mockResolvedValueOnce(json({ ...session, user: { id: 'core:92', username: 'other@example.com' } }))
  vi.stubGlobal('fetch', fetcher)
  const onExpired = vi.fn()
  render(<RagMaterialPanel runId="run-a" onExpired={onExpired} />)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  await findCurrentQuestion(); fillReview()
  fireEvent.click(screen.getByRole('button', { name: '사례 검토 저장' }))
  await waitFor(() => expect(onExpired).toHaveBeenCalledOnce())
  expect(fetcher.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
})

it('저장 중 실행 이동 후 늦은 응답은 새 실행에 표시하지 않는다', async () => {
  let resolve!: (value: Response) => void
  const fetcher = vi.fn().mockResolvedValueOnce(json(reviewState())).mockResolvedValueOnce(json(session)).mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done }))
  vi.stubGlobal('fetch', fetcher)
  const onExpired = vi.fn()
  const view = render(<RagMaterialPanel runId="run-a" onExpired={onExpired} />)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  await findCurrentQuestion(); fillReview()
  fireEvent.click(screen.getByRole('button', { name: '사례 검토 저장' }))
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
  view.rerender(<RagMaterialPanel runId="run-b" onExpired={onExpired} />)
  await act(async () => { resolve(json(savedState())) })
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.queryByRole('article', { name: '검토 이력 1' })).toBeNull()
  expect(screen.getByRole('button', { name: '검토 자료 보기' })).toHaveProperty('disabled', false)
})

function assessedState(status: 'NEEDS_REVIEW' | 'FAIL' = 'NEEDS_REVIEW'): RagReviewState {
  const state = reviewState()
  state.quality = { ...state.quality, status, is_current: true, current_id: 7, history: [{
    id: 7, status, policy: state.quality.policy, policy_sha256: '4'.repeat(64), input_sha256: state.quality.input_sha256,
    inputs: { review_version: 0 }, assessed_by: 'reviewer@example.com', created_at: '2026-10-02T03:00:00Z',
    reasons: [
      { code: 'REFERENCE_REVIEW_REQUIRED', case_id: null, dimension: null, message: '참조 조건의 사람 검토 승인이 필요합니다.' },
      { code: 'NOT_MEASURED', case_id: 'R01', dimension: 'answer', message: '미측정입니다.' },
    ],
  }] }
  return state
}

it('품질 점검을 명시적으로 요청하고 저장 중 사례 입력·갱신과 중복 클릭을 막는다', async () => {
  let resolve!: (value: Response) => void
  const fetcher = vi.fn().mockResolvedValueOnce(json(reviewState())).mockResolvedValueOnce(json(session)).mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done }))
  vi.stubGlobal('fetch', fetcher)
  render(<RagMaterialPanel runId="run-a" onExpired={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  await openReviewPanels()
  const save = await screen.findByRole('button', { name: '최종 결과 확인하고 저장' })
  expect(fetcher).toHaveBeenCalledTimes(1)
  fireEvent.change(screen.getByLabelText('검토 근거'), { target: { value: '미저장 초안' } })
  expect(save).toHaveProperty('disabled', true)
  fireEvent.click(screen.getByRole('button', { name: '입력 취소' }))
  fireEvent.click(save); fireEvent.click(save)
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
  expect(screen.getByLabelText('검토 근거')).toHaveProperty('disabled', true)
  expect(screen.getByRole('button', { name: '검토 자료 새로고침' })).toHaveProperty('disabled', true)
  expect(fetcher.mock.calls[2][0]).toBe('/api/v1/ops/evaluations/run-a/rag-quality')
  expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({ input_sha256: '1'.repeat(64) })
  expect(fetcher.mock.calls[2][1].headers['X-CSRFToken']).toBe('current-token')
  await act(async () => { resolve(json(assessedState())) })
  const panel = within(screen.getByRole('region', { name: 'RAG 품질 점검' }))
  expect(panel.getByRole('status').textContent).toContain('현재 결과: 확인 필요')
  expect(panel.getByRole('status').textContent).toContain('R01 · 답변: 미측정입니다.')
  expect(panel.getByText('이전 결과 보기 · 1건')).toBeTruthy()
  expect(screen.getByLabelText('검토 근거')).toHaveProperty('disabled', false)
})

it('사례 검토 변경 뒤 과거 판정을 현재 상태로 보여주지 않는다', async () => {
  const changed = savedState()
  changed.quality.history = assessedState().quality.history
  const fetcher = vi.fn().mockResolvedValueOnce(json(assessedState())).mockResolvedValueOnce(json(session)).mockResolvedValueOnce(json(changed))
  vi.stubGlobal('fetch', fetcher)
  render(<RagMaterialPanel runId="run-a" onExpired={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  await findCurrentQuestion(); fillReview()
  fireEvent.click(screen.getByRole('button', { name: '사례 검토 저장' }))
  await screen.findByText('자료·정책·검토가 변경되어 다시 점검해야 합니다. 이전 판정은 이력으로 보존됩니다.')
  const panel = within(screen.getByRole('region', { name: 'RAG 품질 점검' }))
  expect(panel.queryByRole('status')).toBeNull()
  expect(panel.getByText('최종 결과 · 다시 확인 필요')).toBeTruthy()
  expect(panel.getByText('이전 결과 보기 · 1건')).toBeTruthy()
})

it('오래된 판정은 펼치기 전후 모두 현재 결과와 구분한다', async () => {
  const stale = assessedState('FAIL')
  stale.quality.is_current = false
  const fetcher = vi.fn().mockResolvedValue(json(stale))
  vi.stubGlobal('fetch', fetcher)
  render(<RagMaterialPanel runId="run-a" onExpired={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  const summary = await reviewSummary('rag-quality-review')
  expect(summary.textContent).toContain('다시 확인 필요')
  expect(within(summary).getByText('다시 확인 필요').className).toBe(workspaceTagClassName('info'))
  fireEvent.click(summary)
  const panel = within(screen.getByRole('region', { name: 'RAG 품질 점검' }))
  expect(panel.getByText('최종 결과 · 다시 확인 필요')).toBeTruthy()
  expect(panel.getByRole('status').textContent).toContain('이전 결과: 불합격')
  expect(panel.getByRole('status').textContent).not.toContain('현재 결과')
  expect(fetcher.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true)
})

it('판정 이력이 없어도 최신이 아닌 기록은 다시 확인할 결과로 표시한다', async () => {
  const stale = reviewState()
  stale.quality.status = 'FAIL'
  stale.quality.is_current = false
  const fetcher = vi.fn().mockResolvedValue(json(stale))
  vi.stubGlobal('fetch', fetcher)
  render(<RagMaterialPanel runId="run-a" onExpired={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  const summary = await reviewSummary('rag-quality-review')
  expect(within(summary).getByText('다시 확인 필요').className).toBe(workspaceTagClassName('info'))
  const status = screen.getByText('전체 검토 상태 보기').closest('details')!
  expect(within(status).getByText('최종 결과').nextElementSibling?.textContent).toBe('다시 확인 필요')
  fireEvent.click(summary)
  expect(within(screen.getByRole('region', { name: 'RAG 품질 점검' })).getByText('최종 결과 · 다시 확인 필요')).toBeTruthy()
  expect(fetcher.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true)
})

it('품질 충돌은 자동 갱신·재전송 없이 자료를 재조회해야 해제된다', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(json(reviewState())).mockResolvedValueOnce(json(session)).mockResolvedValueOnce(json({ code: 'REVIEW_CONFLICT' }, 409)).mockResolvedValueOnce(json(savedState()))
  vi.stubGlobal('fetch', fetcher)
  render(<RagMaterialPanel runId="run-a" onExpired={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  await openReviewPanels()
  fireEvent.click(await screen.findByRole('button', { name: '최종 결과 확인하고 저장' }))
  await screen.findByRole('alert')
  expect(screen.getByRole('button', { name: '최종 결과 확인하고 저장' })).toHaveProperty('disabled', true)
  expect(fetcher).toHaveBeenCalledTimes(3)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 새로고침' }))
  expect(await screen.findByRole('button', { name: '최종 결과 확인하고 저장' })).toHaveProperty('disabled', false)
})

it('품질 응답 유실은 같은 근거 해시로 재시도한다', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(json(reviewState())).mockResolvedValueOnce(json(session)).mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce(json(session)).mockResolvedValueOnce(json(assessedState()))
  vi.stubGlobal('fetch', fetcher)
  render(<RagMaterialPanel runId="run-a" onExpired={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  await openReviewPanels()
  fireEvent.click(await screen.findByRole('button', { name: '최종 결과 확인하고 저장' }))
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: '최종 결과 확인하고 저장' }))
  await screen.findByRole('status')
  expect(fetcher.mock.calls[2][1].body).toBe(fetcher.mock.calls[4][1].body)
})

it('품질 저장 전에 계정이 바뀌면 요청을 중단한다', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(json(reviewState())).mockResolvedValueOnce(json({ ...session, user: { id: 'core:92', username: 'other' } }))
  vi.stubGlobal('fetch', fetcher)
  const onExpired = vi.fn()
  render(<RagMaterialPanel runId="run-a" onExpired={onExpired} />)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  await openReviewPanels()
  fireEvent.click(await screen.findByRole('button', { name: '최종 결과 확인하고 저장' }))
  await waitFor(() => expect(onExpired).toHaveBeenCalledOnce())
  expect(fetcher.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
})

it('다른 실행으로 이동하면 이전 품질 저장 응답을 무시한다', async () => {
  let resolve!: (value: Response) => void
  const fetcher = vi.fn().mockResolvedValueOnce(json(reviewState())).mockResolvedValueOnce(json(session)).mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done }))
  vi.stubGlobal('fetch', fetcher)
  const onExpired = vi.fn()
  const view = render(<RagMaterialPanel runId="run-a" onExpired={onExpired} />)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  await openReviewPanels()
  fireEvent.click(await screen.findByRole('button', { name: '최종 결과 확인하고 저장' }))
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
  view.rerender(<RagMaterialPanel runId="run-b" onExpired={onExpired} />)
  await act(async () => { resolve(json(assessedState())) })
  expect(screen.queryByRole('region', { name: 'RAG 품질 점검' })).toBeNull()
})

it('현재 RAG 정책에 없는 합격 응답은 거절한다', async () => {
  const state = assessedState()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ...state, quality: { ...state.quality, status: 'PASS' } })))
  render(<RagMaterialPanel runId="run-a" onExpired={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  expect((await screen.findByRole('alert')).textContent).toContain('운영 서버 응답을 확인할 수 없습니다.')
  expect(screen.queryByRole('region', { name: 'RAG 품질 점검' })).toBeNull()
})

function referenceState(decision: 'APPROVED' | 'REVOKED' = 'APPROVED', source = material): RagReviewState {
  const state = reviewState(source)
  const approved = decision === 'APPROVED'
  state.review_version = approved ? 1 : 2
  const first = { id: 41, version: 1, decision: 'APPROVED' as const, comment: '전체 원문과 기대 조건 대조 완료', fixture_sha256: source.fixture_sha256,
    case_ids: state.reference_review.case_ids, rubric_version: state.reference_review.rubric.version, execution_spec_sha256: 'e'.repeat(64),
    revoked_review_id: null, reviewed_by: 'reviewer@example.com', created_at: '2026-10-02T03:00:00Z', is_current: approved }
  state.reference_review = { ...state.reference_review, approved, can_revoke: approved, current_id: approved ? 41 : 42,
    history: approved ? [first] : [{ ...first, id: 42, version: 2, decision: 'REVOKED', revoked_review_id: 41, comment: '기대 인용 오류 발견', is_current: true }, first] }
  state.quality.input_sha256 = (approved ? '6' : '7').repeat(64)
  return state
}
const referenceConfirmation = '모든 질문의 공고 내용, 답변 가능 여부와 필요한 근거를 확인했습니다.'
function fillReference(decision = 'APPROVED') {
  fireEvent.change(screen.getByLabelText('평가 기준이 맞나요?'), { target: { value: decision } })
  const reasonLabels: Record<string, string> = { CHANGES_REQUESTED: '어떤 점을 고쳐야 하나요?', DEFERRED: '판단하기 어려운 이유', REVOKED: '이전 승인을 취소하는 이유' }
  if (reasonLabels[decision]) fireEvent.change(screen.getByLabelText(reasonLabels[decision]), { target: { value: '전체 원문과 기대 조건 대조 완료' } })
  fireEvent.click(screen.getByRole('checkbox', { name: referenceConfirmation }))
}

it.each([
  ['CHANGES_REQUESTED', '어떤 점을 고쳐야 하나요?'],
  ['DEFERRED', '판단하기 어려운 이유'],
  ['REVOKED', '이전 승인을 취소하는 이유'],
])('기준 확인에서 %s는 이유를 작성해야 저장할 수 있다', async (decision, reasonLabel) => {
  const fetcher = vi.fn().mockResolvedValue(json(referenceState()))
  vi.stubGlobal('fetch', fetcher)
  render(<RagMaterialPanel runId="run-a" onExpired={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  await openReviewPanels()
  fireEvent.change(await screen.findByLabelText('평가 기준이 맞나요?'), { target: { value: decision } })
  const reason = screen.getByLabelText(reasonLabel)
  fireEvent.click(screen.getByRole('checkbox', { name: referenceConfirmation }))
  const save = screen.getByRole('button', { name: '기준 확인 저장' })
  expect(save).toHaveProperty('disabled', true)
  fireEvent.change(reason, { target: { value: '   ' } })
  expect(save).toHaveProperty('disabled', true)
  fireEvent.change(reason, { target: { value: '공고에서 확인 필요' } })
  expect(save).toHaveProperty('disabled', false)
  expect(fetcher.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true)
})

it('승인에는 이유 없이 전체 확인 후 최신 관리자 CSRF로 저장한다', async () => {
  const source = { ...material, cases: [...material.cases, { ...material.cases[0], case_id: 'R02', question: '두 번째 질문' }] }
  let resolve!: (value: Response) => void
  const fetcher = vi.fn().mockResolvedValueOnce(json(reviewState(source))).mockResolvedValueOnce(json(session)).mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done }))
  vi.stubGlobal('fetch', fetcher)
  render(<RagMaterialPanel runId="run-a" onExpired={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  await openReviewPanels()
  const save = await screen.findByRole('button', { name: '기준 확인 저장' })
  expect(save).toHaveProperty('disabled', true)
  expect(screen.queryByRole('option', { name: '승인 철회' })).toBeNull()
  expect(screen.queryByRole('textbox', { name: /이유|어떤 점을 고쳐야/ })).toBeNull()
  fireEvent.change(screen.getByLabelText('평가 기준이 맞나요?'), { target: { value: 'DEFERRED' } })
  fireEvent.change(screen.getByLabelText('판단하기 어려운 이유'), { target: { value: '검토 중인 이유' } })
  fireEvent.change(screen.getByLabelText('평가 기준이 맞나요?'), { target: { value: 'APPROVED' } })
  expect(screen.queryByLabelText('판단하기 어려운 이유')).toBeNull()
  expect(save).toHaveProperty('disabled', true)
  expect(screen.getByLabelText('필요한 공고 내용을 찾았나요?')).toHaveProperty('disabled', true)
  expect(screen.getByRole('button', { name: '최종 결과 확인하고 저장' })).toHaveProperty('disabled', true)
  expect(screen.getByRole('button', { name: '검토 자료 새로고침' })).toHaveProperty('disabled', true)
  expect(screen.getByLabelText('확인할 질문')).toHaveProperty('disabled', false)
  fireEvent.change(screen.getByLabelText('확인할 질문'), { target: { value: '1' } })
  fireEvent.change(screen.getByLabelText('평가 기준이 맞나요?'), { target: { value: 'DEFERRED' } })
  expect(screen.getByLabelText('판단하기 어려운 이유')).toHaveProperty('value', '검토 중인 이유')
  fireEvent.change(screen.getByLabelText('평가 기준이 맞나요?'), { target: { value: 'APPROVED' } })
  fireEvent.click(screen.getByRole('checkbox', { name: referenceConfirmation }))
  fireEvent.click(save)
  fireEvent.submit(save.closest('form')!)
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
  expect(screen.getByLabelText('확인할 질문')).toHaveProperty('disabled', true)
  expect(fetcher.mock.calls[2][0]).toBe('/api/v1/ops/evaluations/run-a/rag-reference-review')
  expect(fetcher.mock.calls[2][1].headers['X-CSRFToken']).toBe('current-token')
  expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({ decision: 'APPROVED', comment: '', confirmed_all_cases: true,
    case_ids: ['R01', 'R02'], fixture_sha256: source.fixture_sha256, rubric_version: 'rag-reference-review-v1', review_version: 0 })
  await act(async () => { resolve(json(referenceState('APPROVED', source))) })
  expect(screen.getByText('평가 기준 확인 · 기준 승인')).toBeTruthy()
  expect(screen.queryByLabelText('판단하기 어려운 이유')).toBeNull()
  expect(screen.getByRole('option', { name: '이전 승인 취소' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '검토 자료 새로고침' })).toHaveProperty('disabled', false)
  expect(screen.getByLabelText('확인할 질문')).toHaveProperty('value', '1')
})

it('후보 검토나 품질 저장 중 참조 판단을 바꿀 수 없다', async () => {
  let resolve!: (value: Response) => void
  const fetcher = vi.fn().mockResolvedValueOnce(json(reviewState())).mockResolvedValueOnce(json(session)).mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done }))
  vi.stubGlobal('fetch', fetcher)
  render(<RagMaterialPanel runId="run-a" onExpired={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  await openReviewPanels()
  await findCurrentQuestion(); fillReview()
  expect(screen.getByLabelText('평가 기준이 맞나요?')).toHaveProperty('disabled', true)
  fireEvent.click(screen.getByRole('button', { name: '입력 취소' }))
  expect(screen.getByLabelText('평가 기준이 맞나요?')).toHaveProperty('disabled', false)
  fireEvent.click(screen.getByRole('button', { name: '최종 결과 확인하고 저장' }))
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
  expect(screen.getByLabelText('평가 기준이 맞나요?')).toHaveProperty('disabled', true)
  await act(async () => { resolve(json(assessedState())) })
  expect(screen.getByLabelText('평가 기준이 맞나요?')).toHaveProperty('disabled', false)
})

it('참조 철회 이력·대상과 이전 v1 품질 이력을 보존하며 현재 판정은 미판정으로 표시한다', async () => {
  const before = referenceState()
  const legacy = assessedState().quality
  legacy.policy.definition = { ...legacy.policy.definition, version: 'rag-review-quality-v1', reference_review_supported: false }
  const after = referenceState('REVOKED')
  after.quality.history = legacy.history
  const fetcher = vi.fn().mockResolvedValueOnce(json(before)).mockResolvedValueOnce(json(session)).mockResolvedValueOnce(json(after))
  vi.stubGlobal('fetch', fetcher)
  render(<RagMaterialPanel runId="run-a" onExpired={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  await openReviewPanels()
  await screen.findByLabelText('평가 기준이 맞나요?'); fillReference('REVOKED')
  fireEvent.click(screen.getByRole('button', { name: '기준 확인 저장' }))
  await screen.findByText('평가 기준 확인 · 승인 철회')
  expect(JSON.parse(fetcher.mock.calls[2][1].body)).toMatchObject({ decision: 'REVOKED', review_version: 1 })
  const history = screen.getByRole('region', { name: 'RAG 참조 자료 검토' }).querySelector('details')!
  fireEvent.click(within(history).getByText('기준 확인 이력 · 2건'))
  expect(within(history).getByText('철회 대상 기록: #41')).toBeTruthy()
  expect(screen.getByRole('article', { name: '참조 검토 이력 1' })).toBeTruthy()
  expect(screen.getByText('최종 결과 · 다시 확인 필요')).toBeTruthy()
  expect(screen.getByText(/자료·정책·검토가 변경되어 다시 점검/)).toBeTruthy()
  expect(screen.getByText('이전 결과 보기 · 1건')).toBeTruthy()
  expect(screen.queryByRole('option', { name: '승인 철회' })).toBeNull()
})

it('참조 저장 충돌 시 입력을 유지하고 취소·새로고침 전 자동 재전송하지 않는다', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(json(reviewState())).mockResolvedValueOnce(json(session)).mockResolvedValueOnce(json({ code: 'REVIEW_CONFLICT' }, 409)).mockResolvedValueOnce(json(referenceState()))
  vi.stubGlobal('fetch', fetcher)
  render(<RagMaterialPanel runId="run-a" onExpired={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  await openReviewPanels()
  await screen.findByLabelText('평가 기준이 맞나요?'); fillReference('DEFERRED')
  fireEvent.click(screen.getByRole('button', { name: '기준 확인 저장' }))
  await screen.findByRole('alert')
  expect(screen.getByLabelText('판단하기 어려운 이유')).toHaveProperty('value', '전체 원문과 기대 조건 대조 완료')
  expect(screen.getByRole('button', { name: '기준 확인 저장' })).toHaveProperty('disabled', true)
  expect(fetcher).toHaveBeenCalledTimes(3)
  fireEvent.click(screen.getByRole('button', { name: '입력 지우기' }))
  expect(screen.getByLabelText('평가 기준이 맞나요?')).toHaveProperty('disabled', true)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 새로고침' }))
  expect(await screen.findByLabelText('평가 기준이 맞나요?')).toHaveProperty('disabled', false)
  expect(fetcher.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)
})

it('참조 저장 응답 유실 후 동일 본문·버전으로 재시도한다', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(json(reviewState())).mockResolvedValueOnce(json(session)).mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce(json(session)).mockResolvedValueOnce(json(referenceState()))
  vi.stubGlobal('fetch', fetcher)
  render(<RagMaterialPanel runId="run-a" onExpired={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  await openReviewPanels()
  await screen.findByLabelText('평가 기준이 맞나요?'); fillReference()
  fireEvent.click(screen.getByRole('button', { name: '기준 확인 저장' }))
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: '기준 확인 저장' }))
  await screen.findByText('평가 기준 확인 · 기준 승인')
  expect(fetcher.mock.calls[2][1].body).toBe(fetcher.mock.calls[4][1].body)
})

it('참조 저장 전 계정 변경은 POST를 차단한다', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(json(reviewState())).mockResolvedValueOnce(json({ ...session, user: { id: 'core:92', username: 'other@example.com' } }))
  vi.stubGlobal('fetch', fetcher)
  const onExpired = vi.fn()
  render(<RagMaterialPanel runId="run-a" onExpired={onExpired} />)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  await openReviewPanels()
  await screen.findByLabelText('평가 기준이 맞나요?'); fillReference()
  fireEvent.click(screen.getByRole('button', { name: '기준 확인 저장' }))
  await waitFor(() => expect(onExpired).toHaveBeenCalledOnce())
  expect(fetcher.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
})

it('다른 실행으로 이동하면 늦은 참조 저장 응답을 무시한다', async () => {
  let resolve!: (value: Response) => void
  const fetcher = vi.fn().mockResolvedValueOnce(json(reviewState())).mockResolvedValueOnce(json(session)).mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done }))
  vi.stubGlobal('fetch', fetcher)
  const onExpired = vi.fn()
  const view = render(<RagMaterialPanel runId="run-a" onExpired={onExpired} />)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  await openReviewPanels()
  await screen.findByLabelText('평가 기준이 맞나요?'); fillReference()
  fireEvent.click(screen.getByRole('button', { name: '기준 확인 저장' }))
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
  view.rerender(<RagMaterialPanel runId="run-b" onExpired={onExpired} />)
  await act(async () => { resolve(json(referenceState())) })
  expect(screen.queryByRole('region', { name: 'RAG 참조 자료 검토' })).toBeNull()
  expect(screen.getByRole('button', { name: '검토 자료 보기' })).toHaveProperty('disabled', false)
})


const baselineRun = '00000000-0000-4000-8000-000000000001'
function passingState(): RagReviewState {
  const state = structuredClone(referenceState())
  state.material.candidate_measurement_kind = 'recorded-capture-replay'
  state.quality = { ...state.quality, status: 'PASS', is_current: true, current_id: 61, baseline_eligible: true,
    policy: { ...state.quality.policy, definition: { ...state.quality.policy.definition, version: 'rag-review-quality-v3', pass_enabled: true, baseline_eligible: true } } }
  state.quality.history = [{ id: 61, status: 'PASS', policy: state.quality.policy, policy_sha256: '8'.repeat(64), input_sha256: state.quality.input_sha256, inputs: {}, reasons: [], assessed_by: 'reviewer@example.com', created_at: '2026-10-02T04:00:00Z' }]
  return state
}

it('합격 판정을 사유와 함께 기준으로 지정하고 세션의 기준 목록을 갱신한다', async () => {
  const state = passingState()
  const selected = structuredClone(state)
  selected.baseline = { version: 1, run_id: baselineRun, assessment_id: 61, selected: true, history: [{ version: 1, assessment_id: 61, previous_assessment_id: null, reason: '전체 검토 완료', changed_by: 'reviewer@example.com', created_at: '2026-10-02T04:00:00Z' }] }
  const fetcher = vi.fn().mockResolvedValueOnce(json(state)).mockResolvedValueOnce(json(session)).mockResolvedValueOnce(json(selected))
  vi.stubGlobal('fetch', fetcher)
  const onReviewChanged = vi.fn()
  render(<RagMaterialPanel runId={baselineRun} onExpired={vi.fn()} onReviewChanged={onReviewChanged} />)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  await openReviewPanels()
  const select = await screen.findByRole('button', { name: '합격 실행을 비교 기준으로 지정' })
  expect(select).toHaveProperty('disabled', true)
  fireEvent.change(screen.getByLabelText('기준 변경 사유'), { target: { value: '전체 검토 완료' } })
  fireEvent.click(select)
  await screen.findByText('이 실행이 현재 비교 기준입니다.')
  expect(fetcher.mock.calls[2][0]).toBe(`/api/v1/ops/evaluations/${baselineRun}/rag-baseline`)
  expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({ assessment_id: 61, input_sha256: state.quality.input_sha256, baseline_version: 0, reason: '전체 검토 완료' })
  expect(fetcher.mock.calls[2][1].headers['X-CSRFToken']).toBe('current-token')
  expect(screen.getByRole('button', { name: '비교 기준 해제' })).toHaveProperty('disabled', true)
  expect(onReviewChanged).toHaveBeenCalledOnce()
})

it.each([409, 401])('기준 지정 중 충돌 또는 사용자 변경 %s는 자동 재시도하지 않는다', async (status) => {
  const state = passingState()
  const fetcher = vi.fn().mockResolvedValueOnce(json(state)).mockResolvedValueOnce(json(session)).mockResolvedValueOnce(json({ code: 'REVIEW_CONFLICT' }, status))
  vi.stubGlobal('fetch', fetcher)
  const onExpired = vi.fn()
  render(<RagMaterialPanel runId={baselineRun} onExpired={onExpired} />)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  await openReviewPanels()
  fireEvent.change(await screen.findByLabelText('기준 변경 사유'), { target: { value: '검토 완료' } })
  fireEvent.click(screen.getByRole('button', { name: '합격 실행을 비교 기준으로 지정' }))
  if (status === 401) await waitFor(() => expect(onExpired).toHaveBeenCalledOnce())
  else {
    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: '합격 실행을 비교 기준으로 지정' })).toHaveProperty('disabled', true)
  }
  expect(fetcher).toHaveBeenCalledTimes(3)
})

it('오래된 합격 기준도 사유를 남겨 해제할 수 있다', async () => {
  const state = passingState()
  state.baseline = { version: 2, run_id: baselineRun, assessment_id: 61, selected: false, history: [] }
  state.quality = { ...state.quality, status: 'NOT_EVALUATED', is_current: false, current_id: null, baseline_eligible: false }
  const cleared = structuredClone(state)
  cleared.baseline = { version: 3, run_id: null, assessment_id: null, selected: false, history: [] }
  const fetcher = vi.fn().mockResolvedValueOnce(json(state)).mockResolvedValueOnce(json(session)).mockResolvedValueOnce(json(cleared))
  vi.stubGlobal('fetch', fetcher)
  render(<RagMaterialPanel runId={baselineRun} onExpired={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  await openReviewPanels()
  fireEvent.change(await screen.findByLabelText('기준 변경 사유'), { target: { value: '정책 변경' } })
  expect(screen.queryByRole('button', { name: '합격 실행을 비교 기준으로 지정' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '비교 기준 해제' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: '비교 기준 해제' })).toBeNull())
  expect(fetcher.mock.calls[2][1].method).toBe('DELETE')
  expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({ baseline_version: 2, reason: '정책 변경' })
})

it.each([true, false])('현재 자료 검토 여부(%s)를 진행률에 반영하고 부적합 기록을 적합으로 합산하지 않는다', async (current) => {
  const state = savedState()
  state.case_reviews[0].is_current = current
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(state)))
  render(<RagMaterialPanel runId="run-a" onExpired={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  const guide = await screen.findByRole('region', { name: 'RAG 검토 진행 안내' })
  expect(within(guide).getByText('공고와 평가 기준이 맞는지 확인해 주세요')).toBeTruthy()
  expect(guide.querySelectorAll('nav > a')).toHaveLength(0)
  expect(within(guide).getByText('다른 검토 항목 보기').closest('details')).toHaveProperty('open', false)
  const statusToggle = within(guide).getByText('전체 검토 상태 보기')
  const statusDetails = statusToggle.closest('details')!
  expect(statusDetails.open).toBe(false)
  fireEvent.click(statusToggle)
  expect(statusDetails.open).toBe(true)
  expect(within(statusDetails).getByText('평가 기준').nextElementSibling?.textContent).toBe(state.reference_review.history.length ? '확인 필요' : '확인 전')
  expect(within(statusDetails).getByText('현재 자료로 검토한 질문').nextElementSibling?.textContent).toBe(`${current ? 1 : 0} / 1개`)
  expect(within(statusDetails).getByText('검색·답변·근거가 모두 문제없는 질문').nextElementSibling?.textContent).toBe('0 / 1개')
  expect(within(statusDetails).getByText('비교 기준 (선택)').nextElementSibling?.textContent).toBe('지정 전')
  fireEvent.click(statusToggle)
  expect(statusDetails.open).toBe(false)
})

it.each([
  { decision: 'DEFERRED', changed: false, expected: '판단 보류' },
  { decision: 'CHANGES_REQUESTED', changed: false, expected: '수정 필요' },
  { decision: 'DEFERRED', changed: true, expected: '확인 필요' },
] as const)('현재 기준의 $decision 상태를 자료 일치 여부 $changed 에 맞춰 표시한다', async ({ decision, changed, expected }) => {
  const state = referenceState('REVOKED')
  state.reference_review.history[0].decision = decision
  state.reference_review.history[0].revoked_review_id = null
  if (changed) state.reference_review.history[0].fixture_sha256 = '9'.repeat(64)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(state)))
  render(<RagMaterialPanel runId="run-a" onExpired={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  const guide = await screen.findByRole('region', { name: 'RAG 검토 진행 안내' })
  const status = within(guide).getByText('전체 검토 상태 보기').closest('details')!
  fireEvent.click(within(status).getByText('전체 검토 상태 보기'))
  expect(within(status).getByText('평가 기준').nextElementSibling?.textContent).toBe(expected)
})

it('다음 할 일에서 아직 검토하지 않은 질문으로 이동한다', async () => {
  const state = savedState()
  state.reference_review.approved = true
  const second = { ...state.material.cases[0], case_id: 'R02', question: '두 번째 질문' }
  state.material = { ...state.material, cases: [...state.material.cases, second] }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(state)))
  render(<RagMaterialPanel runId="run-a" onExpired={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  const guide = await screen.findByRole('region', { name: 'RAG 검토 진행 안내' })
  expect(within(guide).getByText('확인하지 않은 질문이 있어요')).toBeTruthy()
  fireEvent.click(within(guide).getByRole('link', { name: '확인할 질문 보기' }))
  expect(screen.getByLabelText('확인할 질문')).toHaveProperty('value', '1')
  expect(screen.getByText('두 번째 질문')).toBeTruthy()
})

it('작성 중인 검토를 먼저 마치도록 안내한다', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(reviewState())))
  render(<RagMaterialPanel runId="run-a" onExpired={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  fireEvent.change(await screen.findByLabelText('검토 근거'), { target: { value: '원문 확인 중' } })
  const guide = screen.getByRole('region', { name: 'RAG 검토 진행 안내' })
  expect(within(guide).getByText('작성 중인 답변 검토를 마쳐 주세요')).toBeTruthy()
  expect(within(guide).getByRole('link', { name: '작성 중인 질문 보기' }).getAttribute('href')).toBe('#rag-case-review')
  expect(guide.querySelectorAll('nav > a')).toHaveLength(1)
  expect(within(guide).getByText('다른 검토 항목 보기').closest('details')).toHaveProperty('open', false)
})

it.each([
  { status: 'PASS', current: true, title: '답변 검토를 마쳤어요' },
  { status: 'NOT_EVALUATED', current: false, title: '최종 결과를 확인해 주세요', staleHistory: true },
  { status: 'FAIL', current: true, title: '최종 결과에서 확인할 내용이 있어요' },
  { status: 'NOT_EVALUATED', current: false, title: '최종 결과를 확인해 주세요' },
] as const)('최종 결과 $status 및 현재 여부 $current 에 맞춰 안내한다', async (scenario) => {
  const { status, current, title } = scenario
  const state = status === 'PASS' || ('staleHistory' in scenario && scenario.staleHistory) ? passingState() : savedState()
  state.case_reviews = savedState().case_reviews
  state.reference_review.approved = true
  state.case_reviews[0].retrieval_decision = 'SUITABLE'
  state.case_reviews[0].answer_decision = 'SUITABLE'
  state.case_reviews[0].citation_decision = 'SUITABLE'
  state.quality.status = status
  state.quality.is_current = current
  if (status !== 'PASS') state.quality.baseline_eligible = false
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(state)))
  render(<RagMaterialPanel runId="run-a" onExpired={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  const guide = await screen.findByRole('region', { name: 'RAG 검토 진행 안내' })
  expect(within(guide).getByText(title)).toBeTruthy()
  const statusDetails = within(guide).getByText('전체 검토 상태 보기').closest('details')!
  fireEvent.click(within(statusDetails).getByText('전체 검토 상태 보기'))
  expect(within(statusDetails).getByText('최종 결과').nextElementSibling?.textContent).toBe(current ? status === 'PASS' ? '합격' : '불합격' : state.quality.history.length || status !== 'NOT_EVALUATED' ? '다시 확인 필요' : '확인 전')
  if (status === 'PASS' && current) expect(within(guide).getByText('비교 기준 지정은 선택 사항이에요.')).toBeTruthy()
  else expect(within(guide).getByRole('link', { name: '최종 결과 확인' })).toBeTruthy()
})

it('RAG 다음 사례 이동은 작성 중 잠그고 입력 취소 뒤에만 이동한다', async () => {
  const second = { ...material.cases[0], case_id: 'R02', question: '두 번째 질문' }
  const fetcher = vi.fn().mockResolvedValue(json(reviewState({ ...material, cases: [...material.cases, second] })))
  vi.stubGlobal('fetch', fetcher)
  render(<RagMaterialPanel runId="run-a" onExpired={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  fireEvent.change(await screen.findByLabelText('검토 근거'), { target: { value: '원문 확인 중' } })
  expect(screen.getByRole('button', { name: '다음 질문' })).toHaveProperty('disabled', true)
  fireEvent.click(screen.getByRole('button', { name: '입력 취소' }))
  fireEvent.click(screen.getByRole('button', { name: '다음 질문' }))
  expect(screen.getByLabelText('확인할 질문')).toHaveProperty('value', '1')
  expect(screen.getByRole('button', { name: '다음 질문' })).toHaveProperty('disabled', true)
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('평가 기준을 확인할 때 질문별 공고와 AI 기준을 한곳에서 비교한다', async () => {
  const second = { ...material.cases[0], case_id: 'R02', question: '신청 기한은?', content: '신청 기한은 12월입니다.', expected_status: 'INSUFFICIENT_EVIDENCE' as const, expected_evidence: [] }
  const fetcher = vi.fn().mockResolvedValue(json(reviewState({ ...material, cases: [...material.cases, second] })))
  vi.stubGlobal('fetch', fetcher)
  render(<RagMaterialPanel runId="run-a" onExpired={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  const reference = await screen.findByRole('region', { name: '평가 기준 살펴보기' })
  expect(within(reference).getByText('지원 대상은?', { selector: 'p' })).toBeTruthy()
  expect(within(reference).getByLabelText('공고 내용').textContent).toContain('한글 공고')
  expect(within(reference).getByRole('heading', { name: 'AI가 작성한 답변 기준' })).toBeTruthy()
  expect(within(reference).getByText('이 공고 내용으로 답변할 수 있어야 해요.')).toBeTruthy()
  expect(within(reference).getByText('청년 사업자')).toBeTruthy()
  fireEvent.click(within(reference).getByRole('button', { name: '기준의 다음 질문' }))
  expect(within(reference).getByText('신청 기한은?', { selector: 'p' })).toBeTruthy()
  expect(within(reference).getByLabelText('공고 내용').textContent).toBe('신청 기한은 12월입니다.')
  expect(within(reference).getByText('공고 내용이 부족하면 답변을 보류해야 해요.')).toBeTruthy()
  expect(within(reference).getByText('지정된 근거가 없어요.')).toBeTruthy()
  expect(fetcher.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true)
})


it('질문 하나는 선택·이동 없이 질문을 한 번만 보여 준다', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(reviewState())))
  render(<RagMaterialPanel runId="run-a" onExpired={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  const reference = await screen.findByRole('region', { name: '평가 기준 살펴보기' })
  expect(within(reference).getAllByText('지원 대상은?', { selector: 'p' })).toHaveLength(1)
  expect(within(reference).queryByRole('combobox', { name: '질문 선택' })).toBeNull()
  expect(within(reference).queryByRole('button', { name: '기준의 이전 질문' })).toBeNull()
  expect(within(reference).queryByRole('button', { name: '기준의 다음 질문' })).toBeNull()
})

it('긴 질문은 본문에서 한 번만 전체 표시하고 질문 이동해도 입력을 보존한다', async () => {
  const longQuestion = '신청할 때 공고에 기재된 서류와 제출 기한을 어떻게 확인할 수 있나요? '.repeat(5).trim()
  const first = { ...material.cases[0], question: longQuestion }
  const second = { ...first, case_id: 'R02', question: '다음 질문은 무엇인가요?', content: '두 번째 공고 내용' }
  const fetcher = vi.fn().mockResolvedValue(json(reviewState({ ...material, cases: [first, second] })))
  vi.stubGlobal('fetch', fetcher)
  render(<RagMaterialPanel runId="run-a" onExpired={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '검토 자료 보기' }))
  const reference = await screen.findByRole('region', { name: '평가 기준 살펴보기' })
  const panel = screen.getByRole('region', { name: 'RAG 참조 자료 검토' })
  const picker = within(reference).getByRole('combobox', { name: '질문 선택' }) as HTMLSelectElement
  expect(picker.selectedOptions[0].textContent).toBe('1번째 질문')
  expect(within(reference).getByText('총 2개').getAttribute('aria-hidden')).toBe('true')
  const previous = within(reference).getByRole('button', { name: '기준의 이전 질문' })
  const next = within(reference).getByRole('button', { name: '기준의 다음 질문' })
  expect(previous.parentElement).toBe(next.parentElement)
  expect(previous.parentElement?.className).toContain('grid-cols-2')
  expect(previous.className).toContain('justify-center')
  expect(next.className).toContain('justify-center')
  expect(within(reference).getAllByText(longQuestion, { selector: 'p' })).toHaveLength(1)
  expect(within(reference).getByText(longQuestion, { selector: 'p' }).className).toContain('[overflow-wrap:anywhere]')
  expect(within(reference).getByText(longQuestion, { selector: 'p' }).getAttribute('aria-live')).toBe('polite')
  expect(within(reference).getByText(longQuestion, { selector: 'p' }).getAttribute('aria-atomic')).toBe('true')
  expect(picker.compareDocumentPosition(within(reference).getByRole('button', { name: '기준의 다음 질문' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(within(reference).getByRole('button', { name: '기준의 다음 질문' }).compareDocumentPosition(within(reference).getByText(longQuestion, { selector: 'p' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(within(reference).getByRole('button', { name: '기준의 이전 질문' })).toHaveProperty('disabled', true)
  const decision = within(panel).getByLabelText('평가 기준이 맞나요?')
  const confirm = within(panel).getByRole('checkbox')
  expect(confirm).toHaveProperty('checked', false)
  fireEvent.change(decision, { target: { value: 'DEFERRED' } })
  const comment = within(panel).getByLabelText('판단하기 어려운 이유')
  fireEvent.change(comment, { target: { value: '검토 중인 이유' } })
  fireEvent.click(confirm)
  fireEvent.change(picker, { target: { value: '1' } })
  expect(picker.selectedOptions[0].textContent).toBe('2번째 질문')
  expect(within(reference).getAllByText('다음 질문은 무엇인가요?', { selector: 'p' })).toHaveLength(1)
  expect(within(reference).getByLabelText('공고 내용').textContent).toBe('두 번째 공고 내용')
  expect(decision).toHaveProperty('value', 'DEFERRED')
  expect(comment).toHaveProperty('value', '검토 중인 이유')
  expect(confirm).toHaveProperty('checked', true)
  expect(within(reference).getByRole('button', { name: '기준의 다음 질문' })).toHaveProperty('disabled', true)
  fireEvent.click(within(reference).getByRole('button', { name: '기준의 이전 질문' }))
  expect(within(reference).getByText(longQuestion, { selector: 'p' })).toBeTruthy()
  expect(fetcher.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true)
})
