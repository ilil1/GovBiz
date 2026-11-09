import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { getLiveReadiness, OpsApiError, type LiveReadiness } from '../../../data/ops/opsApi'
import { workspacePageStyles as styles } from '../../shared/workspace/WorkspacePage.styles'
import { DailyBudgetPanel } from './DailyBudgetPanel'

const budgetIssues = new Set([
  'BUDGET_UNCONFIGURED', 'BUDGET_INCONSISTENT', 'INPUT_BUDGET_UNCONFIGURED', 'INPUT_BUDGET_UNKNOWN',
  'INSUFFICIENT_CALLS', 'INSUFFICIENT_INPUT_TOKENS', 'INSUFFICIENT_OUTPUT_TOKENS',
  'DAILY_BUDGET_UNAVAILABLE', 'DAILY_INSUFFICIENT_CALLS', 'DAILY_INSUFFICIENT_INPUT_TOKENS', 'DAILY_INSUFFICIENT_OUTPUT_TOKENS',
])

// A new selection or leaving this page aborts old checks; returning requires a fresh check.
export function LiveReadinessPanel({ datasetId, executionProfile, model, onExpired }: {
  datasetId: string; executionProfile: string; model?: string; onExpired: () => void
}) {
  const [result, setResult] = useState<LiveReadiness | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const active = useRef<AbortController | null>(null)
  useEffect(() => () => active.current?.abort(), [])
  const check = async () => {
    active.current?.abort()
    const controller = new AbortController()
    active.current = controller
    setBusy(true); setResult(null); setError('')
    try {
      const value = await getLiveReadiness(datasetId, executionProfile, controller.signal, model)
      if (!controller.signal.aborted) setResult(value)
    } catch (reason) {
      if (controller.signal.aborted) return
      if (reason instanceof OpsApiError && [401, 403].includes(reason.status)) onExpired()
      setError(reason instanceof Error ? reason.message : '점검 결과를 확인할 수 없습니다.')
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  const budgetBlockers = result?.blockers.filter((issue) => budgetIssues.has(issue.code)) ?? []
  const budgetWarnings = result?.warnings.filter((issue) => budgetIssues.has(issue.code)) ?? []
  const otherBlockers = result?.blockers.filter((issue) => !budgetIssues.has(issue.code)) ?? []
  const otherWarnings = result?.warnings.filter((issue) => !budgetIssues.has(issue.code)) ?? []
  const amountItems = [
    ['CALLS', 'calls', 'AI 요청', '회'],
    ['INPUT_TOKENS', 'input_tokens', 'AI에 보내는 내용', '토큰'],
    ['OUTPUT_TOKENS', 'output_tokens', 'AI 답변', '토큰'],
  ] as const
  const budgetMessages: Record<string, string> = {
    BUDGET_UNCONFIGURED: '전체 사용 한도를 먼저 설정해 주세요.',
    BUDGET_INCONSISTENT: '전체 사용 기록을 확인할 수 없어요. 예산 관리에서 확인해 주세요.',
    INPUT_BUDGET_UNCONFIGURED: 'AI에 보내는 내용의 전체 한도가 설정되지 않았어요.',
    INPUT_BUDGET_UNKNOWN: '이전 평가의 사용량을 먼저 확인해 주세요.',
    DAILY_BUDGET_UNAVAILABLE: result?.daily?.state === 'exceeded' ? '오늘 사용 한도를 초과했어요.' : '오늘 남은 한도를 확인할 수 없어요.',
  }
  return <section aria-label="실행 설정·예산 점검" className="w-full space-y-3 rounded-xl border border-line bg-white p-4 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="font-semibold">실행 전 설정·예산 확인</h3>
      <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => void check()}>{busy ? '점검 중…' : '실행 설정·예산 점검'}</button>
    </div>
    <p>평가에 필요한 양과 남은 한도를 확인합니다. 점검할 때는 AI를 실행하지 않습니다.</p>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {result && <>
      <p role="status" className="font-semibold">{result.state === 'blocked' ? '평가를 시작하기 전에 확인해 주세요.' : '현재 점검에서 차단된 항목은 없어요.'}</p>
      {(budgetBlockers.length > 0 || budgetWarnings.length > 0) && <section aria-label="예산 확인 결과" className="space-y-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-ink">
        <div><h4 className="text-base font-bold">{budgetBlockers.length ? '사용 한도를 확인해 주세요' : '사용 한도 안내'}</h4>
          {budgetBlockers.some((issue) => issue.code.includes('INSUFFICIENT_')) && <p className="mt-1 text-sm">이번 평가에 필요한 최대 양보다 남은 한도가 적어요.</p>}
        </div>
        {(['전체', '하루'] as const).map((scope) => {
          const daily = scope === '하루'
          const issues = budgetBlockers.filter((issue) => issue.code.startsWith(daily ? 'DAILY_INSUFFICIENT_' : 'INSUFFICIENT_'))
          if (!issues.length) return null
          const remaining = daily ? result.daily?.remaining : result.remaining
          return <div key={scope} className="rounded-lg bg-white p-3">
            <h5 className="font-bold">{scope} 한도에서 부족한 항목</h5>
            <dl className="mt-2 grid gap-2 sm:grid-cols-3">{amountItems.filter(([code]) => issues.some((issue) => issue.code === `${daily ? 'DAILY_' : ''}INSUFFICIENT_${code}`)).map(([, key, label, unit]) => <div key={key} className="rounded-lg bg-surface-muted p-3">
              <dt className="font-semibold">{label}</dt><dd className="mt-1">필요 {result.required[key].toLocaleString('ko-KR')}{unit}</dd><dd>남음 {remaining?.[key] == null ? '확인할 수 없음' : `${remaining[key].toLocaleString('ko-KR')}${unit}`}</dd>
            </div>)}</dl>
          </div>
        })}
        {[...budgetBlockers, ...budgetWarnings].filter((issue) => !issue.code.includes('INSUFFICIENT_')).map((issue) => <p key={issue.code}>{budgetMessages[issue.code] ?? issue.message}</p>)}
        <p>{budgetBlockers.length ? '예산 관리에서 한도를 확인하거나 변경한 뒤, 돌아와 다시 점검해 주세요.' : '필요하면 예산 관리에서 한도를 확인할 수 있어요.'}</p>
        <Link className="inline-flex min-h-11 items-center rounded-lg bg-white px-4 font-semibold text-brand-primary ring-1 ring-line focus-visible:outline-2 focus-visible:outline-brand-primary" to="/ops/budget">예산 관리로 이동</Link>
      </section>}
      {otherBlockers.length > 0 && <ul className="list-disc space-y-1 pl-5 text-red-700" aria-label="점검 차단 사유">{otherBlockers.map((issue) => <li key={issue.code}>{issue.message}</li>)}</ul>}
      {otherWarnings.length > 0 && <ul className="list-disc space-y-1 pl-5 text-amber-800" aria-label="점검 주의 사항">{otherWarnings.map((issue) => <li key={issue.code}>{issue.message}</li>)}</ul>}
      <details className="text-sm text-ink-muted"><summary className="min-h-10 cursor-pointer py-2 font-semibold focus-visible:outline-2 focus-visible:outline-brand-primary">점검 상세 보기</summary>
        <p className="text-xs">조회 시각: {new Date(result.as_of).toLocaleString('ko-KR')} · 모델: {result.model}</p>
        <table className="mt-2 w-full text-left"><caption className="sr-only">이번 실행의 최대 예약량과 조회 시점 잔여 한도</caption>
          <thead><tr><th scope="col">항목</th><th scope="col">이번 최대 예약량</th><th scope="col">잔여 한도</th></tr></thead>
          <tbody>{([['calls', '모델 호출 수'], ['input_tokens', '입력 토큰'], ['output_tokens', '출력 토큰']] as const).map(([key, label]) => <tr key={key}>
            <th scope="row">{label}</th><td>{result.required[key].toLocaleString()}</td><td>{result.remaining?.[key]?.toLocaleString() ?? '확인 불가·미설정'}</td>
          </tr>)}</tbody>
        </table>
        <DailyBudgetPanel value={result.daily} />
        <p className="mt-2 text-xs">실제 사용량이나 청구 금액이 아닌 최대 필요량입니다. 접수할 때 현재 한도를 다시 확인합니다.</p>
      </details>
    </>}
  </section>
}
