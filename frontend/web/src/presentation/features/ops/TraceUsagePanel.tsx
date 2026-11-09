import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { workspacePageStyles as styles } from '../../shared/workspace/WorkspacePage.styles'
import { createMonitoringRequest } from './monitoringRequest'

const totalsSchema = z.object({
  calls: z.number().int().nonnegative(), inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(),
  estimatedUsd: z.string().regex(/^\d+(\.\d+)?$/), unpricedCalls: z.number().int().nonnegative(), incompleteUsageCalls: z.number().int().nonnegative(),
})
type Totals = z.infer<typeof totalsSchema>

export function TraceUsagePanel({ traceId, onExpired }: { traceId: string; onExpired: () => void }) {
  const [data, setData] = useState<Totals | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const expiry = useRef(onExpired); expiry.current = onExpired
  useEffect(() => {
    if (!attempt) return
    const request = createMonitoringRequest()
    setData(null); setError(''); setLoading(true)
    fetch(`/api/v1/admin/ai-costs/traces/${encodeURIComponent(traceId)}`, { credentials: 'same-origin', cache: 'no-store', signal: request.signal })
      .then(async (response) => {
        if (!request.isActive()) return
        if (response.status === 401 || response.status === 403) { expiry.current(); return }
        if (!response.ok) throw new Error('unavailable')
        const parsed = totalsSchema.safeParse(await response.json())
        if (!parsed.success) throw new Error('invalid')
        if (request.isActive()) setData(parsed.data)
      }).catch(() => { if (request.isActive()) setError('앱 사용량을 조회하지 못했습니다. 추적 상세는 계속 확인할 수 있습니다.') })
      .finally(() => { request.finish(); if (request.isActive()) setLoading(false) })
    return request.cancel
  }, [attempt, traceId])
  return <section className={styles.card} aria-label="연결된 앱 사용량">
    <h2 className={styles.cardTitle}>연결된 앱 사용량</h2>
    <p className="text-sm text-ink-muted">Core에 기록된 사용량과 가격표 기준 추정 비용입니다. Langfuse 기록 비용이나 실제 청구액과는 다를 수 있습니다.</p>
    <button className={styles.secondaryButton} disabled={loading} onClick={() => setAttempt((value) => value + 1)}>{loading ? '조회 중…' : '앱 사용량 조회'}</button>
    {error && <p role="alert">{error}</p>}
    {data && (data.calls === 0 ? <p>연결된 앱 사용량 기록이 없습니다. 0원이나 모델 미호출을 의미하지 않습니다.</p> : <>
      <p>모델 호출 {data.calls.toLocaleString('ko-KR')}건 · 입력 {data.inputTokens.toLocaleString('ko-KR')}토큰 · 출력 {data.outputTokens.toLocaleString('ko-KR')}토큰</p>
      <p>가격 확인된 호출의 추정 비용 ${data.estimatedUsd} · 비용 미확정 {data.unpricedCalls.toLocaleString('ko-KR')}건 · 사용량 불완전 {data.incompleteUsageCalls.toLocaleString('ko-KR')}건</p>
    </>)}
  </section>
}
