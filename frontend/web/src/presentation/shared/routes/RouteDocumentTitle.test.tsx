// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { Link, MemoryRouter } from 'react-router'
import { afterEach, expect, it } from 'vitest'

import { RouteDocumentTitle } from './RouteDocumentTitle'
import { createAppStore } from '../../../app/store'
import { sessionRestored } from '../auth/state/authSlice'

afterEach(cleanup)

it('화면을 옮기면 브라우저 제목도 그 화면 이름으로 바꾼다', () => {
  render(<Provider store={createAppStore()}><MemoryRouter initialEntries={['/app/saved-programs']}>
    <RouteDocumentTitle />
    <Link to="/app/combination-reviews">검토로</Link>
    <Link to="/app/chat?mode=filter">필터 검색으로</Link>
  </MemoryRouter></Provider>)
  expect(document.title).toBe('관심 공고함 · GovBiz')

  fireEvent.click(screen.getByRole('link', { name: '검토로' }))
  expect(document.title).toBe('중복 지원·수혜 검토 · GovBiz')

  // 같은 화면에서 검색 방식만 바꿔도 제목이 따라갑니다.
  fireEvent.click(screen.getByRole('link', { name: '필터 검색으로' }))
  expect(document.title).toBe('필터 검색 · GovBiz')
})

it('같은 대화 화면에서도 관리자 세션이 바뀌면 제목이 따라간다', () => {
  const store = createAppStore()
  render(<Provider store={store}><MemoryRouter initialEntries={['/app/chat']}>
    <RouteDocumentTitle />
  </MemoryRouter></Provider>)
  expect(document.title).toBe('AI 대화 검색 · GovBiz')
  act(() => store.dispatch(sessionRestored({ email: 'admin@example.test', role: 'ADMIN', tier: 'ADMIN',
    emailVerified: true, hasPassword: true, accountType: null, onboarded: true, company: null })))
  expect(document.title).toBe('Gov 에이전트 · GovBiz')
  act(() => store.dispatch(sessionRestored(null)))
  expect(document.title).toBe('AI 대화 검색 · GovBiz')
})
