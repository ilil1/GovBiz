import { supportProgramClient } from './supportProgramClient'
import { getCoreApiBaseUrl } from './coreApiConfig'
import { coreFetch } from './coreFetch'

export const browseSupportProgramsApi = supportProgramClient.browseCatalog

export class SupportProgramSourceDocumentError extends Error {
  constructor(status: number) {
    super(status === 404
      ? '공고 또는 공고 본문 조회 기능을 찾을 수 없습니다. 서버 상태를 확인해 주세요.'
      : status === 429
        ? '요청이 많습니다. 잠시 후 다시 시도해 주세요.'
        : '공고 본문을 가져오지 못했습니다. 다시 시도하거나 공식 공고를 확인하고 직접 입력해 주세요.')
    this.name = 'SupportProgramSourceDocumentError'
  }
}

/** 공식 상세 본문을 가져옵니다. 첨부파일은 포함되지 않습니다. */
export async function getSupportProgramSourceDocumentApi(sourceCode: string, sourceProgramId: string, signal: AbortSignal): Promise<string> {
  const params = new URLSearchParams({ sourceCode, sourceProgramId })
  const response = await coreFetch(`${getCoreApiBaseUrl()}/api/v1/support-programs/detail/source-document?${params}`, { credentials: 'include', signal })
  if (!response.ok) throw new SupportProgramSourceDocumentError(response.status)
  const value: unknown = await response.json()
  if (!value || typeof value !== 'object' || !('content' in value) || typeof value.content !== 'string' || !value.content.trim() || !('includesAttachments' in value) || value.includesAttachments !== false) {
    throw new Error('공고 본문을 확인하지 못했습니다. 직접 입력해 주세요.')
  }
  return value.content
}
