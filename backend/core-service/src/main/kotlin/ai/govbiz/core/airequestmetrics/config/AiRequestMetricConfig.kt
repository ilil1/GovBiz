package ai.govbiz.core.airequestmetrics.config

import ai.govbiz.core.airequestmetrics.service.AiRequestMetricService
import ai.govbiz.core.airequestmetrics.web.AiRequestMetricFilter
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration

@Configuration(proxyBeanMethods = false)
class AiRequestMetricConfig {
    @Bean
    fun aiRequestMetricFilter(service: AiRequestMetricService) = AiRequestMetricFilter(service)
}
