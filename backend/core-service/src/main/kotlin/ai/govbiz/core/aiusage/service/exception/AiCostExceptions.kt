package ai.govbiz.core.aiusage.service.exception

/** 실제 비용을 가져오지 못했습니다. 기존에 가져온 값은 그대로 둡니다. */
class AiCostSyncException(val reason: Reason) : RuntimeException(reason.name) {
    enum class Reason {
        ADMIN_KEY_MISSING,
        ADMIN_KEY_REJECTED,
        UNAVAILABLE,
        INVALID_RESPONSE,
    }
}

/** 같은 모델·등급·시작일의 가격이 이미 있습니다. */
class AiModelPriceConflictException : RuntimeException("AI model price already exists")
