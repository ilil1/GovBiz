// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { RagComparison } from '../../../data/ops/opsApi'
import { RagComparisonResult } from './RagComparisonResult'

const measured = { value: 0.5, measuredCaseCount: 1, eligibleCaseCount: 1 }
const missing = { value: null, measuredCaseCount: 0, eligibleCaseCount: 1 }
const report: RagComparison['current'] = {
  scope: 'source-chunks-retrieval-answer', measurementKind: 'recorded-capture-replay', baselineEligible: false,
  liveExecutionPerformed: false, completed: false, caseCount: 1, fixtureSha256: 'fixture', captureSha256: 'capture',
  execution: { model: null, embeddingModel: null, promptSha256: null },
  coverage: { retrievalCaseCount: 1, answerCaseCount: 0, failedCaseCount: 1, traceCaseCount: 0 },
  metrics: { retrievalRecallAtK: measured, answerCitationRecall: missing, answerStatusAccuracy: missing }, cases: [],
}
const comparison: RagComparison = {
  schema_version: 3, scope: 'source-chunks-retrieval-answer', retrieval_evaluated: true, baseline_eligible: false,
  comparison: 'self-replay', case_ids: ['R01'], current: report, reference: report,
}
afterEach(cleanup)

it('결과 의미는 도움말로 열고 실패와 미측정은 바로 표시한다', () => {
  render(<RagComparisonResult comparison={comparison} />)
  const section = screen.getByRole('region', { name: 'RAG 기준·후보 비교' })
  expect(within(section).getByText('50%')).toBeTruthy()
  expect(within(section).getAllByText('확인하지 못함').length).toBeGreaterThan(0)
  expect(within(section).getByText(/실패 1건/)).toBeTruthy()
  expect(within(section).getByText(/실행 완료가 품질 합격을 뜻하지는 않습니다/)).toBeTruthy()
  expect(screen.queryByText(/검색 결과에서 얼마나 찾았는지/)).toBeNull()
  const help = screen.getByRole('button', { name: '필요한 공고 내용을 찾은 비율 도움말' })
  expect(help.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(help)
  expect(screen.getByText(/검색 결과에서 얼마나 찾았는지/)).toBeTruthy()
  expect(help.getAttribute('aria-expanded')).toBe('true')
})
