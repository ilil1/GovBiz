package ai.govbiz.core.account.service

import org.slf4j.LoggerFactory
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component

/** 매일 서울 새벽 4시 30분에 보관 기간(1년)이 지난 탈퇴 표식을 지웁니다. 실패하면 다음 날 다시 지웁니다. */
@Component
@ConditionalOnProperty(prefix = "app.account.withdrawal-mark", name = ["purge-enabled"], havingValue = "true", matchIfMissing = true)
class WithdrawalMarkPurgeScheduler(private val service: WithdrawalMarkService) {
    private val log = LoggerFactory.getLogger(javaClass)

    @Scheduled(cron = "0 30 4 * * *", zone = "Asia/Seoul", scheduler = "accountWithdrawalMarkTaskScheduler")
    fun purge() {
        try {
            var removed = 0
            do {
                val batch = service.purgeExpired()
                removed += batch
            } while (batch > 0)
            if (removed > 0) log.info("Removed {} expired withdrawal marks", removed)
        } catch (_: Exception) {
            log.warn("Withdrawal mark purge failed; expired marks are ignored until the next run")
        }
    }
}
