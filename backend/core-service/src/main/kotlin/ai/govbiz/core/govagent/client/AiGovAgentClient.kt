package ai.govbiz.core.govagent.client

import ai.govbiz.core._common.exception.AiServiceCallException
import ai.govbiz.core._common.helper.executeAiServiceCall
import ai.govbiz.core.govagent.client.dto.AiGovAgentPayload
import ai.govbiz.core.govagent.client.dto.AiGovAgentRequest
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.http.MediaType
import org.springframework.stereotype.Component
import org.springframework.web.client.RestClient

@Component
class AiGovAgentClient(@param:Qualifier("aiServiceRestClient") private val restClient: RestClient) {
    fun decide(request: AiGovAgentRequest): AiGovAgentPayload = executeAiServiceCall {
        restClient.post().uri("/internal/v1/gov-agent/decide").contentType(MediaType.APPLICATION_JSON)
            .body(request).retrieve()
            .onStatus({ it.value() != 200 }, { _, response ->
                when (response.statusCode.value()) {
                    408, 504 -> throw AiServiceCallException.timeout(null)
                    503 -> throw AiServiceCallException.unavailable(null)
                    else -> throw AiServiceCallException.invalidResponse("Invalid Gov agent decision response", null)
                }
            })
            .body(AiGovAgentPayload::class.java)
            ?: throw AiServiceCallException.invalidResponse("Empty Gov agent decision", null)
    }
}
