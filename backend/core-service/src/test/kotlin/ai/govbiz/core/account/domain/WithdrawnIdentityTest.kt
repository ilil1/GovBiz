package ai.govbiz.core.account.domain

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

class WithdrawnIdentityTest {
    @Test
    fun theSamePersonMakesTheSameValueWhateverTheFormatting() {
        assertEquals(WithdrawnIdentity.email("manager@company.co.kr"), WithdrawnIdentity.email("  Manager@Company.CO.KR "))
        assertEquals(WithdrawnIdentity.businessNumber("1248100998"), WithdrawnIdentity.businessNumber("124-81-00998"))
        assertEquals("KAKAO:4012345678", WithdrawnIdentity.oauth(OAuthProvider.KAKAO, " 4012345678 ").value)
        // 다른 제공자의 같은 subject는 다른 사람입니다.
        assertEquals(false, WithdrawnIdentity.oauth(OAuthProvider.KAKAO, "1") == WithdrawnIdentity.oauth(OAuthProvider.GOOGLE, "1"))
    }

    @Test
    fun aWithdrawingAccountLeavesItsEmailEachSocialLinkAndItsBusinessNumber() {
        val links = listOf(OAuthLink(OAuthProvider.KAKAO, "k"), OAuthLink(OAuthProvider.GOOGLE, "g"))
        assertEquals(
            listOf(WithdrawnIdentityKind.EMAIL, WithdrawnIdentityKind.OAUTH, WithdrawnIdentityKind.OAUTH, WithdrawnIdentityKind.BUSINESS_NUMBER),
            WithdrawnIdentity.of("a@example.test", links, "1248100998").map { it.kind },
        )
        assertEquals(listOf(WithdrawnIdentity.email("a@example.test")), WithdrawnIdentity.of("a@example.test", emptyList(), null))
    }

    @Test
    fun blankValuesAreRejected() {
        assertThrows(IllegalArgumentException::class.java) { WithdrawnIdentity.email("  ") }
        assertThrows(IllegalArgumentException::class.java) { WithdrawnIdentity.businessNumber("---") }
    }
}
