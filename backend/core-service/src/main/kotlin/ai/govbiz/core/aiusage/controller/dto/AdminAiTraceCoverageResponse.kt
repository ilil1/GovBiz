package ai.govbiz.core.aiusage.controller.dto

import ai.govbiz.core.aiusage.domain.AiTraceCoverage
import java.time.LocalDate

data class AdminAiTraceCoverageResponse(
    val from: String,
    val to: String,
    val features: List<AdminAiTraceCoverageFeatureResponse>,
) {
    companion object {
        fun from(from: LocalDate, to: LocalDate, rows: List<AiTraceCoverage>) = AdminAiTraceCoverageResponse(
            from.toString(), to.toString(), rows.map { AdminAiTraceCoverageFeatureResponse(it.feature, it.calls, it.linkedCalls) },
        )
    }
}

data class AdminAiTraceCoverageFeatureResponse(val feature: String?, val calls: Long, val linkedCalls: Long)
