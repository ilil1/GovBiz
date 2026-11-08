package ai.govbiz.core.airequestmetrics.config

import ai.govbiz.core.airequestmetrics.service.AiRequestMetricService
import ai.govbiz.core.airequestmetrics.service.AiRequestMetricWriter
import ai.govbiz.core.airequestmetrics.web.AiRequestMetricFilter
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration

@Configuration(proxyBeanMethods = false)
class AiRequestMetricConfig {
    @Bean(destroyMethod = "close")
    fun aiRequestMetricWriter(service: AiRequestMetricService) = AiRequestMetricWriter(service)

    @Bean
    fun aiRequestMetricFilter(writer: AiRequestMetricWriter) = AiRequestMetricFilter(writer)
}
