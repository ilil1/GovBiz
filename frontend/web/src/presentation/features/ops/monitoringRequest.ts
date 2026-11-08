/** 운영 화면의 조회가 지원 브라우저별 AbortSignal 확장 기능에 의존하지 않도록 합니다. */
export function createMonitoringRequest() {
  const controller = new AbortController()
  let active = true
  const timeout = setTimeout(() => controller.abort(), 15_000)
  return {
    signal: controller.signal,
    isActive: () => active,
    finish: () => clearTimeout(timeout),
    cancel: () => { active = false; clearTimeout(timeout); controller.abort() },
  }
}

export class MonitoringResponseError extends Error {
  readonly reason: 'missing' | 'server' | 'invalid'

  constructor(reason: 'missing' | 'server' | 'invalid') {
    super(reason)
    this.reason = reason
  }
}

export function requireMonitoringResponse(response: Response) {
  if (!response.ok) throw new MonitoringResponseError(response.status === 404 ? 'missing' : 'server')
}

export function monitoringFailureMessage(error: unknown, subject: string) {
  if (error instanceof MonitoringResponseError) {
    if (error.reason === 'missing') return `${subject} 불러오지 못했습니다. 조회 기능이 서버에 없습니다. 화면과 서버가 같은 버전인지 확인해 주세요.`
    if (error.reason === 'invalid') return `${subject} 불러오지 못했습니다. 서버 응답을 확인할 수 없습니다. 화면과 서버가 같은 버전인지 확인해 주세요.`
    return `${subject} 불러오지 못했습니다. 서버 상태를 확인한 뒤 다시 조회해 주세요.`
  }
  return `${subject} 불러오지 못했습니다. 서버 연결과 네트워크를 확인한 뒤 다시 조회해 주세요.`
}
