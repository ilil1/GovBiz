import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { browseSupportProgramsApi } from '../../../data/api/supportProgramCatalogApi'
import { isOfficialSupportProgramSourceUrl } from '../../../data/models/SupportProgramDto'
import { defaultProgramSelectionFilters } from '../../shared/support-program/catalogSearchParams'
import { archiveManagedDataset, createManagedDataset, getManagedDatasets, OpsApiError, publishManagedDataset, saveManagedDataset, type ManagedDataset, type ManagedDatasetContent } from '../../../data/ops/opsApi'
import { WorkspacePageHeader } from '../../shared/workspace/WorkspacePageHeader'
import { workspacePageStyles as styles, workspaceTagClassName } from '../../shared/workspace/WorkspacePage.styles'
import { createRequestId } from './requestId'

const field = 'min-h-11 w-full min-w-0 rounded-xl border border-line bg-white px-3 py-2 text-sm font-normal focus:outline-2 focus:outline-brand-primary'
const freshCase = (id: string, documentId: string): ManagedDatasetContent['cases'][number] => ({ id, document_id: documentId, question: '', expected_status: 'ANSWERED', expected_citation_orders: [], reference_facts: [], forbidden_claims: [], answer: null })
const emptyContent = (): ManagedDatasetContent => ({ title: '', description: '', documents: [{ id: 'doc-1', title: '', source_url: '', chunks: [''] }], cases: [freshCase('Q01', 'doc-1')] })
const lines = (value: string) => value.split('\n')
const changed = (a: ManagedDatasetContent, b: ManagedDatasetContent) => JSON.stringify(a) !== JSON.stringify(b)
const toggle = (values: number[], order: number, checked: boolean) => checked ? [...new Set([...values, order])].sort((a, b) => a - b) : values.filter((value) => value !== order)
const nextId = (prefix: string, ids: string[], padded = false) => { let n = 1; while (ids.includes(`${prefix}${padded ? String(n).padStart(2, '0') : n}`)) n += 1; return `${prefix}${padded ? String(n).padStart(2, '0') : n}` }
const date = (value: string) => new Date(value).toLocaleString('ko-KR')
const textAction = 'inline-flex min-h-11 items-center text-sm font-medium text-ink-muted underline underline-offset-4 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary disabled:cursor-not-allowed disabled:opacity-50'
type Operation = { kind: 'save' | 'publish' | 'archive'; request_id: string; expected_version: number; content: ManagedDatasetContent; archived: boolean }
type Step = 0 | 1 | 2


type CatalogProgram = Awaited<ReturnType<typeof browseSupportProgramsApi>>['programs'][number]
type CatalogResult = Awaited<ReturnType<typeof browseSupportProgramsApi>>

/** 저장된 공고의 제공처 요약을 선택하며, 사용자가 이미 작성한 내용은 덮어쓰지 않습니다. */
function CatalogPicker({ index, canImport, onPick }: {
  index: number
  canImport: boolean
  onPick: (program: CatalogProgram) => void
}) {
  const [opened, setOpened] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState<CatalogResult | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [selectedUrl, setSelectedUrl] = useState('')
  const summaryRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!opened) return
    const controller = new AbortController()
    setState('loading')
    setResult(null)
    browseSupportProgramsApi({ ...defaultProgramSelectionFilters, keyword: query, page }, controller.signal)
      .then((data) => { if (!controller.signal.aborted) { setResult(data); setState('ready') } })
      .catch(() => { if (!controller.signal.aborted) setState('error') })
    return () => controller.abort()
  }, [opened, query, page, retry])

  const search = () => { setPage(1); setQuery(keyword.trim()); setRetry((value) => value + 1); setMessage('') }
  return <div className="grid gap-2"><details open={opened} className="rounded-xl bg-surface-muted p-4" onToggle={(event) => setOpened(event.currentTarget.open)}>
    <summary ref={summaryRef} className="cursor-pointer text-sm font-bold text-brand-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-primary">기존 공고에서 찾기</summary>
    <div className="mt-3 grid gap-3 text-sm">
      <p>선택한 공고의 제목과 제공된 요약·지원 대상만 가져옵니다. 공고 전체나 첨부파일은 가져오지 않으므로 내용을 확인하고 보완해 주세요.</p>
      {!canImport && <p className="text-amber-800">이미 입력했거나 질문·비교 답변에서 사용 중인 공고는 바꿀 수 없습니다. 다른 공고를 추가해 선택해 주세요.</p>}
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-end"><label className="grid min-w-0 flex-1 gap-1 font-semibold">공고 검색어<input aria-label={`공고 ${index} 검색어`} className={field} maxLength={100} value={keyword} onChange={(event) => setKeyword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); search() } }} placeholder="예: 창업 지원" /></label>
      <button type="button" className={`${styles.secondaryButton} min-h-11 sm:shrink-0`} onClick={search} disabled={state === 'loading'}>공고 검색</button></div>
      {state === 'loading' && <p role="status">공고를 불러오고 있습니다.</p>}
      {state === 'error' && <div role="alert" className="grid gap-2"><p>공고를 불러오지 못했습니다. 다시 시도해 주세요.</p><button type="button" className={`${styles.secondaryButton} justify-self-start`} onClick={() => setRetry((value) => value + 1)}>다시 시도</button></div>}
      {state === 'ready' && result && (result.programs.length === 0 ? <p>검색 결과가 없습니다. 다른 검색어를 입력해 주세요.</p> : <><ul className="grid gap-2">{result.programs.map((program) => <li key={JSON.stringify([program.sourceCode, program.id])} className="flex flex-col gap-3 rounded-xl border border-line bg-white p-4 sm:flex-row sm:items-center sm:justify-between"><div className="grid min-w-0 gap-1"><p className="font-semibold leading-6 text-ink">{program.title}</p><p className="text-xs text-ink-muted">{program.sourceName} · {program.organization}</p>{isOfficialSupportProgramSourceUrl(program.sourceCode, program.sourceUrl) && <a className="w-fit text-sm text-brand-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary" href={program.sourceUrl} target="_blank" rel="noopener noreferrer">공식 공고 보기</a>}</div><button type="button" aria-label={`공고 선택: ${program.title}`} className={`${styles.secondaryButton} self-start sm:shrink-0 sm:self-center`} disabled={!canImport} onClick={() => {
        if (!canImport) return
        onPick(program)
        const parts = [program.summary.trim(), program.targetDescription.trim()].filter(Boolean)
        const safeUrl = isOfficialSupportProgramSourceUrl(program.sourceCode, program.sourceUrl) ? program.sourceUrl : ''
        const isLong = program.title.length > 300 || parts.join('\n\n').length > 12000 || program.sourceUrl.length > 2000 || !safeUrl
        setMessage(isLong ? '일부 내용이 길어 잘리거나 주소가 제외되었습니다. 공식 공고를 확인하고 내용을 보완해 주세요.' : parts.length ? '공고의 제목과 제공된 내용을 가져왔습니다. 원문을 확인하고 필요한 내용을 보완해 주세요.' : '공고 제목을 가져왔습니다. 제공된 내용이 없어 직접 입력해 주세요.')
        setSelectedUrl(safeUrl)
        summaryRef.current?.focus()
        setOpened(false)
      }}>이 공고 선택</button></li>)}</ul><div className="flex flex-wrap items-center gap-2"><button type="button" className={styles.secondaryButton} disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>이전 결과</button><span>{result.page} / {result.totalPages} 페이지 · 총 {result.total}개</span><button type="button" className={styles.secondaryButton} disabled={page >= result.totalPages} onClick={() => setPage((value) => value + 1)}>다음 결과</button></div></>)}
    </div>
  </details>{message && <div className="grid gap-1 text-sm"><p role="status">{message}</p>{selectedUrl && <a className="w-fit text-brand-primary underline" href={selectedUrl} target="_blank" rel="noopener noreferrer">선택한 공고의 공식 원문 보기</a>}</div>}</div>
}

