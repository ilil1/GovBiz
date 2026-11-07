import type { AdminAiCostSummary, AdminAiModelPrice, NewAdminAiModelPrice } from '../entities/AdminAiCost'

/** 실제 비용을 가져오지 못한 사유는 화면이 다르게 안내해야 하므로 결과로 구분합니다. */
export type AdminAiCostSyncResult =
  | { outcome: 'done'; lines: number; amountUsd: string }
  | { outcome: 'admin-key-missing' }
  | { outcome: 'admin-key-rejected' }
  | { outcome: 'unavailable' }

export type AdminAiModelPriceResult = { outcome: 'done'; price: AdminAiModelPrice } | { outcome: 'conflict' } | { outcome: 'invalid' }

/** 관리자 AI 비용 기능이 Data Layer의 HTTP 세부사항과 분리되도록 하는 Domain 포트입니다. 관리자 세션이 있어야 합니다. */
export interface AdminAiCostRepository {
  getSummary(from: string, to: string, signal?: AbortSignal): Promise<AdminAiCostSummary>
  sync(signal?: AbortSignal): Promise<AdminAiCostSyncResult>
  getPrices(signal?: AbortSignal): Promise<AdminAiModelPrice[]>
  addPrice(price: NewAdminAiModelPrice, signal?: AbortSignal): Promise<AdminAiModelPriceResult>
}
