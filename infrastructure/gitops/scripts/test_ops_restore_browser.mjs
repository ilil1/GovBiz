import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { chromium } from '../../../frontend/web/node_modules/playwright-core/index.mjs'
import { withRestoreProxy } from './ops_restore_proxy.mjs'
import { checkRestoreBrowser } from './ops_restore_browser.mjs'
import { ragFixture } from './ops_restore_rag_fixture.mjs'

const at = '2026-10-03T00:00:00Z'
const dataset = {
  id: 'browser-fixture', label: '격리 브라우저 검증', case_ids: ['E01'],
  captures: [{ id: 'saved', label: '저장 응답' }], baseline: null, fixture: 'fixture.json',
  live_config: null, execution_profiles: { replay: 'a'.repeat(64), live: null },
}
const runs = Array.from({ length: 26 }, (_, index) => ({
  id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  dataset_id: dataset.id, dataset_label: dataset.label, requested_by: 'fixture@example.invalid', requested_by_id: 'core:1',
  can_retry: false, candidate_capture_id: 'saved', reference_capture_id: 'saved',
  candidate_label: '저장 응답', reference_label: '저장 응답', comparison: null,
  execution_mode: 'replay', live_config: null, status: 'COMPLETED', status_label: '완료',
  created_at: at, started_at: null, finished_at: at, synced_at: at,
  error_code: '', error_message: '', summary: {}, model_api_calls: 0, evaluation_run_id: null,
  trace_links: [], prefect_flow_run_id: null, prefect_url: null, langfuse_url: null, report_url: null,
}))
const responses = {
  '/api/v1/ops/schedules?page=1': { enabled: false, timezone: 'Asia/Seoul', page: 1, total: 0, results: [] },
  '/api/v1/ops/schedules/settings': { enabled: false, revision: 0, source: 'environment', live_enabled: false, rag_live_enabled: false, changes: [] },
  '/api/v1/ops/session': {
    user: { id: 'core:1', username: 'fixture@example.invalid' }, csrf_token: 'redacted',
    live_enabled: false, rag_live_enabled: false,
  },
  '/api/v1/ops/evaluation-catalog': { datasets: [dataset] },
  '/api/v1/ops/evaluations?page=1': { count: 26, next: 'http://127.0.0.1:8000/api/v1/ops/evaluations?page=2', previous: null, results: runs.slice(0, 25) },
  '/api/v1/ops/evaluations?page=2': { count: 26, next: null, previous: 'http://127.0.0.1:8000/api/v1/ops/evaluations?page=1', results: runs.slice(25) },
  '/api/v1/ops/budget/reservations?page=1': {
    as_of: at, count: 0, next: null, previous: null, results: [],
    summary: { state: 'unconfigured', limits: null, allocated: null, remaining: null, breakdown: null,
      reservation_count: 0, legacy_live_run_count: 0, change_count: 0, recent_changes: [] },
  },
}
const reports = {}, expected = {}
for (const index of [0, 24, 25]) {
  const row = runs[index]
  const path = `/api/v1/ops/evaluations/${row.id}`
  row.report_url = path + '/report'
  row.execution_spec_sha256 = String(index).padStart(64, 'a')
  row.evaluation_scope = index === 25 ? 'source-chunks-retrieval-answer' : 'fixed-answer-context-only'
  if (index === 25) {
    const rag = ragFixture()
    row.execution_spec = rag.spec
    responses[path + '/rag-reviews'] = rag.state
    responses[path + '/rag-material'] = rag.state.material
    const metric = { value: 1, measuredCaseCount: 2, eligibleCaseCount: 2 }
    const summary = {
      scope: row.evaluation_scope, measurementKind: 'integration-stub-replay', baselineEligible: false,
      liveExecutionPerformed: false, completed: true, caseCount: 2,
      fixtureSha256: rag.state.material.fixture_sha256, captureSha256: rag.state.material.candidate_capture_sha256,
      execution: { model: null, embeddingModel: null, promptSha256: null },
      coverage: { retrievalCaseCount: 2, answerCaseCount: 2, failedCaseCount: 0, traceCaseCount: 0 },
      metrics: { retrievalRecallAtK: metric, answerCitationRecall: metric, answerStatusAccuracy: metric },
      cases: rag.state.material.cases.map((item) => ({
        caseId: item.case_id, traceId: null, retrievalRecallAtK: 1, answerCitationRecall: 1, answerStatusMatches: true,
        failure: null, retrievedChunkIds: ['chunk-a'], citedChunkIds: ['chunk-a'],
      })),
    }
    row.comparison = {
      schema_version: 3, scope: row.evaluation_scope, retrieval_evaluated: true, baseline_eligible: false,
      comparison: 'self-replay', case_ids: rag.spec.dataset.case_ids, current: summary, reference: summary,
    }
  }
  responses[path] = { ...row }
  responses[path + '/budget'] = { as_of: at, state: 'not_applicable', reservation: null, calls: [] }
  if (index !== 25) responses[path + '/review'] = {
    is_baseline: false, material_error: '', baseline_version: 0, review_version: 0,
    can_approve: false, approval_current: false, baseline_requires_review: false,
    rubric: { version: 'fixture', criteria: [] }, case_reviews: [], baseline_history: [], reviews: [], material: null,
  }
  const body = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>복원 검증 보고서</title></head><body><script>document.body.appendChild(Object.assign(document.createElement('h1'), {textContent: '복원 보고서 ${index}'}))</script></body></html>`
  reports[path + '/report'] = { body, headers: {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'private, no-store, max-age=0, no-cache, must-revalidate',
    'content-security-policy': "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'",
  } }
  expected[row.id] = { report_sha256: createHash('sha256').update(body).digest('hex'), execution_spec_sha256: row.execution_spec_sha256 }
}

test('real browser opens budget, schedules, lists and report explanations before sandboxed originals, then denies a member', { timeout: 120000 }, async (context) => {
  const stages = []
  const result = await withRestoreProxy(responses, async (origin) => ({ browser_ui: await checkRestoreBrowser(origin, responses, expected, reports, (stage) => stages.push(stage)) }), reports)
  assert.deepEqual(stages, ['LAUNCH', 'LIST', 'BUDGET', 'SCHEDULES', 'DETAIL', 'REPORT', 'DETAIL', 'REPORT', 'DETAIL', 'RAG_MATERIAL', 'REPORT', 'MEMBER'])
  assert.equal(result.browser_ui.listed_run_count, 26)
  assert.equal(result.browser_ui.pages_verified, 2)
  assert.equal(result.browser_ui.budget_view_verified, true)
  assert.equal(result.browser_ui.denied_view_verified, true)
  assert.equal(result.browser_ui.browser_rendered, true)
  assert.equal(result.browser_ui.browser_closed, true)
  assert.equal(result.browser_ui.details_verified, 3)
  assert.equal(result.browser_ui.report_documents_verified, 3)
  assert.equal(result.browser_ui.report_sandbox_verified, true)
  assert.equal(result.browser_ui.report_denials_verified, 3)
  assert.equal(result.proxy_http.report_documents_verified, 3)
  assert.equal(result.proxy_http.servers_stopped, true)
  assert.match(result.browser_ui.browser_version, /^[0-9]+(?:\.[0-9]+){3}$/)
  context.diagnostic('Browser version: ' + result.browser_ui.browser_version)
})

test('report page opens only the compact view while preserving the raw report', { timeout: 120000 }, async () => {
  const id = Object.keys(expected)[0], path = `/api/v1/ops/evaluations/${id}`
  const snapshot = { '/api/v1/ops/session': responses['/api/v1/ops/session'], [path]: responses[path] }
  const report = { [path + '/report']: reports[path + '/report'] }
  await withRestoreProxy(snapshot, async (origin) => {
    const channel = process.env.RESTORE_BROWSER_CHANNEL
    assert.ok(channel === undefined || ['chrome', 'msedge'].includes(channel))
    const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) })
    try {
      const context = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1440, height: 1000 } })
      await context.addCookies([{ name: 'govbiz_session', value: 'restore-proxy-fixture', url: origin, httpOnly: true, sameSite: 'Lax' }])
      const page = await context.newPage()
      await page.goto(origin + `/ops/evaluations/${id}/report`, { waitUntil: 'domcontentloaded' })
      await page.getByRole('heading', { name: 'Evidently 평가 보고서', exact: true }).waitFor()
      const link = page.getByRole('link', { name: '원본 차트 새 탭에서 보기 ↗', exact: true })
      await link.waitFor()
      assert.equal(await page.getByRole('region', { name: 'Evidently 원본 차트' }).getByRole('link').count(), 1)
      assert.equal(await link.getAttribute('href'), path + '/report?view=compact')
      assert.equal(await link.getAttribute('target'), '_blank')
      assert.deepEqual((await link.getAttribute('rel')).split(' ').sort(), ['noopener', 'noreferrer'])
      const raw = await page.evaluate(async (url) => {
        const response = await fetch(url, { credentials: 'same-origin' })
        const bytes = await response.arrayBuffer()
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (value) => value.toString(16).padStart(2, '0')).join('')
        return { status: response.status, hash }
      }, path + '/report')
      assert.deepEqual(raw, { status: 200, hash: expected[id].report_sha256 })
      const [popup, reply] = await Promise.all([
        context.waitForEvent('page'), context.waitForEvent('response', { predicate: (response) => response.url() === origin + path + '/report?view=compact' }), link.click(),
      ])
      assert.equal(reply.status(), 200)
      assert.equal((await reply.body()).toString(), report[path + '/report'].body + '\n<!-- compact fixture -->')
      for (const [name, value] of Object.entries(report[path + '/report'].headers)) assert.equal(await reply.headerValue(name), value)
      await popup.waitForLoadState('load')
      assert.equal(popup.url(), origin + path + '/report?view=compact')
      assert.deepEqual(await popup.evaluate(() => {
        const blocked = (read) => { try { read(); return false } catch (error) { return error.name === 'SecurityError' } }
        return { opener: window.opener === null, cookie: blocked(() => document.cookie), storage: blocked(() => localStorage.length) }
      }), { opener: true, cookie: true, storage: true })
      await context.clearCookies()
      await context.addCookies([{ name: 'govbiz_session', value: 'member-fixture', url: origin, httpOnly: true, sameSite: 'Lax' }])
      for (const suffix of ['/report', '/report?view=compact']) {
        assert.equal(await page.evaluate(async (url) => (await fetch(url, { credentials: 'same-origin' })).status, path + suffix), 403)
      }
    } finally { await browser.close() }
    return { status: 'PASS' }
  }, report)
})

test('tampered report bytes or missing reports cannot launch the browser', async () => {
  const bad = structuredClone(reports)
  Object.values(bad)[0].body += 'tampered'
  await assert.rejects(checkRestoreBrowser('http://127.0.0.1:1', responses, expected, bad), /hash differs/)
  await assert.rejects(checkRestoreBrowser('http://127.0.0.1:1', responses, expected, {}))
})

test('unsafe or cacheable report headers cannot start the replay proxy', async () => {
  for (const [header, value] of [
    ['content-security-policy', "sandbox allow-scripts allow-same-origin; default-src 'none'"],
    ['cache-control', 'public, max-age=3600'], ['content-type', 'application/json'], ['set-cookie', 'unexpected=1'],
  ]) {
    const bad = structuredClone(reports)
    Object.values(bad)[0].headers[header] = value
    await assert.rejects(withRestoreProxy(responses, async () => assert.fail('Unsafe replay started'), bad))
  }
})

test('report script errors fail verification and still remove owned listeners and cache', { timeout: 120000 }, async () => {
  const broken = structuredClone(reports), hashes = structuredClone(expected)
  const id = Object.keys(hashes)[0], path = `/api/v1/ops/evaluations/${id}/report`
  broken[path].body = broken[path].body.replace('</script>', ";throw new Error('synthetic report failure')</script>")
  hashes[id].report_sha256 = createHash('sha256').update(broken[path].body).digest('hex')
  const nativeFetch = globalThis.fetch
  const caches = async () => (await readdir(tmpdir())).filter((name) => name.startsWith(`govbiz-restore-proxy-${process.pid}-`)).sort()
  const before = await caches()
  let origin
  await assert.rejects(withRestoreProxy(responses, async (owned) => {
    origin = owned
    return checkRestoreBrowser(origin, responses, hashes, broken)
  }, broken), /Application or report JavaScript failed/)
  assert.equal(globalThis.fetch, nativeFetch)
  assert.deepEqual(await caches(), before)
  await assert.rejects(nativeFetch(origin, { signal: AbortSignal.timeout(1000) }))
})

test('browser inspection rejects a non-owned origin before launching', async () => {
  await assert.rejects(checkRestoreBrowser('https://external.invalid', responses))
  await assert.rejects(checkRestoreBrowser('http://localhost:5173', responses))
})

test('locked Evidently standalone report renders under the real report sandbox', { timeout: 120000 }, async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'govbiz-evidently-browser-'))
  try {
    const root = fileURLToPath(new URL('../../../', import.meta.url))
    const python = resolve(root, 'pipelines/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
    const reportPath = resolve(directory, 'report.html')
    const generated = spawnSync(python, ['-c', [
      'import sys', 'import pandas as pd', 'from evidently import Report', 'from evidently.metrics import RowCount',
      'Report([RowCount()], include_tests=False).run(current_data=pd.DataFrame({"value":[1,2]})).save_html(sys.argv[1])',
    ].join('\n'), reportPath], { env: { ...process.env, DO_NOT_TRACK: '1' }, encoding: 'utf8', timeout: 60000, windowsHide: true })
    assert.equal(generated.status, 0, 'Locked evaluation Python must generate an offline report')
    const id = Object.keys(expected)[0], path = `/api/v1/ops/evaluations/${id}`
    const body = await readFile(reportPath, 'utf8')
    const report = { [path + '/report']: { ...reports[path + '/report'], body } }
    const hashes = { [id]: { ...expected[id], report_sha256: createHash('sha256').update(body).digest('hex') } }
    const snapshot = Object.fromEntries(Object.entries(responses).filter(([key]) => !key.startsWith('/api/v1/ops/evaluations/') || key.startsWith(path)))
    await withRestoreProxy(snapshot, (origin) => checkRestoreBrowser(origin, snapshot, hashes, report), report)
  } finally {
    assert.ok(directory.startsWith(resolve(tmpdir()) + sep + 'govbiz-evidently-browser-'))
    await rm(directory, { recursive: true, force: true })
  }
})

test('Evidently report lays out paired charts responsively in the report sandbox', { timeout: 120000 }, async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'govbiz-evidently-layout-'))
  let browser
  try {
    const root = fileURLToPath(new URL('../../../', import.meta.url))
    const python = resolve(root, 'pipelines/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
    const reportPath = resolve(directory, 'report.html')
    const generated = spawnSync(python, ['-c', [
      'import sys',
      "sys.path[:0] = ['evaluation/support-program-evidence', 'backend/ai-service']",
      'import pandas as pd', 'from evidently import Report', 'from evidently.metrics import MeanValue, RowCount',
      'from reporting import compact_report_charts',
      's = Report([RowCount(), MeanValue(column="score"), MeanValue(column="second")], include_tests=False).run(current_data=pd.DataFrame({"score": [0, 1], "second": [1, 0]}), reference_data=pd.DataFrame({"score": [1, 1], "second": [0, 0]}))',
      'compact_report_charts(s, 2)', 's.save_html(sys.argv[1])',
    ].join('\n'), reportPath], { cwd: root, env: { ...process.env, DO_NOT_TRACK: '1', PYTHONUTF8: '1' }, encoding: 'utf8', timeout: 60000, windowsHide: true })
    assert.equal(generated.status, 0, `Evidently report generation failed: ${generated.stderr}`)
    const html = await readFile(reportPath, 'utf8')
    const channel = process.env.RESTORE_BROWSER_CHANNEL
    assert.ok(channel === undefined || ['chrome', 'msedge'].includes(channel))
    browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/*', route => route.request().url() === 'http://127.0.0.1/report'
      ? route.fulfill({ status: 200, contentType: 'text/html', headers: {
          'content-security-policy': "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'",
        }, body: html })
      : route.abort())
    await page.goto('http://127.0.0.1/report')
    const charts = page.locator('.js-plotly-plot')
    await charts.nth(1).waitFor()
    const first = await charts.nth(0).boundingBox(), second = await charts.nth(1).boundingBox()
    assert.ok(first && second && first.width > 0 && second.width > 0)
    assert.ok(Math.abs(first.y - second.y) < 2 && second.x > first.x + first.width, 'Desktop charts must appear side by side')
    await page.setViewportSize({ width: 390, height: 900 })
    await page.waitForFunction(() => {
      const plots = document.querySelectorAll('.js-plotly-plot')
      return plots.length >= 2 && plots[1].getBoundingClientRect().y > plots[0].getBoundingClientRect().bottom
    })
    const mobileFirst = await charts.nth(0).boundingBox(), mobileSecond = await charts.nth(1).boundingBox()
    assert.ok(mobileFirst && mobileSecond && mobileFirst.x + mobileFirst.width <= 390 && mobileSecond.x + mobileSecond.width <= 390)
    assert.deepEqual(errors, [])
  } finally {
    if (browser) await browser.close()
    assert.ok(directory.startsWith(resolve(tmpdir()) + sep + 'govbiz-evidently-layout-'))
    await rm(directory, { recursive: true, force: true })
  }
})

test('restore contract CLI records only a fixed failure phase', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'govbiz-restore-diagnostic-'))
  try {
    const input = resolve(directory, 'responses.json')
    await writeFile(input, 'private-fixture-not-json')
    const result = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--experimental-transform-types', fileURLToPath(new URL('./check_ops_restore_ui.mjs', import.meta.url)), input], { encoding: 'utf8', timeout: 20000, windowsHide: true })
    assert.equal(result.status, 1)
    assert.equal(result.stdout, '')
    assert.equal(result.stderr, 'BRIDGE_RESTORE_WEB_INPUT\n')
  } finally {
    assert.ok(directory.startsWith(resolve(tmpdir()) + sep + 'govbiz-restore-diagnostic-'))
    await rm(directory, { recursive: true, force: true })
  }
})