function hasQuestionWork(content: ManagedDatasetContent, id: string): boolean {
  return content.cases.some((item) => item.document_id === id && (
    Boolean(item.question.trim()) || item.expected_status !== 'ANSWERED'
    || item.expected_citation_orders.length > 0 || item.reference_facts.some((value) => value.trim())
    || item.forbidden_claims.some((value) => value.trim()) || Boolean(item.answer?.text.trim())
    || (item.answer?.citation_orders.length ?? 0) > 0
  ))
}

function canImportCatalogDocument(content: ManagedDatasetContent, id: string): boolean {
  const doc = content.documents.find((value) => value.id === id)
  return Boolean(doc && !doc.title.trim() && !doc.source_url.trim() && doc.chunks.length <= 1
    && doc.chunks.every((chunk) => !chunk.trim()) && !hasQuestionWork(content, id))
}

function clipInput(value: string, max: number): string {
  const clipped = value.slice(0, max)
  return /[\uD800-\uDBFF]$/.test(clipped) ? clipped.slice(0, -1) : clipped
}

type PublicationCheck = { label: string; missingLabel: string; step: Step; caseId?: string; targetStep?: Step; complete: boolean }

function checksForPublish(content: ManagedDatasetContent): PublicationCheck[] {
  const checks: PublicationCheck[] = []
  const add = (label: string, missingLabel: string, step: Step, complete: boolean, caseId?: string, targetStep?: Step) => {
    checks.push({ label, missingLabel, step, complete, caseId, targetStep })
  }
  add('자료 이름', '자료 이름을 입력하세요.', 0, Boolean(content.title.trim()))
  if (!content.documents.length) add('공고', '공고를 하나 이상 추가하세요.', 0, false)
  content.documents.forEach((doc, index) => {
    add(`공고 ${index + 1} 제목`, `공고 ${index + 1}의 제목을 입력하세요.`, 0, Boolean(doc.title.trim()))
    add(`공고 ${index + 1} 내용`, `공고 ${index + 1}의 내용을 입력하세요.`, 0, doc.chunks.length > 0 && doc.chunks.every((chunk) => Boolean(chunk.trim())))
  })
  if (!content.cases.length) add('질문', '질문을 하나 이상 추가하세요.', 1, false)
  content.cases.forEach((item, index) => {
    const prefix = `질문 ${index + 1}`
    const addCase = (label: string, missingLabel: string, complete: boolean) => add(`${prefix} ${label}`, `${prefix} ${missingLabel}`, 1, complete, item.id)
    addCase('내용', '내용을 입력하세요.', Boolean(item.question.trim()))
    const linkedDoc = content.documents.find((doc) => doc.id === item.document_id)
    add(`${prefix} 공고 선택`, `${prefix} 공고를 입력하거나 선택하세요.`, 1, Boolean(linkedDoc?.title.trim()), item.id, content.documents.length > 1 && content.documents.some((doc) => doc.title.trim()) ? 1 : 0)
    if (item.expected_status === 'ANSWERED') addCase('AI 답변의 출처', 'AI 답변의 출처로 표시할 공고 내용을 선택하세요.', item.expected_citation_orders.length > 0)
    addCase('답변에서 살펴볼 내용', '답변을 확인할 때 살펴볼 내용을 입력하세요.', item.reference_facts.length > 0 && item.reference_facts.every((fact) => Boolean(fact.trim())))
    addCase('직접 작성한 비교용 답변', '직접 작성한 비교용 답변을 입력하세요.', Boolean(item.answer?.text.trim()))
    if (item.answer?.text.trim() && item.answer.status === 'ANSWERED') addCase('비교용 답변의 출처', '비교용 답변이 참고한 공고 내용을 선택하세요.', item.answer.citation_orders.length > 0)
  })
  return checks
}

