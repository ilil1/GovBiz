package ai.govbiz.core.airequestmetrics.controller

import ai.govbiz.core.admin.web.AdminPrincipal
import ai.govbiz.core.airequestmetrics.controller.dto.AiJobFeatureResponse
import ai.govbiz.core.airequestmetrics.controller.dto.AiJobMetricsResponse
import ai.govbiz.core.airequestmetrics.service.AiJobMetricsService
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
@RequestMapping("/api/v1/admin/ai-request-metrics/jobs")
class AiJobMetricsController(private val service: AiJobMetricsService) {
    @GetMapping
    fun summary(
        admin: AdminPrincipal,
        @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) from: LocalDate,
        @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) to: LocalDate,
    ): ResponseEntity<AiJobMetricsResponse> = ResponseEntity.ok().cacheControl(CacheControl.noStore())
        .body(AiJobMetricsResponse(from, to, features = service.summary(from, to).map(AiJobFeatureResponse::from)))

    @ExceptionHandler(IllegalArgumentException::class)
    fun invalid(): ResponseEntity<Void> = ResponseEntity.status(HttpStatus.BAD_REQUEST).cacheControl(CacheControl.noStore()).build()
}
