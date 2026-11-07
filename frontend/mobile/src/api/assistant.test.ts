import { assistantUseCase } from './assistant'
import { assistantHelpInput } from '../content/assistantHelp'
import { ApiError } from './client'

const fetchMock = jest.fn(), originalFetch = globalThis.fetch, originalBase = process.env.EXPO_PUBLIC_API_BASE_URL
const question = { message: '  기업 정보를 확인하고 싶어요  ', history: [], context: { route: '/app/profile', programSelected: false }, helpEntries: assistantHelpInput() }
const answer = { intent: 'PRODUCT_HELP', answer: '기업 정보에서 확인해 주세요.', citations: ['mobile-company-profile'], clarificationQuestion: null,
  searchQuery: null, accountTopic: null, navigation: { label: '기업 정보 열기', to: '/app/profile' }, cards: [] }
beforeEach(() => { process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.example.test'; globalThis.fetch = fetchMock; fetchMock.mockReset() })
afterEach(() => { globalThis.fetch = originalFetch; if (originalBase === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL; else process.env.EXPO_PUBLIC_API_BASE_URL = originalBase })
function response(body: unknown, status = 200) { return { ok: status >= 200 && status < 300, status, json: async () => body } }

test('native questions use Bearer, no cookies and the shared input/output contract', async () => {
  fetchMock.mockResolvedValue(response(answer))
  const result = await assistantUseCase('owner-token').execute({ ...question, history: Array.from({ length: 8 }, (_, index) => ({ role: 'USER' as const, content: `history ${index}` })) })
  expect(result).toEqual({ outcome: 'answered', answer })
  const [url, request] = fetchMock.mock.calls[0]
  expect(url).toBe('https://api.example.test/api/v1/assistant/messages')
  expect(request).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store' })
  expect(request.headers.get('Authorization')).toBe('Bearer owner-token')
  expect(request.headers.has('Cookie')).toBe(false)
  expect(JSON.parse(request.body)).toMatchObject({ message: question.message.trim(), history: Array.from({ length: 6 }, (_, index) => ({ role: 'USER', content: `history ${index + 2}` })) })
  expect(JSON.parse(request.body).helpEntries[0]).not.toHaveProperty('topic')
  expect(JSON.parse(request.body).helpEntries[0]).not.toHaveProperty('contextual')
})
test('an empty token cannot accidentally make an anonymous assistant request', () => {
  expect(() => assistantUseCase(' ')).toThrow('로그인 후')
  expect(fetchMock).not.toHaveBeenCalled()
})
test.each([429, 502, 503, 504])('HTTP %s remains a distinct failure outcome', async status => {
  fetchMock.mockResolvedValue(response({ retryAfterSeconds: 9 }, status))
  await expect(assistantUseCase('owner').execute(question)).resolves.toEqual(status === 429 ? { outcome: 'rate-limited', retryAfterSeconds: 9 } : { outcome: 'unavailable' })
})
test('401 propagates to the session owner instead of becoming a help answer', async () => {
  fetchMock.mockResolvedValue(response({}, 401))
  await expect(assistantUseCase('owner').execute(question)).rejects.toBeInstanceOf(ApiError)
})
test.each([{ ...answer, intent: 'UNKNOWN' }, { ...answer, citations: ['not-in-request'] }, { ...answer, cards: [{ kind: 'PROGRAM', id: 'invalid' }] }])('invalid contracts and unknown citations reject explicitly', async body => {
  fetchMock.mockResolvedValue(response(body))
  await expect(assistantUseCase('owner').execute(question)).rejects.toBeInstanceOf(Error)
})
test('invalid message length is rejected before HTTP', () => {
  expect(() => assistantUseCase('owner').execute({ ...question, message: 'x'.repeat(501) })).toThrow(RangeError)
  expect(fetchMock).not.toHaveBeenCalled()
})
