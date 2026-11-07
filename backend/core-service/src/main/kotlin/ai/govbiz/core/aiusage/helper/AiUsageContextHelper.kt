package ai.govbiz.core.aiusage.helper

import ai.govbiz.core.aiusage.domain.AiUsageAttribution
import ai.govbiz.core.aiusage.domain.AiUsageFeature

/**
 * 지금 스레드가 AI를 부르는 계정과 기능을 잡아 둡니다. ai-service 호출을 기록하는 인터셉터가 읽으며, 기능 쪽은 AI를 부르는 블록을
 * [attribute]로 감쌉니다. 다른 스레드로 넘기는 작업은 [current]를 넘겨 [within]으로 이어 갑니다.
 */
object AiUsageContextHelper {
    private val attribution = ThreadLocal<AiUsageAttribution?>()

    fun current(): AiUsageAttribution? = attribution.get()

    fun <T> attribute(accountId: Long?, feature: AiUsageFeature, action: () -> T): T =
        within(AiUsageAttribution(accountId, feature), action)

    fun <T> within(value: AiUsageAttribution?, action: () -> T): T {
        val previous = attribution.get()
        if (value == null) attribution.remove() else attribution.set(value)
        try {
            return action()
        } finally {
            if (previous == null) attribution.remove() else attribution.set(previous)
        }
    }
}
