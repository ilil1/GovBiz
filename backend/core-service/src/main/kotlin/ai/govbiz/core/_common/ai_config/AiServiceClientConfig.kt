package ai.govbiz.core._common.ai_config

import ai.govbiz.core._common.helper.buildRestClient
import ai.govbiz.core.aiusage.client.AiUsageRecordingInterceptor
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.web.client.RestClient

/**
 * ai-service를 부르는 모든 RestClient는 응답의 OpenAI 사용량 헤더를 기록하는 [AiUsageRecordingInterceptor]를 거칩니다.
 * 인터셉터 빈이 없는 좁은 테스트 문맥에서는 기록 없이 만듭니다.
 */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(AiServiceClientProperties::class)
class AiServiceClientConfig(private val usageInterceptor: AiUsageRecordingInterceptor? = null) {
    @Bean
    fun aiApplicationFormDiscoveryRestClient(restClientBuilder: RestClient.Builder, properties: AiServiceClientProperties): RestClient =
        buildRestClient(recorded(restClientBuilder), properties.baseUrl, properties.connectTimeout, properties.applicationFormDiscoveryReadTimeout)

    @Bean
    fun aiCombinationReviewRestClient(
        restClientBuilder: RestClient.Builder,
        properties: AiServiceClientProperties,
    ): RestClient = buildRestClient(
        recorded(restClientBuilder),
        properties.baseUrl,
        properties.connectTimeout,
        properties.combinationReviewReadTimeout,
    )

    @Bean
    fun aiRankingRestClient(
        restClientBuilder: RestClient.Builder,
        properties: AiServiceClientProperties,
    ): RestClient = buildRestClient(
        recorded(restClientBuilder),
        properties.baseUrl,
        properties.connectTimeout,
        properties.rankingReadTimeout,
    )

    @Bean
    fun aiSemanticSearchRestClient(
        restClientBuilder: RestClient.Builder,
        properties: AiServiceClientProperties,
    ): RestClient = buildRestClient(
        recorded(restClientBuilder),
        properties.baseUrl,
        properties.connectTimeout,
        properties.semanticSearchReadTimeout,
    )

    @Bean
    fun aiServiceRestClient(
        restClientBuilder: RestClient.Builder,
        properties: AiServiceClientProperties,
    ): RestClient = buildRestClient(
        recorded(restClientBuilder),
        properties.baseUrl,
        properties.connectTimeout,
        properties.readTimeout,
    )

    private fun recorded(builder: RestClient.Builder): RestClient.Builder =
        usageInterceptor?.let { builder.requestInterceptor(it) } ?: builder
}
