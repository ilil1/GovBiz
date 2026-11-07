package ai.govbiz.core.aiusage.client.exception

/** OpenAI Costs API를 부르지 못했거나 응답을 믿을 수 없습니다. 원문 응답은 담지 않습니다. */
class OpenAiCostsClientException(val reason: Reason, cause: Throwable? = null) : RuntimeException(reason.name, cause) {
    enum class Reason {
        /** 키가 관리자 키가 아니거나 권한이 없습니다(401·403). */
        REJECTED,
        UNAVAILABLE,
        INVALID_RESPONSE,
    }
}
