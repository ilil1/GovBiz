const automaticReasons = new Set([
  '자동 생성: AI 평가 사용량 한도 설정',
  '자동 생성: 하루 한도 설정',
  '자동 생성: 하루 한도 해제',
])

export function displayBudgetChangeReason(reason: string, source?: string) {
  return `변경 이유: ${source !== 'CLI' && automaticReasons.has(reason) ? '별도 입력 없음' : reason}`
}