export function DatasetManagementPage({ owner, onExpired }: { owner: string; onExpired: () => void }) {
  const [datasets, setDatasets] = useState<ManagedDataset[]>([])
  const [builtinCount, setBuiltinCount] = useState(0)
  const [selected, setSelected] = useState<ManagedDataset | null>(null)
  const [draft, setDraft] = useState(emptyContent)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [conflict, setConflict] = useState(false)
  const [pending, setPending] = useState<Operation | null>(null)
  const [confirmPublish, setConfirmPublish] = useState(false)
  const [confirmClearDoc, setConfirmClearDoc] = useState<string | null>(null)
  const [pickerResets, setPickerResets] = useState<Record<string, number>>({})
  const clearButtons = useRef<Record<string, HTMLButtonElement | null>>({})
  const documentHeadings = useRef<Record<string, HTMLHeadingElement | null>>({})
  const [navigation, setNavigation] = useState<ManagedDataset | 'new' | 'reload' | 'evaluation' | 'list' | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [step, setStep] = useState<Step>(0)
  const [activeCase, setActiveCase] = useState('Q01')
  const [editorOpen, setEditorOpen] = useState(false)
  const goToPage = useNavigate()
  const expiry = useRef(onExpired); expiry.current = onExpired
  const selectedId = useRef<string | null>(null)
  const submitting = useRef(false)
  const listHeading = useRef<HTMLHeadingElement>(null)
  const editorHeading = useRef<HTMLHeadingElement>(null)
  const focusTarget = useRef<'list' | 'editor' | null>(null)
  const stepHeading = useRef<HTMLHeadingElement>(null)
  const focusNextStep = useRef(false)
  useEffect(() => {
    const target = focusTarget.current === 'editor' ? editorHeading.current : focusTarget.current === 'list' ? listHeading.current : null
    if (target) { target.focus(); focusTarget.current = null }
  }, [editorOpen])
  useEffect(() => {
    if (editorOpen && focusNextStep.current) { focusNextStep.current = false; stepHeading.current?.focus() }
  }, [editorOpen, step])
  const original = selected?.content ?? emptyContent()
  const dirty = changed(draft, original)
  const locked = busy || pending !== null || conflict || loading
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    getManagedDatasets(controller.signal).then((data) => {
      if (controller.signal.aborted) return
      setDatasets(data.datasets); setBuiltinCount(data.builtin_count)
      if (selectedId.current) {
        const current = data.datasets.find((item) => item.id === selectedId.current) ?? null
        setSelected(current); setDraft(current?.content ?? emptyContent())
      }
      setConflict(false); setError(''); setPending(null)
    }).catch((reason) => {
      if (controller.signal.aborted) return
      if (reason instanceof OpsApiError && [401, 403].includes(reason.status)) expiry.current()
      else setError(reason instanceof Error ? reason.message : '평가 자료를 불러오지 못했습니다.')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [reloadKey])
  const choose = (target: ManagedDataset | 'new' | 'reload' | 'list') => {
    if (busy) return
    if (dirty || pending) { setNavigation(target); return }
    navigate(target)
  }
  const navigate = (target: ManagedDataset | 'new' | 'reload' | 'evaluation' | 'list') => {
    setNavigation(null); setError(''); setNotice(''); setPending(null); setConfirmPublish(false); setConfirmClearDoc(null); setPickerResets({}); setConflict(false)
    if (target === 'evaluation') { goToPage('/ops/evaluations/new'); return }
    if (target === 'list') { focusTarget.current = 'list'; selectedId.current = null; setSelected(null); setDraft(emptyContent()); setEditorOpen(false); setStep(0); return }
    if (target === 'reload') { if (!selectedId.current) setDraft(emptyContent()); setReloadKey((value) => value + 1); return }
    const value = target === 'new' ? null : target
    focusTarget.current = 'editor'; setStep(0); setActiveCase(value?.content.cases[0]?.id ?? 'Q01'); setEditorOpen(true)
    selectedId.current = value?.id ?? null; setSelected(value); setDraft(value?.content ?? emptyContent())
  }
  const moveToStep = (next: Step) => { if (next !== step) { focusNextStep.current = true; setStep(next) } }
  const update = (value: ManagedDatasetContent) => { setDraft(value); setConfirmPublish(false); setNotice('') }
  const docChange = (id: string, patch: Partial<ManagedDatasetContent['documents'][number]>) => update({ ...draft, documents: draft.documents.map((doc) => doc.id === id ? { ...doc, ...patch } : doc) })
  const caseChange = (id: string, patch: Partial<ManagedDatasetContent['cases'][number]>) => update({ ...draft, cases: draft.cases.map((item) => item.id === id ? { ...item, ...patch } : item) })
  const clearDocument = (id: string) => {
    if (locked || selected?.archived || hasQuestionWork(draft, id)) return
    docChange(id, { title: '', source_url: '', chunks: [''] })
    setConfirmClearDoc(null)
    setPickerResets((values) => ({ ...values, [id]: (values[id] ?? 0) + 1 }))
    documentHeadings.current[id]?.focus()
  }
  const importCatalog = (id: string, program: CatalogProgram) => {
    setDraft((current) => {
      if (!canImportCatalogDocument(current, id)) return current
      const chunks = [program.summary.trim(), program.targetDescription.trim()].filter(Boolean)
      return { ...current, documents: current.documents.map((doc) => doc.id === id ? {
        ...doc,
        title: clipInput(program.title, 300),
        source_url: program.sourceUrl.length <= 2000 && isOfficialSupportProgramSourceUrl(program.sourceCode, program.sourceUrl) ? program.sourceUrl : '',
        chunks: [clipInput(chunks.join('\n\n'), 12000)],
      } : doc) }
    })
    setConfirmPublish(false)
    setNotice('')
  }
  const save = async (kind: Operation['kind']) => {
    if (submitting.current || conflict || loading) return
    if (kind === 'save' && !pending && !draft.title.trim()) { moveToStep(0); setError('초안을 저장하려면 자료 이름을 입력하세요.'); return }
    const content = structuredClone(draft)
    content.cases.forEach((item) => { item.forbidden_claims = item.forbidden_claims.filter((claim) => claim.trim()) })
    let operation: Operation
    try {
      operation = pending ?? { kind, request_id: createRequestId(), expected_version: selected?.version ?? 0, content, archived: !selected?.archived }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '요청 ID를 만들지 못했습니다.')
      return
    }
    submitting.current = true; setBusy(true); setError(''); setNotice(''); setPending(operation)
    try {
      const input = { request_id: operation.request_id, expected_version: operation.expected_version }
      const result = operation.kind === 'save'
        ? selected ? await saveManagedDataset(selected.id, { ...input, content: operation.content }, owner) : await createManagedDataset({ ...input, content: operation.content }, owner)
        : operation.kind === 'publish' ? await publishManagedDataset(selected!.id, input, owner)
          : await archiveManagedDataset(selected!.id, { ...input, archived: operation.archived }, owner)
      selectedId.current = result.id; setSelected(result); setDraft(result.content); setDatasets((values) => [result, ...values.filter((item) => item.id !== result.id)])
      setPending(null); setConfirmPublish(false)
      setNotice(operation.kind === 'save' ? '초안을 저장했습니다. 평가에 사용하려면 내용을 확인한 뒤 버전을 게시하세요.' : operation.kind === 'publish' ? '새 평가에서 선택할 자료 버전을 게시했습니다. 평가 실행이나 검토 승인은 하지 않았습니다.' : result.archived ? '자료를 보관했습니다. 기존 평가 이력은 유지됩니다.' : '자료를 복원했습니다. 게시된 버전을 새 평가에서 다시 선택할 수 있습니다.')
    } catch (reason) {
      if (reason instanceof OpsApiError && [401, 403].includes(reason.status)) expiry.current()
      else {
        setError(reason instanceof Error ? reason.message : '자료를 저장하지 못했습니다.')
        if (reason instanceof OpsApiError && [400, 404, 409].includes(reason.status)) { setPending(null); setConflict(reason.status !== 400) }
      }
    } finally { submitting.current = false; setBusy(false) }
  }
  const checks = checksForPublish(draft)
  const missing = checks.filter((item) => !item.complete)
  const guardEvaluationNavigation = (event: MouseEvent<HTMLAnchorElement>) => {
    if (busy) { event.preventDefault(); return }
    if (dirty || pending) { event.preventDefault(); setNavigation('evaluation') }
  }
  return <><WorkspacePageHeader title="평가 자료 관리" actions={editorOpen ? <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => choose('list')}>자료 목록으로</button> : undefined} />
    <div className={styles.content}>
      {!editorOpen && <p className="text-sm leading-6 text-ink-muted">공고에 대한 AI 답변을 확인할 자료를 관리합니다.</p>}
      {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-xl bg-green-50 p-4 text-sm text-brand-primary">{notice}</p>}
      {conflict && <div className="flex flex-wrap items-center gap-3 text-sm text-amber-800"><p>다른 관리자가 자료를 변경했거나 자료 상태가 바뀌었습니다. 입력은 보존했습니다. 목록 새로고침으로 최신 버전을 확인하세요.</p><button type="button" className={styles.secondaryButton} disabled={busy || loading} onClick={() => choose('reload')}>목록 새로고침</button></div>}
      {pending && !busy && <section className="grid gap-3 rounded-xl bg-amber-50 p-4" aria-label="자료 저장 결과 확인"><p className="text-sm">저장이 반영되었을 수 있습니다. 같은 요청으로 재확인하거나 목록을 새로고침하세요. 중복 등록을 피하도록 입력을 잠시 잠갔습니다.</p><button className={styles.secondaryButton} onClick={() => void save(pending.kind)}>같은 저장 요청으로 재확인</button></section>}
      {navigation && <section aria-label="작성 내용 이동 확인" className="grid gap-3 rounded-xl bg-amber-50 p-4 text-sm"><p>저장하지 않은 입력과 확인 중인 요청을 이 화면에서 지우고 이동할까요? 서버에 저장된 자료는 유지됩니다.</p><div className="flex flex-wrap gap-2"><button className={styles.secondaryButton} onClick={() => setNavigation(null)}>계속 작성</button><button className={styles.secondaryButton} onClick={() => navigate(navigation)}>입력 버리고 이동</button></div></section>}
      {!editorOpen && <>
      <section className={styles.card} aria-label="평가 자료 시작">
        <h2 ref={listHeading} tabIndex={-1} className={`${styles.cardTitle} focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-primary`}>어떤 자료로 시작할까요?</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="flex min-w-0 flex-col items-start gap-3 rounded-xl bg-surface-muted p-4 sm:p-5">
            <div className="min-w-0"><h3 className="text-base font-bold text-ink">기본 제공 자료</h3><p className="mt-1 text-sm leading-6 text-ink-muted">준비된 자료를 골라 평가할 수 있습니다.</p></div>
            <p className="text-xs text-ink-muted">{loading ? '자료를 확인하고 있습니다.' : error ? '자료 개수를 확인할 수 없습니다.' : `기본 제공 자료 ${builtinCount}개`}</p>
            <Link className={`${styles.secondaryButton} mt-auto`} to="/ops/evaluations/new" onClick={guardEvaluationNavigation}>기본 제공 자료로 시작하기</Link>
          </div>
          <div className="flex min-w-0 flex-col items-start gap-3 rounded-xl border border-[#b4ddc7] bg-brand-soft p-4 sm:p-5">
            <div className="min-w-0"><h3 className="text-base font-bold text-ink">직접 자료 만들기</h3><p className="mt-1 text-sm leading-6 text-ink-muted">공고와 질문을 직접 작성합니다.</p></div>
            <button type="button" className={`${styles.primaryButton} mt-auto`} disabled={busy || loading} onClick={() => choose('new')}>새 평가 자료 만들기</button>
          </div>
        </div>
      </section>
      <section className={styles.card} aria-label="내가 만든 자료 목록">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className={styles.cardTitle}>내가 만든 자료{!loading && !error ? ` · ${datasets.length}개` : ''}</h2><button type="button" className={textAction} disabled={busy || loading} onClick={() => choose('reload')}>목록 새로고침</button></div>
        {loading ? <p role="status">자료 목록을 불러오고 있습니다.</p> : error ? <p className="text-sm text-ink-muted">자료를 불러오지 못했습니다. 목록 새로고침을 눌러 다시 시도해 주세요.</p> : !datasets.length ? <p className="text-sm text-ink-muted">아직 직접 만든 자료가 없습니다.</p> : <ul className="grid gap-2">{datasets.map((item) => <li key={item.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3"><div className="min-w-0"><button className="break-words text-left font-semibold text-brand-primary underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary" disabled={busy} onClick={() => choose(item)}>{item.content.title || '이름 없는 초안'}</button><p className="mt-1 text-xs leading-5 text-ink-muted">초안 버전 {item.version} · 질문 {item.content.cases.length}개 · 게시 {item.revisions.length}개 · 수정 {date(item.updated_at)}</p></div><span className={workspaceTagClassName(item.archived ? 'info' : item.revisions.length ? 'ok' : 'info')}>{item.archived ? '보관됨' : item.revisions.length ? '게시 버전 있음' : '초안'}</span></li>)}</ul>}
      </section>
      </>}
      {editorOpen && <section className={styles.card} aria-label="평가 자료 작성">
        <h2 ref={editorHeading} tabIndex={-1} className={`${styles.cardTitle} focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-primary`}>{selected ? `${selected.content.title || '이름 없는 초안'} 수정` : '새 자료 작성'}</h2>
        <nav aria-label="자료 작성 단계" className="grid grid-cols-1 gap-2 pb-3 sm:grid-cols-3">
          {(['1. 공고 입력', '2. 질문·비교 답변', '3. 평가 준비 확인'] as const).map((label, index) => <button key={label} type="button" aria-label={label} aria-current={step === index ? 'step' : undefined} disabled={busy} onClick={() => setStep(index as Step)} className={`flex min-h-12 min-w-0 items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary disabled:cursor-not-allowed disabled:opacity-50 ${step === index ? 'bg-brand-soft text-brand-primary' : 'bg-surface-muted text-ink-muted hover:text-ink'}`}><span aria-hidden="true" className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${step === index ? 'bg-brand-primary text-white' : 'bg-white text-ink-muted'}`}>{index + 1}</span><span aria-hidden="true">{label.slice(3)}</span></button>)}
        </nav>
        {selected?.archived && <p className="rounded-lg bg-amber-50 p-3 text-sm">보관한 자료입니다. 복원한 뒤 초안 수정과 게시를 할 수 있습니다.</p>}
        <form noValidate onSubmit={(event) => { event.preventDefault(); void save('save') }}>
          <fieldset disabled={locked || selected?.archived} className="grid min-w-0 gap-5 border-0 p-0">
            {step === 0 && <>
            <div className="grid gap-3"><div className="relative flex items-center gap-1"><h3 ref={stepHeading} tabIndex={-1} className="font-bold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-primary">1. 공고 내용을 알려주세요</h3><details className="text-sm leading-6"><summary aria-label="공고 입력 도움말" className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary [&::-webkit-details-marker]:hidden"><span aria-hidden="true" className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-brand-primary font-semibold text-brand-primary">?</span></summary><div className="absolute left-0 top-full z-10 grid w-full gap-2 rounded-xl border border-line bg-white p-4 shadow-lg"><p>이 자료로 공고 내용에 대한 질문에 AI가 잘 답하는지 확인할 수 있습니다.</p><p>공고에서 질문에 답할 때 필요한 부분을 복사해 내용에 붙여넣으세요.</p><p>예: 지원 대상이 “창업 3년 이내 기업”이라는 내용</p><p>자료를 저장하거나 등록할 때는 AI가 실행되지 않습니다. 나중에 새 AI 평가를 실행하면 입력한 공고 내용이 AI 모델에 전달됩니다.</p></div></details></div><label className="grid gap-1 text-sm font-semibold">자료 이름 · 필수<input className={field} required maxLength={150} value={draft.title} onChange={(event) => update({ ...draft, title: event.target.value })} placeholder="예: 우리 지역 창업 지원사업 신청 조건" /></label><details className="rounded-lg bg-surface-muted p-3"><summary className="cursor-pointer text-sm font-semibold">자료 설명 추가 · 선택</summary><label className="mt-3 grid gap-1 text-sm">자료 설명<textarea className={field} rows={2} maxLength={2000} value={draft.description} onChange={(event) => update({ ...draft, description: event.target.value })} placeholder="어떤 답변을 확인하려는지 적어 주세요." /></label></details></div>
            <section className="grid gap-3" aria-label="원문 근거 입력">
              {draft.documents.map((doc, docIndex) => <article key={doc.id} className="grid min-w-0 gap-4 rounded-2xl border border-line bg-white p-4 sm:p-5" aria-label={`공고 ${docIndex + 1} 입력`}><h4 ref={(element) => { documentHeadings.current[doc.id] = element }} tabIndex={-1} className="text-base font-bold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary">공고 {docIndex + 1}</h4><CatalogPicker key={`${doc.id}-${pickerResets[doc.id] ?? 0}`} index={docIndex + 1} canImport={canImportCatalogDocument(draft, doc.id)} onPick={(program) => importCatalog(doc.id, program)} /><label className="grid gap-1 text-sm">제목 · 필수<input aria-label={`공고 ${docIndex + 1} 제목 · 필수`} className={field} value={doc.title} maxLength={300} onChange={(event) => docChange(doc.id, { title: event.target.value })} /></label>
                {doc.chunks.map((chunk, chunkIndex) => <div key={chunkIndex} className="grid gap-2"><label className="grid gap-1 text-sm">내용 {chunkIndex + 1} · 필수<textarea aria-label={`공고 ${docIndex + 1} 내용 ${chunkIndex + 1} · 필수`} className={field} rows={4} maxLength={12000} value={chunk} onChange={(event) => docChange(doc.id, { chunks: doc.chunks.map((text, index) => index === chunkIndex ? event.target.value : text) })} placeholder="예: 창업 3년 이내 기업을 지원합니다." /></label></div>)}
                <details className="rounded-lg bg-surface-muted p-3"><summary className="cursor-pointer text-sm font-semibold">공고 주소 추가 · 선택</summary><p className="mt-2 text-xs text-ink-muted">주소만으로 공고 내용이나 첨부파일을 가져오지 않습니다.</p><label className="mt-2 grid gap-1 text-sm">주소<input aria-label={`공고 ${docIndex + 1} 주소`} className={field} type="url" value={doc.source_url} maxLength={2000} onChange={(event) => docChange(doc.id, { source_url: event.target.value })} placeholder="https://공식-공고-주소" /></label></details>
                {(doc.title !== '' || doc.source_url !== '' || doc.chunks.length > 1 || doc.chunks.some((chunk) => chunk !== '')) && <div className="grid gap-2">
                  <button ref={(element) => { clearButtons.current[doc.id] = element }} type="button" className={`${textAction} justify-self-start`} disabled={hasQuestionWork(draft, doc.id)} onClick={() => setConfirmClearDoc(doc.id)}>공고 {docIndex + 1} 비우고 다시 선택</button>
                  {hasQuestionWork(draft, doc.id) && <p className="text-xs text-ink-muted">연결된 질문에서 작성한 내용을 먼저 정리해 주세요.</p>}
                  {confirmClearDoc === doc.id && <section aria-label={`공고 ${docIndex + 1} 내용 비우기 확인`} className="grid gap-3 rounded-xl bg-amber-50 p-4 text-sm"><p>제목·내용·주소가 지워집니다. 임시 저장 전에는 저장된 자료에 반영되지 않습니다.</p><div className="flex flex-wrap gap-2"><button type="button" className={styles.secondaryButton} disabled={hasQuestionWork(draft, doc.id)} onClick={() => clearDocument(doc.id)}>비우기</button><button type="button" className={styles.secondaryButton} onClick={() => { setConfirmClearDoc(null); clearButtons.current[doc.id]?.focus() }}>계속 작성</button></div></section>}
                </div>}
                {(doc.chunks.length > 1 || draft.documents.length > 1) && <div className="flex flex-wrap gap-2">{doc.chunks.length > 1 && <button type="button" className={textAction} disabled={draft.cases.some((item) => item.document_id === doc.id && (item.expected_citation_orders.includes(doc.chunks.length - 1) || item.answer?.citation_orders.includes(doc.chunks.length - 1)))} onClick={() => docChange(doc.id, { chunks: doc.chunks.slice(0, -1) })}>마지막 내용 삭제</button>}{draft.documents.length > 1 && <button type="button" className={textAction} disabled={draft.cases.some((item) => item.document_id === doc.id)} onClick={() => update({ ...draft, documents: draft.documents.filter((item) => item.id !== doc.id) })}>공고 {docIndex + 1} 삭제</button>}</div>}
                {doc.chunks.length > 1 && draft.cases.some((item) => item.document_id === doc.id && (item.expected_citation_orders.includes(doc.chunks.length - 1) || item.answer?.citation_orders.includes(doc.chunks.length - 1))) && <p className="text-xs text-ink-muted">질문이나 비교 답변에서 마지막 내용을 출처로 사용 중입니다. 먼저 출처 선택을 해제해 주세요.</p>}
                {draft.documents.length > 1 && draft.cases.some((item) => item.document_id === doc.id) && <p className="text-xs text-ink-muted">질문에서 이 공고를 사용 중입니다. 질문의 공고 선택을 바꾼 뒤 삭제해 주세요.</p>}
              </article>)}
              {draft.documents.length ? <details className="rounded-lg bg-surface-muted p-3"><summary className="cursor-pointer text-sm font-semibold">공고나 내용을 더 넣기 · 선택</summary><div className="mt-3 grid gap-3 text-sm"><div className="grid gap-2"><p>다른 지원사업을 평가하려면 공고를 추가하세요.</p><button type="button" className={`${styles.secondaryButton} justify-self-start`} disabled={draft.documents.length >= 3} onClick={() => update({ ...draft, documents: [...draft.documents, { id: nextId('doc-', draft.documents.map((doc) => doc.id)), title: '', source_url: '', chunks: [''] }] })}>다른 공고 추가</button>{draft.documents.length >= 3 && <p className="text-xs text-ink-muted">공고는 최대 3개까지 추가할 수 있습니다.</p>}</div><div className="grid gap-2"><p>같은 공고의 내용을 지원 대상, 신청 기간처럼 나눌 수 있습니다.</p><div className="flex flex-wrap gap-2">{draft.documents.map((doc, docIndex) => <button key={doc.id} type="button" className={styles.secondaryButton} disabled={doc.chunks.length >= 5} onClick={() => docChange(doc.id, { chunks: [...doc.chunks, ''] })}>공고 {docIndex + 1}에 내용 나눠 추가</button>)}</div>{draft.documents.map((doc, docIndex) => doc.chunks.length >= 5 && <p key={doc.id} className="text-xs text-ink-muted">공고 {docIndex + 1}의 내용은 최대 5개까지 추가할 수 있습니다.</p>)}</div></div></details> : <button type="button" className={`${styles.secondaryButton} justify-self-start`} onClick={() => update({ ...draft, documents: [{ id: nextId('doc-', []), title: '', source_url: '', chunks: [''] }] })}>첫 공고 추가</button>}
            </section>
            </>}
            {step === 1 && <>
            <section className="grid gap-3" aria-label="질문과 채점 조건 입력"><div className="relative flex items-center gap-1"><h3 ref={stepHeading} tabIndex={-1} className="font-bold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-primary">2. 질문과 비교 답변을 적어주세요</h3><details className="text-sm leading-6"><summary aria-label="질문 작성 도움말" className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary [&::-webkit-details-marker]:hidden"><span aria-hidden="true" className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-brand-primary font-semibold text-brand-primary">?</span></summary><div className="absolute left-0 top-full z-10 grid w-full gap-2 rounded-xl border border-line bg-white p-4 shadow-lg"><p>예: 공고에 “창업 3년 이내 기업이 신청할 수 있습니다”라고 적혀 있다면</p><p>① 질문: “누가 신청할 수 있나요?”</p><p>② AI 답변의 출처: AI가 근거로 보여주길 바라는 공고 부분을 선택하세요.</p><p>③ 확인할 내용: “창업 3년 이내 기업”을 적습니다. 사람이 검토할 기준이며, 자동으로 사실을 확인하지 않습니다.</p><p>④ 비교용 답변: “창업 3년 이내 기업이 신청할 수 있습니다.”를 직접 적습니다. AI가 작성한 답변이 아닙니다.</p><p>⑤ 비교 답변의 출처: 직접 답을 쓸 때 참고한 공고 부분을 선택하세요.</p><p>공고를 바꾸면 출처를 다시 선택해야 합니다. 공고에 답이 없으면 답변 가능 여부를 ‘아니요’로 설정하세요.</p></div></details></div>
              {draft.cases.map((item, index) => { const doc = draft.documents.find((value) => value.id === item.document_id); return <details key={item.id} open={item.id === activeCase || index === 0 || undefined} className="min-w-0 rounded-xl border border-line p-4"><summary className="cursor-pointer font-semibold">질문 {index + 1} · {item.question || '새 질문'}</summary><div className="mt-4 grid gap-3">
                <label className="grid gap-1 text-sm">질문 내용 · 필수<textarea aria-label={`질문 ${index + 1} 내용 · 필수`} className={field} rows={2} maxLength={500} value={item.question} onChange={(event) => caseChange(item.id, { question: event.target.value })} placeholder="예: 누가 신청할 수 있나요?" /></label>
                {draft.documents.length === 1 && doc ? <p className="text-sm">{doc.title.trim() ? <>제공할 공고: {doc.title} <span className="text-ink-muted">· 자동 선택됨</span></> : '공고를 먼저 입력하거나 선택해 주세요.'}</p> : <label className="grid gap-1 text-sm">제공할 공고<select aria-label={`질문 ${index + 1} 제공할 공고`} className={field} value={item.document_id} onChange={(event) => caseChange(item.id, { document_id: event.target.value, expected_citation_orders: [], answer: item.answer ? { ...item.answer, citation_orders: [] } : null })}>{draft.documents.map((value, docIndex) => <option key={value.id} value={value.id}>공고 {docIndex + 1} · {value.title || '제목 미입력'}</option>)}</select></label>}
                <div className="text-sm"><details className="rounded-lg bg-surface-muted p-3"><summary aria-label={`공고 내용으로 답할 수 있나요? ${item.expected_status === 'ANSWERED' ? '네' : '아니요'} · 변경`} className="cursor-pointer font-semibold">공고 내용으로 답할 수 있나요? <strong>{item.expected_status === 'ANSWERED' ? '네' : '아니요'}</strong> · 변경</summary><p className="my-2 text-xs text-ink-muted">공고만으로 답할 수 없는 질문을 시험할 때만 아니요를 선택하세요.</p><label className="grid gap-1">공고 내용으로 답할 수 있나요?<select aria-label={`질문 ${index + 1} 공고 내용으로 답할 수 있나요?`} className={field} value={item.expected_status} onChange={(event) => caseChange(item.id, { expected_status: event.target.value as typeof item.expected_status, expected_citation_orders: event.target.value === 'INSUFFICIENT_EVIDENCE' ? [] : item.expected_citation_orders })}><option value="ANSWERED">네, 공고 내용으로 답할 수 있어요</option><option value="INSUFFICIENT_EVIDENCE">아니요, 공고에 답이 없어요</option></select></label></details></div>
                <fieldset aria-label={`질문 ${index + 1} AI 답변이 출처로 표시해야 할 공고 내용 · 답할 수 있을 때 필수`} className="rounded-lg border border-line p-3" disabled={item.expected_status === 'INSUFFICIENT_EVIDENCE'}><legend className="px-1 text-sm"><span className="sr-only">질문 {index + 1} </span>AI 답변이 출처로 표시해야 할 공고 내용 · 답할 수 있을 때 필수</legend>{doc?.chunks.map((chunk, order) => <label key={order} className="mt-2 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={item.expected_citation_orders.includes(order)} onChange={(event) => caseChange(item.id, { expected_citation_orders: toggle(item.expected_citation_orders, order, event.target.checked) })} /><span>공고 내용 {order + 1} · {chunk.slice(0, 80) || '아직 입력하지 않음'}</span></label>)}</fieldset>
                <label className="grid gap-1 text-sm">답변을 확인할 때 살펴볼 내용 · 필수 · 한 줄에 하나<textarea aria-label={`질문 ${index + 1} 답변을 확인할 때 살펴볼 내용 · 필수 · 한 줄에 하나`} className={field} rows={3} maxLength={36029} value={item.reference_facts.join('\n')} onChange={(event) => caseChange(item.id, { reference_facts: lines(event.target.value) })} placeholder="예: 지원 대상은 창업 3년 이내 기업" /></label>
                <details className="rounded-lg bg-surface-muted p-3"><summary className="cursor-pointer text-sm font-semibold">잘못된 답변 예시 추가 · 선택</summary><label className="mt-3 grid gap-1 text-sm">답변에 들어가면 안 되는 내용 · 한 줄에 하나<textarea aria-label={`질문 ${index + 1} 답변에 들어가면 안 되는 내용 · 한 줄에 하나`} className={field} rows={2} maxLength={36029} value={item.forbidden_claims.join('\n')} onChange={(event) => caseChange(item.id, { forbidden_claims: lines(event.target.value) })} placeholder="예: 모든 기업이 조건 없이 신청할 수 있다" /><span className="text-xs text-ink-muted">적지 않으면 이 기준은 확인하지 않은 것으로 표시됩니다.</span></label></details>
                <div className="rounded-lg bg-surface-muted p-3"><label className="grid gap-1 text-sm font-semibold">직접 작성한 비교용 답변 · 필수<textarea aria-label={`질문 ${index + 1} 직접 작성한 비교용 답변 · 필수`} className={field} rows={4} maxLength={1200} value={item.answer?.text ?? ''} onChange={(event) => caseChange(item.id, { answer: event.target.value ? { text: event.target.value, status: item.answer?.status ?? 'ANSWERED', citation_orders: item.answer?.citation_orders ?? [] } : null })} placeholder="예: 창업 3년 이내 기업이 신청할 수 있습니다." /></label>
                  {item.answer && <div className="mt-3 grid gap-3"><div className="text-sm"><p>비교용 답변의 종류: <strong>{item.answer.status === 'ANSWERED' ? '답변함' : '공고에 답이 없어 답변 보류'}</strong></p><details className="mt-2 rounded-lg bg-white p-3"><summary className="cursor-pointer font-semibold">공고에 답이 없어 답변을 보류한 경우</summary><label className="mt-2 grid gap-1">비교용 답변의 종류<select aria-label={`질문 ${index + 1} 비교용 답변의 종류`} className={field} value={item.answer.status} onChange={(event) => caseChange(item.id, { answer: { ...item.answer!, status: event.target.value as typeof item.answer.status, citation_orders: event.target.value === 'INSUFFICIENT_EVIDENCE' ? [] : item.answer!.citation_orders } })}><option value="ANSWERED">답변함</option><option value="INSUFFICIENT_EVIDENCE">공고에 답이 없어 답변을 보류함</option></select></label></details></div><fieldset aria-label={`질문 ${index + 1} 비교용 답변을 쓸 때 참고한 공고 내용 · 답변했다면 필수`} className="rounded-lg border border-line p-3" disabled={item.answer.status === 'INSUFFICIENT_EVIDENCE'}><legend className="px-1 text-sm"><span className="sr-only">질문 {index + 1} </span>비교용 답변을 쓸 때 참고한 공고 내용 · 답변했다면 필수</legend>{doc?.chunks.map((_, order) => <label key={order} className="mr-4 inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={item.answer!.citation_orders.includes(order)} onChange={(event) => caseChange(item.id, { answer: { ...item.answer!, citation_orders: toggle(item.answer!.citation_orders, order, event.target.checked) } })} />공고 내용 {order + 1}</label>)}</fieldset></div>}
                </div>{draft.cases.length > 1 && <button type="button" className={`${textAction} justify-self-start`} onClick={() => update({ ...draft, cases: draft.cases.filter((value) => value.id !== item.id) })}>질문 {index + 1} 삭제</button>}
              </div></details> })}
              <button type="button" className={`${styles.secondaryButton} justify-self-start`} disabled={draft.cases.length >= 12 || !draft.documents.length} onClick={() => { const id = nextId('Q', draft.cases.map((item) => item.id), true); setActiveCase(id); update({ ...draft, cases: [...draft.cases, freshCase(id, draft.documents[0].id)] }) }}>질문 추가</button>
            </section>
            </>}
            {step === 2 && <section aria-label="게시 전 입력 확인" className="grid gap-3"><div className="relative flex items-center gap-1"><h3 ref={stepHeading} tabIndex={-1} className="font-bold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-primary">3. 입력 내용 확인</h3><details className="text-sm leading-6"><summary aria-label="평가 준비 도움말" className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary [&::-webkit-details-marker]:hidden"><span aria-hidden="true" className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-brand-primary font-semibold text-brand-primary">?</span></summary><div className="absolute left-0 top-full z-10 grid w-full gap-2 rounded-xl border border-line bg-white p-4 shadow-lg"><p>임시 저장은 나중에 이어서 작성할 때 사용합니다. 등록하면 새 평가에서 자료를 선택할 수 있습니다.</p><p>저장하거나 등록할 때 AI가 실행되지는 않습니다.</p><p>등록 내용을 수정해 다시 등록해도 이전 평가 기록은 유지됩니다.</p></div></details></div>
              {missing.length ? <div className="grid gap-1 text-sm text-amber-800"><p className="font-semibold">필수 항목 {missing.length}개가 빠져 있어 현재 내용을 등록할 수 없습니다.</p><p>{selected?.archived ? '자료를 복원한 뒤 빠진 항목을 채워 주세요.' : locked ? '위 안내를 확인한 뒤 빠진 항목을 채워 주세요.' : '‘입력하러 가기’를 눌러 빠진 항목을 채워 주세요. 임시 저장에도 자료 이름이 필요합니다.'}</p></div> : <p className="text-sm text-brand-primary">{selected?.archived || locked ? '필수 입력을 확인했습니다.' : dirty ? '입력을 마쳤습니다. 아래에서 임시 저장해 주세요.' : selected && !confirmPublish ? '입력을 마쳤습니다. 아래에서 평가 자료 등록 내용을 확인해 주세요.' : selected && confirmPublish ? '아래에서 등록할 내용을 확인해 주세요.' : '필수 입력을 확인했습니다.'}</p>}
              <div className="grid gap-3">{([{ step: 0, label: '공고 입력 확인' }, { step: 1, label: '질문·비교 답변 확인' }] as const).map((group) => {
                const items = checks.filter((item) => item.step === group.step)
                return <section key={group.step} aria-label={group.label} className="rounded-lg bg-surface-muted p-3">
                  <h4 className="text-sm font-semibold text-ink">{group.label}</h4>
                  <ul className="mt-2 grid gap-1">{items.map((item) => <li key={item.missingLabel} className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-1 text-sm max-[360px]:grid-cols-1">
                    <span className="inline-flex min-w-0 max-w-full flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span aria-hidden="true" className={item.complete ? 'font-bold text-brand-primary' : 'font-bold text-amber-800'}>{item.complete ? '✓' : '✕'}</span>
                      <span>{item.complete ? item.label : item.missingLabel}</span>
                      <span className={item.complete ? 'text-xs text-brand-primary' : 'text-xs text-amber-800'}>{item.complete ? '입력 완료' : '입력 필요'}</span>
                    </span>
                    <button type="button" className="inline-flex min-h-10 justify-self-end whitespace-nowrap items-center justify-center rounded-lg px-3 text-sm font-semibold text-brand-primary underline underline-offset-4 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary" aria-label={item.complete ? `${item.label} 수정하러 가기` : `${item.missingLabel} 입력하러 가기`} onClick={() => { if (item.caseId) setActiveCase(item.caseId); moveToStep(item.targetStep ?? item.step) }}>{item.complete ? '수정하러 가기' : '입력하러 가기'}</button>
                  </li>)}</ul>
                </section>
              })}</div>
            </section>}
            <div className="grid gap-3 pt-4"><div className="flex flex-wrap items-center gap-2">
              {step > 0 && <button type="button" className={styles.secondaryButton} onClick={() => moveToStep(step === 1 ? 0 : 1)}>{step === 1 ? '이전: 자료·공고' : '이전: 질문·비교 답변'}</button>}
              {step < 2 && <button type="button" className={styles.primaryButton} onClick={() => moveToStep(step === 0 ? 1 : 2)}>{step === 0 ? '다음: 질문 작성' : '다음: 평가 준비 확인'}</button>}
              <button className={step === 2 && dirty ? styles.primaryButton : styles.secondaryButton} disabled={!dirty}>{busy ? '저장 중…' : '임시 저장'}</button>
            </div></div>
          </fieldset>
        </form>
        {selected && step === 2 && <section className="mt-5 grid gap-3 border-t border-line pt-4" aria-label="자료 버전 게시와 보관"><h3 className="font-bold">평가 자료 등록과 보관</h3>
          {dirty && <p className="text-sm text-amber-800">변경한 내용을 먼저 임시 저장하세요.</p>}
          {!confirmPublish && <button className={`${styles.primaryButton} justify-self-start`} disabled={locked || selected.archived || dirty || missing.length > 0} onClick={() => setConfirmPublish(true)}>평가 자료 등록 내용 확인</button>}
          {confirmPublish && <section className="grid gap-3 rounded-xl bg-amber-50 p-4 text-sm" aria-label="게시 최종 확인"><p><strong>{selected.content.title}</strong> · 공고 {draft.documents.length}개 · 질문 {draft.cases.length}개를 새 평가용 버전으로 게시합니다. 관리자 입력 답변을 등록하는 것이며 실제 모델 호출·검토 승인·품질 합격은 아닙니다.</p><div className="flex flex-wrap gap-2"><button className={styles.primaryButton} disabled={locked} onClick={() => void save('publish')}>확인하고 평가 자료로 등록</button><button className={styles.secondaryButton} disabled={busy} onClick={() => setConfirmPublish(false)}>계속 수정</button></div></section>}
          {selected.revisions.length > 0 && !selected.archived && <div className="grid gap-2 rounded-xl bg-surface-muted p-4 text-sm"><Link className={`${styles.secondaryButton} justify-self-start`} to="/ops/evaluations/new" onClick={guardEvaluationNavigation}>게시한 자료로 평가하기</Link></div>}
          <details className="pt-3"><summary className="cursor-pointer text-sm font-semibold">자료 관리 및 이전 버전</summary><div className="mt-3 grid gap-3"><p className="text-xs leading-5 text-ink-muted">보관하면 새 평가에서 선택할 수 없습니다. 기존 평가 기록은 유지되며 복원하면 다시 사용할 수 있습니다.</p><button type="button" className={`${textAction} justify-self-start`} disabled={locked || dirty} onClick={() => void save('archive')}>{selected.archived ? '자료 복원' : '자료 보관'}</button><p className="text-sm font-semibold">게시 버전 이력 · {selected.revisions.length}개</p><ul className="grid gap-2 text-sm">{selected.revisions.map((revision) => <li key={revision.id} className="rounded-lg bg-surface-muted p-3">{revision.label} · 버전 {revision.number} · {date(revision.created_at)}</li>)}</ul></div></details>
        </section>}
      </section>}
    </div>
  </>
}
