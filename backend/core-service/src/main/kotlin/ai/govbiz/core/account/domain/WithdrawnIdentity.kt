package ai.govbiz.core.account.domain

/** 탈퇴 표식으로 남기는 식별자 종류입니다. */
enum class WithdrawnIdentityKind {
    EMAIL,
    OAUTH,
    BUSINESS_NUMBER,
}

/**
 * 탈퇴 뒤 같은 사람이 다시 가입했는지 알아보는 식별자입니다. 원문은 저장하지 않고 HMAC 값만 남기며, 같은 사람이 같은 값을 만들도록
 * 이메일은 소문자·앞뒤 공백 제거, 소셜 연결은 `제공자:subject`, 사업자등록번호는 숫자만 남깁니다.
 */
data class WithdrawnIdentity(val kind: WithdrawnIdentityKind, val value: String) {
    init {
        require(value.isNotBlank()) { "withdrawn identity must not be blank" }
    }

    companion object {
        /** 탈퇴 표식을 보관하는 기간입니다. 지나면 지우고 이어받지 않습니다. */
        const val RETENTION_DAYS = 365L

        fun email(email: String) = WithdrawnIdentity(WithdrawnIdentityKind.EMAIL, email.trim().lowercase())

        fun oauth(provider: OAuthProvider, subject: String) = WithdrawnIdentity(WithdrawnIdentityKind.OAUTH, "${provider.name}:${subject.trim()}")

        fun businessNumber(number: String) = WithdrawnIdentity(WithdrawnIdentityKind.BUSINESS_NUMBER, number.filter(Char::isDigit))

        /** 탈퇴하는 계정이 남길 식별자입니다. 소셜 연결마다 한 줄, 기업을 등록했으면 사업자등록번호 한 줄을 더합니다. */
        fun of(email: String, links: List<OAuthLink>, businessNumber: String?): List<WithdrawnIdentity> =
            listOf(email(email)) + links.map { oauth(it.provider, it.subject) } + listOfNotNull(businessNumber?.let(::businessNumber))
    }
}
