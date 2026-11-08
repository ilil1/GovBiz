package ai.govbiz.core.airequestmetrics.controller

import ai.govbiz.core.admin.web.AdminPrincipal
import ai.govbiz.core.airequestmetrics.controller.dto.AiRequestMetricsResponse
import ai.govbiz.core.airequestmetrics.controller.dto.AiRequestMetricResponse
import ai.govbiz.core.airequestmetrics.controller.dto.AiRequestMetricsDailyResponse
import ai.govbiz.core.airequestmetrics.controller.dto.AiRequestMetricDayResponse
import ai.govbiz.core.airequestmetrics.service.AiRequestMetricService
import java.time.LocalDate
import org.springframework.format.annotation.DateTimeFormat
import org.springframework.http.CacheControl
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping("/api/v1/admin/ai-request-metrics")
class AiRequestMetricsController(private val service: AiRequestMetricService) {
    @GetMapping
    fun summary(
        admin: AdminPrincipal,
        @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) from: LocalDate,
        @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) to: LocalDate,
    ): ResponseEntity<AiRequestMetricsResponse> = ResponseEntity.ok().cacheControl(CacheControl.noStore())
        .body(AiRequestMetricsResponse(from, to, features = service.summary(from, to).map(AiRequestMetricResponse::from)))

    @GetMapping("/daily")
    fun daily(
        admin: AdminPrincipal,
        @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) from: LocalDate,
        @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) to: LocalDate,
    ): ResponseEntity<AiRequestMetricsDailyResponse> = ResponseEntity.ok().cacheControl(CacheControl.noStore())
        .body(AiRequestMetricsDailyResponse(from, to, days = service.daily(from, to).map { (date, rows) ->
            AiRequestMetricDayResponse(date, rows.map(AiRequestMetricResponse::from))
        }))

    @ExceptionHandler(IllegalArgumentException::class)
    fun invalid(): ResponseEntity<Void> = ResponseEntity.status(HttpStatus.BAD_REQUEST).cacheControl(CacheControl.noStore()).build()
}
