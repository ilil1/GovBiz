import type { AssistantQuestion, AssistantRepository, AskAssistantResult } from '@govbiz/shared/domain/repositories/AssistantRepository'
import { AskAssistantUseCase } from '@govbiz/shared/domain/usecases/AskAssistantUseCase'
import { assistantAnswerDtoSchema, toAssistantAnswer } from '@govbiz/shared/data/models/AssistantAnswerDto'
import { apiRequest, ApiError } from './client'

export class AssistantResponseError extends Error {
  constructor() { super('도우미 응답 내용을 확인하지 못했어요. 입력을 확인하고 직접 다시 전송해 주세요.'); this.name = 'AssistantResponseError' }
}

/** 인증과 외부 DTO 변환은 모바일 HTTP 경계에서 처리합니다. */
export function assistantUseCase(accessToken: string) {
  if (!accessToken.trim()) throw new Error('로그인 후 도우미를 이용해 주세요.')
  const repository: AssistantRepository = {
    async ask(question: AssistantQuestion, signal?: AbortSignal): Promise<AskAssistantResult> {
      try {
        const payload = await apiRequest('/api/v1/assistant/messages', {
          method: 'POST', body: question, accessToken, signal,
        })
        const parsed = assistantAnswerDtoSchema.safeParse(payload)
        if (!parsed.success) throw new AssistantResponseError()
        const dto = parsed.data
        if (dto.citations.some(id => !question.helpEntries.some(entry => entry.id === id))
          || (dto.intent === 'UNCLEAR' ? !dto.clarificationQuestion : !dto.answer)
          || dto.intent === 'SEARCH' && !dto.searchQuery) throw new AssistantResponseError()
        return { outcome: 'answered', answer: toAssistantAnswer(dto) }
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 429) return { outcome: 'rate-limited', retryAfterSeconds: cause.retryAfterSeconds }
        if (cause instanceof ApiError && [502, 503, 504].includes(cause.status)) return { outcome: 'unavailable' }
        throw cause
      }
    },
  }
  return new AskAssistantUseCase(repository)
}
