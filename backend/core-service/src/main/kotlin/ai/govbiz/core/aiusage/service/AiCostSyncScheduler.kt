package ai.govbiz.core.aiusage.service

import ai.govbiz.core.aiusage.service.exception.AiCostSyncException
import org.slf4j.LoggerFactory
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component

/** 관리자 키가 있으면 매일 서울 10시 10분(UTC 하루가 끝난 뒤)에 실제 비용을 가져옵니다. 실패하면 다음 날 다시 가져옵니다. */
@Component
@ConditionalOnProperty(prefix = "app.ai-cost", name = ["sync-enabled"], havingValue = "true", matchIfMissing = true)
class AiCostSyncScheduler(private val service: AiCostSyncService) {
    private val log = LoggerFactory.getLogger(javaClass)

    @Scheduled(cron = "0 10 10 * * *", zone = "Asia/Seoul", scheduler = "aiCostSyncTaskScheduler")
    fun sync() {
        if (!service.configured) return
        try {
            val result = service.sync()
            log.info("ai_cost_synced from={} to={} lines={}", result.from, result.to, result.lines)
        } catch (error: AiCostSyncException) {
            log.warn("ai_cost_sync_failed reason={}", error.reason)
        } catch (_: Exception) {
            log.warn("ai_cost_sync_failed reason=UNEXPECTED")
        }
    }
}
