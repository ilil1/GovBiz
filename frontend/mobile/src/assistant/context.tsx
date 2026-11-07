import { createContext, useContext, useEffect } from 'react'
import type { SupportProgramIdentity } from '@govbiz/shared/domain/repositories/SupportProgramRepository'

export type AssistantDraft = { id: string; text: string }
export type AssistantProgramDraft = AssistantDraft & { program: SupportProgramIdentity }
export const AssistantContext = createContext<{
  available: boolean; open(): void; searchDraft: AssistantDraft | null; programDraft: AssistantProgramDraft | null
  consumeSearchDraft(id: string): void; consumeProgramDraft(id: string): void
}>({ available: false, open: () => undefined, searchDraft: null, programDraft: null,
  consumeSearchDraft: () => undefined, consumeProgramDraft: () => undefined })
export const AssistantBlockingContext = createContext<(() => () => void) | null>(null)

export function useAssistant() { return useContext(AssistantContext) }

/** 네이티브 시트와 로그인 폼이 열린 동안 배경 도우미를 숨깁니다. */
export function useAssistantBlock(visible: boolean) {
  const block = useContext(AssistantBlockingContext)
  useEffect(() => { if (visible && block) return block() }, [visible, block])
}
