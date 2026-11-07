package ai.govbiz.core.aiusage.client.dto

import com.fasterxml.jackson.annotation.JsonProperty

/** OpenAI Costs API(`GET /v1/organization/costs`) 응답 한 쪽입니다. */
data class OpenAiCostsPagePayload(
    val data: List<OpenAiCostsBucketPayload>? = null,
    @param:JsonProperty("has_more") val hasMore: Boolean? = null,
    @param:JsonProperty("next_page") val nextPage: String? = null,
)

data class OpenAiCostsBucketPayload(
    @param:JsonProperty("start_time") val startTime: Long? = null,
    @param:JsonProperty("end_time") val endTime: Long? = null,
    val results: List<OpenAiCostsResultPayload>? = null,
)

data class OpenAiCostsResultPayload(
    val amount: OpenAiCostsAmountPayload? = null,
    @param:JsonProperty("line_item") val lineItem: String? = null,
    @param:JsonProperty("project_id") val projectId: String? = null,
)

data class OpenAiCostsAmountPayload(
    val value: java.math.BigDecimal? = null,
    val currency: String? = null,
)
