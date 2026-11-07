package ai.govbiz.core.aiusage.helper

import ai.govbiz.core.aiusage.domain.AiUsageAttribution
import ai.govbiz.core.aiusage.domain.AiUsageFeature
import java.util.concurrent.Executors
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

class AiUsageContextHelperTest {
    @Test
    fun anInnerFeatureWinsAndTheOuterOneComesBackEvenAfterAFailure() {
        AiUsageContextHelper.attribute(7, AiUsageFeature.ASSISTANT) {
            AiUsageContextHelper.attribute(7, AiUsageFeature.AI_SEARCH) {
                assertEquals(AiUsageAttribution(7, AiUsageFeature.AI_SEARCH), AiUsageContextHelper.current())
            }
            assertThrows(IllegalStateException::class.java) {
                AiUsageContextHelper.attribute(null, AiUsageFeature.DAILY_REPORT) { error("실패") }
            }
            assertEquals(AiUsageAttribution(7, AiUsageFeature.ASSISTANT), AiUsageContextHelper.current())
        }
        assertNull(AiUsageContextHelper.current())
    }

    @Test
    fun anotherThreadOnlySeesItWhenHandedOver() {
        val pool = Executors.newSingleThreadExecutor()
        try {
            AiUsageContextHelper.attribute(3, AiUsageFeature.APPLICATION_DRAFT) {
                val handed = AiUsageContextHelper.current()
                assertNull(pool.submit<AiUsageAttribution?> { AiUsageContextHelper.current() }.get())
                assertEquals(handed, pool.submit<AiUsageAttribution?> { AiUsageContextHelper.within(handed) { AiUsageContextHelper.current() } }.get())
                assertNull(pool.submit<AiUsageAttribution?> { AiUsageContextHelper.current() }.get())
            }
        } finally {
            pool.shutdownNow()
        }
    }
}
