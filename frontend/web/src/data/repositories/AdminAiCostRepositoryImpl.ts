import type { AdminAiCostSummary, AdminAiModelPrice, NewAdminAiModelPrice } from '../../domain/entities/AdminAiCost'
import type { AdminAiCostRepository, AdminAiCostSyncResult, AdminAiModelPriceResult } from '../../domain/repositories/AdminAiCostRepository'
import { AccountApiError } from '../api/accountApi'
import { addAdminAiModelPriceApi, getAdminAiCostSummaryApi, getAdminAiModelPricesApi, syncAdminAiCostsApi } from '../api/adminAiCostApi'
import { toAdminAiCostSummary, toAdminAiModelPrice } from '../models/AdminAiCostDto'

/** Core API 관리자 AI 비용 DTO를 Domain 값으로 바꾸고, 화면이 구분해 안내할 실패는 결과로 돌려주는 adapter입니다. */
export class AdminAiCostRepositoryImpl implements AdminAiCostRepository {
  async getSummary(from: string, to: string, signal?: AbortSignal): Promise<AdminAiCostSummary> {
    return toAdminAiCostSummary(await getAdminAiCostSummaryApi(from, to, signal))
  }

  async sync(signal?: AbortSignal): Promise<AdminAiCostSyncResult> {
    try {
      const result = await syncAdminAiCostsApi(signal)
      return { outcome: 'done', lines: result.lines, amountUsd: result.amountUsd }
    } catch (error) {
      if (error instanceof AccountApiError) {
        if (error.code === 'OPENAI_ADMIN_KEY_MISSING') return { outcome: 'admin-key-missing' }
        if (error.code === 'OPENAI_ADMIN_KEY_REJECTED') return { outcome: 'admin-key-rejected' }
        if (error.code === 'OPENAI_COSTS_UNAVAILABLE' || error.code === 'OPENAI_COSTS_INVALID_RESPONSE') return { outcome: 'unavailable' }
      }
      throw error
    }
  }

  async getPrices(signal?: AbortSignal): Promise<AdminAiModelPrice[]> {
    return (await getAdminAiModelPricesApi(signal)).map(toAdminAiModelPrice)
  }

  async addPrice(price: NewAdminAiModelPrice, signal?: AbortSignal): Promise<AdminAiModelPriceResult> {
    try {
      return { outcome: 'done', price: toAdminAiModelPrice(await addAdminAiModelPriceApi(price, signal)) }
    } catch (error) {
      if (error instanceof AccountApiError) {
        if (error.code === 'AI_MODEL_PRICE_CONFLICT') return { outcome: 'conflict' }
        if (error.status === 400) return { outcome: 'invalid' }
      }
      throw error
    }
  }
}
