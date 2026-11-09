import { useId } from 'react'
import type { EvaluationCatalog } from '../../../data/ops/opsApi'
import { workspaceTagClassName } from '../../shared/workspace/WorkspacePage.styles'
import { EvaluationHelp } from './EvaluationHelp'

const categories = [
  { id: 'quality', label: '실제 품질 평가용', description: '공고를 미리 보여주고 답변을 확인하거나, 정해진 공고 안에서 필요한 내용을 찾는 과정까지 확인합니다.' },
  { id: 'development', label: '개발 검증용', description: '가상 자료로 채점·연동·오류 처리를 확인합니다. 실제 공고의 품질을 대표하지 않습니다.' },
  { id: 'historical', label: '과거 자료', description: '이전 자료 버전이나 저장 기록을 비교·재현합니다.' },
] as const

export function EvaluationDatasetPicker({ datasets, value, disabled, onChange }: {
  datasets: EvaluationCatalog['datasets']; value: string; disabled: boolean; onChange: (value: string) => void;
}) {
  const id = useId()
  const selected = datasets.find((dataset) => dataset.id === value)
  const guide = selected?.selection_guide
  const category = categories.find((item) => item.id === guide?.category)
  const scope = selected?.evaluation_scope === 'fixed-answer-context-only'
    ? { label: '답변 확인', description: 'AI에게 미리 고른 공고 내용을 보여준 뒤 답변을 확인합니다. 여러 공고 중 알맞은 공고를 찾는 능력은 확인하지 않습니다.' }
    : selected?.evaluation_scope === 'source-chunks-retrieval-answer'
      ? { label: '공고 안에서 내용 찾기와 답변 확인', description: '미리 정한 공고 원문 안에서 필요한 부분을 찾고 답변하는 과정을 확인할 수 있습니다. 여러 공고 중 알맞은 공고를 찾는 능력은 확인하지 않습니다.' }
      : null
  const groups = categories.map((item) => ({ ...item, datasets: datasets.filter((dataset) => dataset.selection_guide?.category === item.id) }))
  const unclassified = datasets.filter((dataset) => !dataset.selection_guide)
  const option = (dataset: EvaluationCatalog['datasets'][number]) => <option key={dataset.id} value={dataset.id}>
    {dataset.selection_guide ? `${dataset.selection_guide.title} · ${dataset.case_ids.length}문제` : dataset.label}
  </option>

  return <div className="grid min-w-0 gap-3 md:col-span-2">
    <EvaluationHelp label="평가 자료 선택" title={<div><label htmlFor={id} className="text-base font-semibold text-ink">평가 자료</label><p id={`${id}-help`} className="text-sm text-ink-muted">등록된 평가 자료 {datasets.length}개</p></div>}>
      <div className="grid gap-3">
          <h4 className="text-base font-semibold text-ink">어떤 자료를 골라야 하나요?</h4>
          <p className="text-ink-muted">평가 자료는 공고 내용, 질문, 답변을 확인할 기준을 묶어 둔 것입니다. 같은 질문이 여러 묶음에 포함될 수 있습니다. 모든 자료를 실행할 필요는 없습니다.</p>
          <ul aria-label="평가 자료 용도 안내" className="grid list-none gap-2 p-0 sm:grid-cols-3">
            {groups.map((group) => <li key={group.id} className={`min-w-0 rounded-xl border p-3 ${category?.id === group.id ? 'border-brand-primary bg-brand-soft' : 'border-line bg-surface-muted'}`}>
              <p className="font-semibold">{group.label} <span className="ml-1 font-normal text-ink-muted">{group.datasets.length}개</span></p>
              <p className="mt-1 text-ink-muted">{group.description}</p>
            </li>)}
          </ul>
          {unclassified.length > 0 && <p className="text-ink-muted">분류 확인 필요 {unclassified.length}개 · 용도 설명이 없는 자료도 전체 개수에 포함됩니다.</p>}
          <details className="min-w-0 rounded-lg border border-line">
            <summary className="min-h-11 cursor-pointer px-3 py-2 font-semibold focus-visible:outline-2 focus-visible:outline-brand-primary">등록 자료 구성 보기</summary>
            <div className="min-w-0 px-3 pb-3">
              <table className="w-full border-collapse text-left text-sm leading-6 [overflow-wrap:anywhere]">
                <caption className="sr-only">등록된 평가 자료 구성</caption>
                <thead className="sr-only sm:not-sr-only"><tr className="border-b border-line text-ink-muted"><th scope="col" className="w-1/3 py-2 pr-4 font-semibold">자료 이름</th><th scope="col" className="py-2 pr-4 font-semibold">용도</th><th scope="col" className="py-2 pr-4 font-semibold">사례 수</th><th scope="col" className="py-2 font-semibold">평가 목적</th></tr></thead>
                <tbody className="block sm:table-row-group">{datasets.map((dataset) => <tr key={dataset.id} className="block border-b border-line py-3 last:border-0 sm:table-row"><th scope="row" className="block pb-1 text-left font-semibold sm:table-cell sm:py-3 sm:pr-4 sm:align-top">{dataset.selection_guide?.title ?? dataset.label}</th><td className="block text-ink-muted sm:table-cell sm:py-3 sm:pr-4 sm:align-top"><span aria-hidden="true" className="font-semibold sm:hidden">용도: </span><span>{categories.find((item) => item.id === dataset.selection_guide?.category)?.label ?? '분류 확인 필요'}</span></td><td className="block text-ink-muted sm:table-cell sm:py-3 sm:pr-4 sm:align-top"><span aria-hidden="true" className="font-semibold sm:hidden">사례 수: </span><span>{dataset.case_ids.length}개</span></td><td className="block text-ink-muted sm:table-cell sm:py-3 sm:align-top"><span aria-hidden="true" className="font-semibold sm:hidden">평가 목적: </span><span>{dataset.selection_guide?.purpose ?? '용도 설명이 제공되지 않았습니다.'}</span></td></tr>)}</tbody>
              </table>
            </div>
          </details>
      </div>
    </EvaluationHelp>
    <select id={id} aria-describedby={`${id}-help`} className="min-h-11 w-full min-w-0 rounded-xl border border-line bg-white px-3 text-base focus:outline-2 focus:outline-brand-primary"
      value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
      <option value="" disabled>평가 자료를 선택하세요</option>
      {groups.filter((group) => group.datasets.length > 0).map((group) => <optgroup key={group.id} label={group.label}>{group.datasets.map(option)}</optgroup>)}
      {unclassified.length > 0 && <optgroup label="분류 확인 필요">{unclassified.map(option)}</optgroup>}
    </select>
    {selected && <section aria-label="선택한 평가 자료 설명" aria-live="polite" className="min-w-0 rounded-xl border border-line p-4 text-sm leading-6">
      <div className="flex flex-wrap items-center gap-2"><span className={workspaceTagClassName('info')}>{category?.label ?? '분류 확인 필요'}</span><span className="text-ink-muted">질문 {selected.case_ids.length}개</span></div>
      <EvaluationHelp label="선택한 평가 자료" title={<h4 className="min-w-0 text-base font-bold break-words text-ink">{guide?.title ?? selected.label}</h4>}>
        <div className="grid gap-3 text-ink-muted">
            <h5 className="text-base font-semibold text-ink">사용 자료와 평가 범위</h5>
            <p>아래의 <strong>기존 답변 다시 확인</strong>은 이전에 저장한 답변을 다시 확인하며 AI 호출이나 검색을 하지 않습니다. <strong>새 응답 생성</strong>은 AI가 다시 답변하며 비용이 발생할 수 있습니다.</p>
            {guide && <dl className="grid gap-3"><div><dt className="font-semibold text-ink">사용 자료</dt><dd className="mt-1">{guide.material}</dd></div><div><dt className="font-semibold text-ink">평가 범위와 한계</dt><dd className="mt-1">{guide.limitations}</dd></div></dl>}
            <p>자료 분류는 검토 승인이나 품질 합격을 뜻하지 않습니다. v1·v2·v3는 자료의 수정 버전이며, H01 같은 표시는 질문 번호입니다.</p>
        </div>
      </EvaluationHelp>
      {scope && <p className="text-ink-muted"><strong className="text-ink">{scope.label}:</strong> {scope.description}</p>}
      {guide ? <p className="mt-2 text-ink-muted"><strong className="text-ink">평가 목적:</strong> {guide.purpose}</p> : <p className="mt-2 text-ink-muted">이 자료의 용도 설명이 아직 제공되지 않았습니다. 자료 이름만으로 실제 품질 평가용인지 판단하지 마세요.</p>}
    </section>}
  </div>
}
