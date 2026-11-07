import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { Alert } from 'react-native'
import { ChatScreen } from './ChatScreen'
import { programClient } from '../api/client'
import { useAuth } from '../auth/session'

jest.setTimeout(15_000)
jest.mock('../auth/session', () => ({ useAuth: jest.fn() }))
jest.mock('../api/client', () => ({ ...jest.requireActual('../api/client'), programClient: jest.fn() }))
jest.mock('../api/chatConversations', () => ({ deleteChatConversation: jest.fn(), getChatConversation: jest.fn(), listChatConversations: jest.fn(), saveChatConversation: jest.fn() }))
jest.mock('../components/PlanUsage', () => ({ usePlanUsage: () => ({ usage: null, reload: jest.fn() }), PlanUsageLine: () => null }))
const interpret = jest.fn(), search = jest.fn()
beforeEach(() => {
  jest.mocked(useAuth).mockReturnValue({ status: 'signedIn', session: { accessToken: 'owner', account: { email: 'owner@test' } } } as unknown as ReturnType<typeof useAuth>)
  jest.mocked(programClient).mockReturnValue({ interpretConversation: interpret, search } as unknown as ReturnType<typeof programClient>)
  interpret.mockReset(); search.mockReset()
})
afterEach(() => jest.restoreAllMocks())

test('an initial assistant draft survives chat initialization and does not execute interpretation or search', () => {
  const consumed = jest.fn()
  render(<ChatScreen onOpenProgram={jest.fn()} onLogin={jest.fn()} assistantDraft={{ id: 'draft-1', text: '서울 AI 사업화 지원' }} onDraftConsumed={consumed} />)
  expect(screen.getByLabelText('회사 상황이나 궁금한 점').props.value).toBe('서울 AI 사업화 지원')
  expect(consumed).toHaveBeenCalledWith('draft-1')
  expect(interpret).not.toHaveBeenCalled(); expect(search).not.toHaveBeenCalled()
})
test('existing input is preserved unless the user explicitly accepts replacement', () => {
  const consumed = jest.fn(), alert = jest.spyOn(Alert, 'alert')
  const props = { onOpenProgram: jest.fn(), onLogin: jest.fn(), onDraftConsumed: consumed }
  const view = render(<ChatScreen {...props} />)
  fireEvent.changeText(screen.getByLabelText('회사 상황이나 궁금한 점'), '직접 작성한 조건')
  view.rerender(<ChatScreen {...props} assistantDraft={{ id: 'draft-2', text: '도우미 추천 검색어' }} />)
  expect(alert).toHaveBeenCalledWith('입력 중인 검색어를 바꿀까요?', expect.any(String), expect.any(Array))
  act(() => alert.mock.calls[0][2]![0].onPress!())
  expect(screen.getByLabelText('회사 상황이나 궁금한 점').props.value).toBe('직접 작성한 조건')
  view.rerender(<ChatScreen {...props} assistantDraft={{ id: 'draft-3', text: '확인한 검색어' }} />)
  act(() => alert.mock.calls[1][2]![1].onPress!())
  expect(screen.getByLabelText('회사 상황이나 궁금한 점').props.value).toBe('확인한 검색어')
  expect(interpret).not.toHaveBeenCalled(); expect(search).not.toHaveBeenCalled()
})
test('a hidden AI panel defers the handoff until selected', () => {
  const consumed = jest.fn(), props = { onOpenProgram: jest.fn(), onLogin: jest.fn(), onDraftConsumed: consumed, assistantDraft: { id: 'draft-4', text: '선택 후 입력할 검색어' } }
  const view = render(<ChatScreen {...props} active={false} />)
  expect(consumed).not.toHaveBeenCalled()
  view.rerender(<ChatScreen {...props} active />)
  expect(screen.getByLabelText('회사 상황이나 궁금한 점').props.value).toBe('선택 후 입력할 검색어')
  expect(consumed).toHaveBeenCalledTimes(1)
})
