import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMonitoringRequest, MonitoringResponseError, monitoringFailureMessage, requireMonitoringResponse } from './monitoringRequest'

afterEach(() => vi.useRealTimers())

describe('운영 화면 조회', () => {
  it('제한 시간이 지나면 조회를 중단하되 오류를 화면에 표시할 수 있다', () => {
    vi.useFakeTimers()
    const request = createMonitoringRequest()
    vi.advanceTimersByTime(15_000)
    expect(request.signal.aborted).toBe(true)
    expect(request.isActive()).toBe(true)
    request.cancel()
    expect(request.isActive()).toBe(false)
  })

  it('API가 없을 때와 응답 형식이 다를 때 대응 방법을 구분한다', () => {
    expect(() => requireMonitoringResponse(new Response('', { status: 404 }))).toThrow(MonitoringResponseError)
    expect(monitoringFailureMessage(new MonitoringResponseError('missing'), '요청 현황을')).toContain('같은 버전인지')
    expect(monitoringFailureMessage(new MonitoringResponseError('invalid'), '요청 현황을')).toContain('서버 응답')
    expect(monitoringFailureMessage(new Error('private details'), '요청 현황을')).not.toContain('private details')
  })
})
