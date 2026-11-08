import { useEffect, useRef, useState } from 'react'
import { getEvaluationCatalog, getLiveReadiness, OpsApiError, type BudgetSummary, type EvaluationCatalog, type LiveReadiness } from '../../../data/ops/opsApi'
import { workspacePageStyles as styles } from '../../shared/workspace/WorkspacePage.styles'

type Dataset = EvaluationCatalog['datasets'][number]
const optionsFor = (dataset: Dataset | undefined) => dataset?.live_options
  ?? (dataset?.live_config && dataset.execution_profiles.live
    ? [{ live_config: dataset.live_config, execution_profile: dataset.execution_profiles.live }] : [])

export function BudgetPlanningPanel({ summary, revision, onApply, onContinueManually, onResultChange, onExpired }: {
  summary: BudgetSummary; revision: string; onApply: (required: LiveReadiness['required']) => void; onContinueManually: () => void; onResultChange: (required: LiveReadiness['required'] | null) => void; onExpired: () => void
}) {
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const [datasetId, setDatasetId] = useState('')
  const [model, setModel] = useState('')
  const [result, setResult] = useState<LiveReadiness | null>(null)
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const active = useRef<AbortController | null>(null)
  const expiry = useRef(onExpired); expiry.current = onExpired
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError('')
    getEvaluationCatalog(controller.signal).then((catalog) => {
      if (!controller.signal.aborted) setDatasets(catalog.datasets.filter((item) =>
        (item.evaluation_scope === 'fixed-answer-context-only' || item.evaluation_scope === 'source-chunks-retrieval-answer') && optionsFor(item).length > 0))
    }).catch((reason) => {
      if (controller.signal.aborted) return
      if (reason instanceof OpsApiError && [401, 403].includes(reason.status)) expiry.current()
      setError(reason instanceof Error ? reason.message : '평가 자료를 불러오지 못했습니다.')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [reload])
  useEffect(() => () => { active.current?.abort() }, [])
  const dataset = datasets.find((item) => item.id === datasetId)
  const options = optionsFor(dataset)
  const option = options.find((item) => item.live_config.model === model)
  const resetResult = () => { active.current?.abort(); active.current = null; setChecking(false); setResult(null); onResultChange(null); setError('') }
  const check = async () => {
    if (!dataset || !option || checking) return
    active.current?.abort()
    const controller = new AbortController(); active.current = controller
    setChecking(true); setResult(null); onResultChange(null); setError('')
    try {
      const response = await getLiveReadiness(dataset.id, option.execution_profile, controller.signal, model)
      if (!controller.signal.aborted) { setResult(response); onResultChange(response.required) }
    } catch (reason) {
      if (controller.signal.aborted) return
      if (reason instanceof OpsApiError && [401, 403].includes(reason.status)) expiry.current()
      setError(reason instanceof Error ? reason.message : '필요한 양을 확인하지 못했습니다.')
    } finally { if (!controller.signal.aborted) setChecking(false) }
  }
  const allocated = summary.allocated
  const stale = revision !== summary.limits_revision
  const usable = summary.state === 'consistent' && allocated && !stale
  const inputAvailable = (summary.input_state === 'enforced' || summary.input_state === 'unconfigured')
    && allocated?.input_tokens != null
  const inputSafe = !inputAvailable || !result || Number.isSafeInteger(allocated!.input_tokens! + result.required.input_tokens)
  const safe = Boolean(usable && result && Number.isSafeInteger(allocated.calls + result.required.calls)
    && Number.isSafeInteger(allocated.output_tokens + result.required.output_tokens) && inputSafe)
  const inputKnown = inputAvailable && inputSafe
  return <section aria-label="평가 필요량 확인" className="grid gap-5 rounded-xl border border-line bg-white p-4 text-sm sm:p-5">
    <div className="space-y-1"><h3 className="text-lg font-bold text-ink">1. 어떤 평가를 할지 고르세요</h3><p className="leading-6 text-ink-muted">자료를 선택하면 평가 한 번에 필요한 최대 사용량을 확인할 수 있습니다.</p><p className="text-xs text-ink-muted">확인만 할 때는 AI가 실행되지 않고 비용도 발생하지 않습니다.</p></div>
    <>
      {loading ? <p role="status">평가 자료를 불러오고 있습니다.</p> : <>
        {error && <p role="alert" className="text-red-700">{error}</p>}
        {!datasets.length && !error ? <div className="grid gap-2 rounded-lg bg-surface-muted p-3"><p>새 AI 답변을 평가할 자료가 없습니다. 먼저 평가 자료를 등록한 뒤 돌아와 주세요.</p><a href="/ops/datasets" className={`${styles.secondaryButton} justify-self-start`}>평가 자료 등록하러 가기</a></div> : null}
        {error && !datasets.length && <button type="button" className={`${styles.secondaryButton} justify-self-start`} onClick={() => setReload((value) => value + 1)}>자료 다시 불러오기</button>}
        {datasets.length > 0 && <>
          <label className="grid gap-2 font-semibold text-ink">평가 자료 선택<select className="min-h-11 rounded-lg border border-line bg-white px-3" value={datasetId} onChange={(event) => { resetResult(); const selected = datasets.find((item) => item.id === event.target.value); setDatasetId(event.target.value); setModel(optionsFor(selected)[0]?.live_config.model ?? '') }}>
            <option value="">자료를 선택하세요</option>{datasets.map((item) => <option key={item.id} value={item.id}>{item.selection_guide?.title ?? item.label} · 질문 {item.case_ids.length}개</option>)}
          </select></label>
          {dataset && <label className="grid gap-2 font-semibold text-ink">평가 모델 선택<select className="min-h-11 rounded-lg border border-line bg-white px-3" value={model} onChange={(event) => { resetResult(); setModel(event.target.value) }}>{options.map((item) => <option key={item.live_config.model} value={item.live_config.model}>{item.live_config.model}</option>)}</select></label>}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">{!option && <p className="text-ink-muted">먼저 평가 자료를 선택해 주세요.</p>}<button type="button" className={`${result ? styles.secondaryButton : styles.primaryButton} ml-auto max-sm:w-full`} disabled={!option || checking} onClick={() => void check()}>{checking ? '확인 중…' : '필요량 확인'}</button></div>
        </>}
      </>}
      {result && <div className="grid gap-4 rounded-xl bg-surface-muted p-4" aria-live="polite">
        <div><p className="font-semibold text-ink">이번 평가에 필요한 최대 양</p><p className="mt-1 text-xs text-ink-muted">선택한 자료로 평가를 한 번 실행할 때의 기준입니다.</p></div>
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">{([
          ['AI 요청 횟수', `${result.required.calls.toLocaleString('ko-KR')}회`],
          ['AI에 보내는 내용', `${result.required.input_tokens.toLocaleString('ko-KR')}토큰`],
          ['AI 답변', `${result.required.output_tokens.toLocaleString('ko-KR')}토큰`],
        ] as const).map(([label, value]) => <div key={label} className="min-w-0 rounded-lg bg-white px-3 py-2"><dt className="text-xs text-ink-muted">{label}</dt><dd className="mt-1 break-words font-semibold text-ink">{value}</dd></div>)}</dl>
        <p className="text-ink-muted">미리 확보해야 하는 최대 양이며, 실제 사용량이나 예상 비용은 아닙니다.</p>
        {result.blockers.length > 0 && <details><summary className="cursor-pointer font-semibold">평가 전 확인할 사항 · {result.blockers.length}개</summary><ul className="mt-2 list-disc space-y-1 pl-5">{result.blockers.map((issue) => <li key={issue.code}>{issue.message}</li>)}</ul></details>}
        {result.warnings.length > 0 && <details><summary className="cursor-pointer font-semibold">주의 사항 · {result.warnings.length}개</summary><ul className="mt-2 list-disc space-y-1 pl-5">{result.warnings.map((issue) => <li key={issue.code}>{issue.message}</li>)}</ul></details>}
        {stale ? <p role="alert" className="text-amber-800">한도 설정이 변경되었습니다. 예산을 새로고침하고 다시 확인해 주세요.</p>
          : !usable ? <p className="text-amber-800">지금까지 사용했거나 예약된 양을 계산할 수 없어 전체 허용량을 자동으로 정할 수 없습니다. 위 숫자는 이번 평가에만 필요한 양입니다. 다음 단계에서 전체 허용량을 직접 정해 주세요. {summary.legacy_live_run_count > 0 ? <> <a className="font-semibold underline" href="#budget-unaccounted">이전 평가 기록으로 이동</a> 후 기록 확인 버튼을 눌러 확인하세요.</> : '관련 사용 기록을 확인해 주세요.'}</p>
            : !safe ? <p className="text-amber-800">안전한 숫자 범위를 벗어나 자동 계산할 수 없습니다. 한도를 직접 입력해 주세요.</p>
              : !inputKnown ? <p className="text-amber-800">입력 사용량을 확인할 수 없어 입력 토큰 한도는 자동으로 채우지 않습니다. 호출·출력만 계산합니다. {summary.legacy_live_run_count > 0 ? <> <a className="font-semibold underline" href="#budget-unaccounted">이전 평가 기록으로 이동</a> 후 기록 확인 버튼을 눌러 확인하세요.</> : '관련 사용 기록을 확인해 주세요.'}</p> : null}
        {!stale && <div className="flex justify-end">{safe ? <button type="button" className={`${styles.primaryButton} max-sm:w-full`} onClick={() => onApply(result.required)}>계산한 값으로 입력하고 계속</button> : <button type="button" className={`${styles.primaryButton} max-sm:w-full`} onClick={onContinueManually}>확인한 양을 보고 직접 입력</button>}</div>}
      </div>}
    </>
  </section>
}
