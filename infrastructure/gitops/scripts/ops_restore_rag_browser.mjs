// Open the lazy RAG panel in both restored HTTP and captured-response browsers.
import assert from 'node:assert/strict'

export async function checkRagMaterial(page, detail) {
  const path = `/api/v1/ops/evaluations/${detail.id}/rag-reviews`
  const panel = page.getByRole('region', { name: 'RAG 사례 검토 자료', exact: true })
  const [reply] = await Promise.all([
    page.waitForResponse((value) => value.url() === new URL(path, page.url()).href && value.request().method() === 'GET'),
    panel.getByRole('button', { name: '검토 자료 보기', exact: true }).click(),
  ])
  assert.equal(reply.status(), 200, 'RAG review material is unavailable')
  assert.ok((await reply.headerValue('cache-control'))?.includes('no-store'), 'RAG review material is cacheable')
  const state = await reply.json()
  const { material } = state
  assert.ok(material && Array.isArray(material.cases) && material.cases.length > 0, 'RAG review material is empty')
  const spec = detail.execution_spec
  assert.equal(material.fixture_sha256, spec.dataset.fixture_sha256, 'RAG fixture hash differs')
  assert.equal(material.candidate_capture_sha256, spec.candidate_sha256, 'RAG candidate hash differs')
  assert.equal(material.reference_capture_sha256, spec.reference_sha256, 'RAG reference hash differs')
  assert.deepEqual(material.cases.map((item) => item.case_id), spec.dataset.case_ids, 'RAG case list differs')
  await panel.locator(':scope[aria-busy="false"]').waitFor()
  assert.equal(await panel.getByRole('alert').count(), 0, 'RAG review contract was rejected by the application')
  const select = panel.getByRole('combobox', { name: '확인할 질문' })
  if (material.cases.length > 1) {
    await select.waitFor()
    assert.deepEqual(await select.locator('option').allTextContents(), material.cases.map((item) => {
      const reviewed = state.case_reviews.some((row) => row.case_id === item.case_id && row.is_current
        && row.material_sha256 === material.material_sha256 && row.rubric_version === state.rubric.version)
      return `${item.case_id} · ${reviewed ? '검토 저장됨' : '미검토'} · ${item.question}`
    }))
  } else assert.equal(await select.count(), 0)
  for (const [index, item] of material.cases.entries()) {
    if (material.cases.length > 1) await select.selectOption(String(index))
    await panel.locator('p.font-semibold').getByText(item.question, { exact: true }).waitFor()
    const comparison = panel.locator('details').filter({ has: page.locator('summary').getByText('비교할 답변 보기', { exact: true }) })
    if (await comparison.getAttribute('open') === null) await comparison.locator(':scope > summary').click()
    for (const [label, observation] of [['후보', item.candidate], ['비교', item.reference]]) {
      const article = panel.getByRole('article', { name: `${label} 답변과 근거`, exact: true })
      await article.getByText(observation.answer ?? '저장된 답변 없음', { exact: true }).waitFor()
    }
    const source = panel.locator('details').filter({ has: page.locator('summary').getByText('공고 원문 보기', { exact: true }) })
    if (await source.getAttribute('open') === null) await source.locator('summary').click()
    assert.equal(await source.locator('pre').textContent(), item.content, 'Rendered RAG source differs')
    await source.getByText(`원문 SHA-256: ${item.content_sha256}`, { exact: true }).waitFor()
    const chunks = panel.locator('details').filter({ has: page.locator('summary').getByText('공고에서 찾은 근거 보기', { exact: true }) })
    if (await chunks.getAttribute('open') === null) await chunks.locator('summary').first().click()
    for (const chunk of item.chunks) {
      const node = chunks.locator('details').filter({ has: page.locator('p').getByText(chunk.id, { exact: true }) })
      if (await node.getAttribute('open') === null) await node.locator('summary').click()
      await node.getByText(chunk.text, { exact: true }).waitFor()
    }
  }
  const integrity = panel.locator('details').filter({ has: page.locator('summary').getByText('관리자용 자료 정보', { exact: true }) })
  await integrity.locator('summary').click()
  for (const [label, key] of [['검토 자료', 'material_sha256'], ['평가 자료', 'fixture_sha256'], ['후보 캡처', 'candidate_capture_sha256'], ['비교 캡처', 'reference_capture_sha256']]) {
    await integrity.getByText(`${label}: ${material[key]}`, { exact: true }).waitFor()
  }
  assert.equal(await panel.getByRole('alert').count(), 0, 'RAG review view contains an error')
}
