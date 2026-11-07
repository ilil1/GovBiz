import { describe, expect, it } from 'vitest'
import type { ChatConversationSnapshot } from '../../domain/entities/ChatConversation'
import type { GovAgentApplication } from '../../domain/entities/GovAgent'
import { chatConversationSnapshotSchema } from './ChatConversationDto'

const program = { sourceCode: 'BIZINFO', sourceProgramId: 'P001', title: '신청 준비 공고' }

function snapshot(application?: GovAgentApplication): ChatConversationSnapshot {
  return {
    schemaVersion: 1,
    messages: [
      { id: 'question', role: 'user', text: '이 공고 신청서 작성해 줘' },
      { id: 'answer', role: 'assistant', text: '신청 준비', ...(application ? { govApplication: application } : {}) },
    ],
    govProgram: program,
    searchOptions: { acceptingOnly: true },
    conversationQuery: null,
    confirmedSearch: null,
    lastSearch: null,
    pendingProposal: null,
    pendingClarification: null,
    searchStatus: 'idle',
    searchError: null,
    interpretation: { status: 'idle' },
  }
}

describe('Gov application conversation snapshots', () => {
  it('restores review and partner cards without accepting an injected analysis or proposal approval', () => {
    const saved = snapshot()
    saved.messages.push(
      { id: 'review', role: 'assistant', text: '중복 검토', govReview: { program: null, message: '두 공고 선택', reviewId: 12 } },
      { id: 'partners', role: 'assistant', text: '파트너 조회', govPartners: { message: '전체 모집글' } },
    )
    const payload = JSON.parse(JSON.stringify(saved))
    Object.assign(payload.messages[2].govReview, { approved: true, requestKey: 'injected', runId: 77 })
    Object.assign(payload.messages[3].govPartners, { proposalApproved: true, sourceProgramId: 'untrusted' })
    expect(chatConversationSnapshotSchema.parse(payload)).toEqual(saved)
  })
  it.each([1, 12, Number.MAX_SAFE_INTEGER])('preserves preparation id %s and composite identity across JSON serialization', (preparationId) => {
    const saved = snapshot({ program, message: '신청 준비', preparationId })
    const restored = chatConversationSnapshotSchema.parse(JSON.parse(JSON.stringify(saved)))
    expect(restored).toEqual(saved)
  })

  it('keeps legacy conversations and application cards without a preparation id readable', () => {
    for (const saved of [snapshot(), snapshot({ program, message: '신청 준비' })]) {
      const restored = chatConversationSnapshotSchema.parse(JSON.parse(JSON.stringify(saved)))
      expect(restored).toEqual(saved)
      expect(restored.messages[1].govApplication?.preparationId).toBeUndefined()
    }
  })

  it('retains only the saved preparation reference, not approval or execution state', () => {
    const saved = snapshot({ program, message: '신청 준비', preparationId: 12 })
    const payload = JSON.parse(JSON.stringify(saved))
    Object.assign(payload.messages[1].govApplication, { approved: true, formVersionId: 'untrusted', requestKey: 'injected' })
    expect(chatConversationSnapshotSchema.parse(payload)).toEqual(saved)
    payload.messages[1].govApplication.preparationId = '12'
    expect(chatConversationSnapshotSchema.safeParse(payload).success).toBe(false)
  })
})
