// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MonitoringDemoProvider } from './MonitoringDemoContext'
import { MonitoringDetailPage } from './MonitoringDetailPage'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('실사용 모니터링 상세 페이지', () => {
  it.each([
    ['requests', '요청과 서버 오류', '요청 요약'],
    ['jobs', '작업 결과', '작업 요약'],
    ['models', '모델 실행', '수집된 모델 실행 요약'],
    ['traces', '추적 수집과 연결', '기능별 추적 번호 기록 표'],
  ] as const)('예시 %s 상세는 해당 집계만 열고 예시 상태로 돌아간다', async (section, title, label) => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    render(<MemoryRouter><MonitoringDemoProvider enabled><MonitoringDetailPage section={section} onExpired={vi.fn()} modeBanner={<p>예시 화면을 보고 있습니다</p>} /></MonitoringDemoProvider></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy()
    expect(screen.getByText('예시 화면을 보고 있습니다')).toBeTruthy()
    expect(screen.getByRole('link', { name: '전체 현황으로 돌아가기' }).getAttribute('href')).toBe('/ops/usage?example=1')
    expect(await screen.findByLabelText(label)).toBeTruthy()
    if (section === 'requests') {
      expect(screen.getByText('기능별 요청과 응답 시간 보기').closest('details')?.open).toBe(true)
      expect(await screen.findByRole('region', { name: '날짜별 요청 추세' })).toBeTruthy()
    }
    if (section === 'jobs') expect(screen.getByText('작업 종류별 결과와 소요 시간 보기').closest('details')?.open).toBe(true)
    if (section === 'models') {
      expect(screen.getByText('기간과 실행 환경 바꾸기').closest('details')?.open).toBe(true)
      expect(screen.getByText('기능과 모델별 자세히 보기').closest('details')?.open).toBe(true)
    }
    expect(fetch).not.toHaveBeenCalled()
    if (section === 'traces') expect(screen.queryByRole('link', { name: 'AI 실행 추적' })).toBeNull()
  })

  it('실제 추적 상세는 실제 목록과 현황으로만 이동한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })))
    render(<MemoryRouter><MonitoringDetailPage section="traces" onExpired={vi.fn()} /></MemoryRouter>)
    expect(screen.getByRole('link', { name: '전체 현황으로 돌아가기' }).getAttribute('href')).toBe('/ops/usage')
    expect(screen.getByRole('link', { name: 'AI 실행 추적' }).getAttribute('href')).toBe('/ops/traces')
    expect(await screen.findAllByRole('alert')).toHaveLength(2)
  })

  it('상세 조회의 세션 만료를 상위로 전달한다', async () => {
    const onExpired = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })))
    render(<MemoryRouter><MonitoringDetailPage section="models" onExpired={onExpired} /></MemoryRouter>)
    await waitFor(() => expect(onExpired).toHaveBeenCalledTimes(1))
  })
})
