import { createContext, createElement, useContext, type ReactNode } from 'react'
import type { AdminAiCostSummary, AiUsageTotals } from '../../../domain/entities/AdminAiCost'
import { getCoreApiBaseUrl } from '../../../data/api/coreApiConfig'
import { coreFetch } from '../../../data/api/coreFetch'

type MonitoringDemo = { isExample: boolean; monitoringFetch: typeof fetch }

// Core 관리자 통계는 다른 Core API와 같은 주소·쿠키를 사용한다. Ops API는 기존 same-origin 프록시를 유지한다.
const liveFetch: typeof fetch = async (input, init) => {
  if (typeof input === 'string' && input.startsWith('/api/v1/admin/')) {
    return coreFetch(`${getCoreApiBaseUrl()}${input}`, { ...init, credentials: 'include' })
  }
  return globalThis.fetch(input, init)
}
const liveContext: MonitoringDemo = { isExample: false, monitoringFetch: liveFetch }

const requestRows = [
  { feature: 'AI_SEARCH', total: 18, success: 15, accepted: 0, clientErrors: 2, serverErrors: 1, other: 0, latencySamples: 18, p50UpperMs: 2500, p95UpperMs: 10000 },
  { feature: 'EVIDENCE_QUESTION', total: 12, success: 11, accepted: 0, clientErrors: 0, serverErrors: 1, other: 0, latencySamples: 12, p50UpperMs: 5000, p95UpperMs: 30000 },
  { feature: 'APPLICATION_DOCUMENT', total: 6, success: 0, accepted: 6, clientErrors: 0, serverErrors: 0, other: 0, latencySamples: 6, p50UpperMs: 250, p95UpperMs: 1000 },
] as const

function utcDates(from: string, to: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error('Invalid example period')
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 30 * 86_400_000) throw new Error('Invalid example period')
  const days: string[] = []
  for (let date = start; date <= end; date += 86_400_000) days.push(new Date(date).toISOString().slice(0, 10))
  return days
}

function exampleResponse(path: string): unknown {
  if (!path.startsWith('/api/v1/')) throw new Error('Example request blocked')
  const url = new URL(path, 'http://localhost')
  const from = url.searchParams.get('from') || ''
  const to = url.searchParams.get('to') || ''
  if (url.pathname === '/api/v1/admin/ai-request-metrics' || url.pathname === '/api/v1/admin/ai-request-metrics/daily') {
    const days = utcDates(from, to)
    if (url.pathname.endsWith('/daily')) return { from, to, scope: 'core-http-requests', days: days.map((date) => ({ date, features: requestRows })) }
    return { from, to, scope: 'core-http-requests', features: requestRows.map((row) => ({ ...row, total: row.total * days.length, success: row.success * days.length, accepted: row.accepted * days.length, clientErrors: row.clientErrors * days.length, serverErrors: row.serverErrors * days.length, latencySamples: row.latencySamples * days.length })) }
  }
  if (url.pathname === '/api/v1/admin/ai-request-metrics/jobs') {
    utcDates(from, to)
    return { from, to, scope: 'stored-ai-jobs', features: [
      { feature: 'APPLICATION_DISCOVERY', total: 13, queued: 1, running: 1, succeeded: 10, failed: 1, interrupted: 0, unknown: 0, durationSamples: 11, averageDurationMs: 18200 },
      { feature: 'APPLICATION_DOCUMENT', total: 8, queued: 0, running: 1, succeeded: 6, failed: 1, interrupted: 0, unknown: 0, durationSamples: 7, averageDurationMs: 26400 },
      { feature: 'COMBINATION_REVIEW', total: 5, queued: 0, running: 0, succeeded: 4, failed: 0, interrupted: 1, unknown: 0, durationSamples: 5, averageDurationMs: 12400 },
    ] }
  }
  if (url.pathname === '/api/v1/admin/ai-costs/trace-coverage') {
    utcDates(from, to)
    return { from, to, features: [
      { feature: 'AI_SEARCH', calls: 48, linkedCalls: 42 },
      { feature: 'EVIDENCE_QUESTION', calls: 24, linkedCalls: 21 },
      { feature: 'ASSISTANT', calls: 12, linkedCalls: 10 },
    ] }
  }
  if (url.pathname === '/api/v1/ops/model-trace-metrics') {
    const environment = url.searchParams.get('environment') || 'all'
    if (!['all', 'production', 'development', 'unknown', 'other'].includes(environment)) throw new Error('Invalid example environment')
    const fromTime = url.searchParams.get('from_time')
    const toTime = url.searchParams.get('to_time')
    if (!fromTime || !toTime) throw new Error('Invalid example period')
    return { from_time: fromTime, to_time: toTime, scope: 'observed-model-generations', environment, results: [
      { feature: 'search.ranking.model', model: 'example-model', observed: 16, completed: 15, errors: 1, warnings: 0, timeouts: 1, timeout_unknown: 0, in_progress: 1, latency_samples: 15, missing_latency: 0, p50_seconds: 1.2, p95_seconds: 3.7 },
      { feature: 'evidence.model', model: 'example-model', observed: 8, completed: 8, errors: 1, warnings: 1, timeouts: 0, timeout_unknown: 1, in_progress: 0, latency_samples: 7, missing_latency: 1, p50_seconds: 2.2, p95_seconds: 6.1 },
    ] }
  }
  if (url.pathname === '/api/v1/ops/trace-metrics') {
    const environment = url.searchParams.get('environment') || 'all'
    if (!['all', 'production', 'development', 'unknown', 'other'].includes(environment)) throw new Error('Invalid example environment')
    const fromTime = url.searchParams.get('from_time')
    const toTime = url.searchParams.get('to_time')
    if (!fromTime || !toTime) throw new Error('Invalid example period')
    const results = [
      { name: 'search.total', observed: 18, completed: 17, in_progress: 1, errors: 1, warnings: 0, latency_samples: 17, missing_latency: 0, p50_seconds: 1.3, p95_seconds: 4.8 },
      { name: 'evidence.total', observed: 12, completed: 12, in_progress: 0, errors: 1, warnings: 0, latency_samples: 12, missing_latency: 0, p50_seconds: 2.9, p95_seconds: 8.4 },
      { name: 'assistant.total', observed: 8, completed: 8, in_progress: 0, errors: 0, warnings: 1, latency_samples: 8, missing_latency: 0, p50_seconds: 2.1, p95_seconds: 5.3 },
    ]
    return { from_time: fromTime, to_time: toTime, scope: 'observed-root-traces', environment, results }
  }
  throw new Error('Example request blocked')
}

