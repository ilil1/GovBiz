package ai.govbiz.core.account.config

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.scheduling.annotation.EnableScheduling
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler

/** 탈퇴 표식 정리 작업의 스케줄러입니다. 다른 기능의 스케줄러를 꺼도 표식 정리는 따로 돕니다. */
@Configuration(proxyBeanMethods = false)
@EnableScheduling
@ConditionalOnProperty(prefix = "app.account.withdrawal-mark", name = ["purge-enabled"], havingValue = "true", matchIfMissing = true)
class AccountWithdrawalMarkConfig {
    @Bean
    fun accountWithdrawalMarkTaskScheduler() = ThreadPoolTaskScheduler().apply {
        poolSize = 1
        setThreadNamePrefix("account-withdrawal-mark-")
    }
}
