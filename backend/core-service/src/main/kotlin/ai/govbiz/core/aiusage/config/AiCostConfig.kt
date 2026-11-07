package ai.govbiz.core.aiusage.config

import ai.govbiz.core._common.helper.buildRestClient
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.scheduling.annotation.EnableScheduling
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler
import org.springframework.web.client.RestClient

/** OpenAI Costs API 클라이언트와 실제 비용을 매일 가져오는 작업의 스케줄러입니다. */
@Configuration(proxyBeanMethods = false)
@EnableScheduling
@EnableConfigurationProperties(AiCostProperties::class)
class AiCostConfig {
    @Bean
    fun openAiCostsRestClient(restClientBuilder: RestClient.Builder, properties: AiCostProperties): RestClient =
        buildRestClient(restClientBuilder, properties.openaiBaseUrl, properties.connectTimeout, properties.readTimeout)

    @Bean
    fun aiCostSyncTaskScheduler() = ThreadPoolTaskScheduler().apply {
        poolSize = 1
        setThreadNamePrefix("ai-cost-sync-")
    }
}