/** 예시에서는 허용한 GET만 메모리에서 응답하고 그 외 요청은 서버에 전달하지 않습니다. */
const exampleFetch: typeof fetch = async (input, init) => {
  if (typeof input !== 'string' || (init?.method && init.method.toUpperCase() !== 'GET')) throw new Error('Example request blocked')
  if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  return new Response(JSON.stringify(exampleResponse(input)), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

const exampleContext: MonitoringDemo = { isExample: true, monitoringFetch: exampleFetch }
const Context = createContext<MonitoringDemo>(liveContext)

/** 예시는 명시적으로 선택할 때만 사용하며 실제 요청으로 대체하지 않습니다. */
export function MonitoringDemoProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return createElement(Context.Provider, { value: enabled ? exampleContext : liveContext }, children)
}

export function useMonitoringDemo(): MonitoringDemo {
  return useContext(Context)
}

const exampleTotals: AiUsageTotals = {
  calls: 84, inputTokens: 128000, cachedInputTokens: 24000, cacheWriteInputTokens: 0,
  cacheWrite12hInputTokens: 0, outputTokens: 19000, estimatedUsd: '0.184000',
  unpricedCalls: 0, incompleteUsageCalls: 0,
}

/** 비용 화면의 실제 use case를 대체합니다. 변경·동기화는 서버에 전달하지 않습니다. */
export const exampleCostUseCases = {
  getSummary: { execute: async (from: string, to: string): Promise<AdminAiCostSummary> => ({
    from, to, totals: exampleTotals, actualUsd: '0.193000', actualConfigured: true, actualFetchedAt: new Date().toISOString(),
    krwPerUsd: null,
    comparison: { timezone: 'UTC', from, to, fetchedAt: new Date().toISOString(), status: 'ready', includesCurrentDay: to === new Date().toISOString().slice(0, 10),
      totals: exampleTotals, actualUsd: '0.193000', days: [{ date: to, totals: exampleTotals, actualUsd: '0.193000' }] },
    byFeature: [{ key: 'AI_SEARCH', totals: exampleTotals }],
    byModel: [{ key: 'example-model', serviceTier: 'default', totals: exampleTotals }],
    days: [{ date: to, estimatedUsd: '0.184000', calls: 84, actualUsd: '0.193000' }], topAccounts: [],
  }) },
  getPrices: { execute: async () => [] },
  sync: { execute: async (): Promise<never> => { throw new Error('Example is read only') } },
  addPrice: { execute: async (): Promise<never> => { throw new Error('Example is read only') } },
}
