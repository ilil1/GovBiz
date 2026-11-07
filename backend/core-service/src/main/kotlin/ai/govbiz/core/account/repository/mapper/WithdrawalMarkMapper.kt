package ai.govbiz.core.account.repository.mapper

import java.time.LocalDateTime
import org.apache.ibatis.annotations.Mapper
import org.apache.ibatis.annotations.Param

/** MyBatis가 탈퇴 표식 한 행을 읽고 쓰기 위한 DB 행 값입니다. */
data class WithdrawalMarkDbRow(
    var id: Long = 0,
    var identityKind: String = "",
    var identityHash: String = "",
    var accountId: Long = 0,
    var withdrawnAt: LocalDateTime? = null,
    var expiresAt: LocalDateTime? = null,
    var inheritedByAccountId: Long? = null,
    var inheritedAt: LocalDateTime? = null,
)

/** 탈퇴 표식 조회에 넘기는 (종류, HMAC) 한 쌍입니다. */
data class WithdrawalMarkKeyDbRow(
    var kind: String = "",
    var hash: String = "",
)

@Mapper
interface WithdrawalMarkMapper {
    /** 같은 계정·식별자 표식이 이미 있으면 그대로 둡니다. */
    fun insertMark(row: WithdrawalMarkDbRow): Int

    /** 아직 이어받지 않았고 만료되지 않은 표식을 잠그며 읽습니다. 새 계정 자신의 표식은 뺍니다. */
    fun findInheritable(
        @Param("keys") keys: List<WithdrawalMarkKeyDbRow>,
        @Param("successorId") successorId: Long,
        @Param("now") now: LocalDateTime,
    ): List<WithdrawalMarkDbRow>

    /** 이어받은 탈퇴 계정의 표식을 모두 사용 처리합니다(한 탈퇴 계정은 한 번만 이어받음). */
    fun markInherited(
        @Param("accountIds") accountIds: List<Long>,
        @Param("successorId") successorId: Long,
        @Param("now") now: LocalDateTime,
    ): Int

    /** 이 계정이 이어받은 탈퇴 계정입니다. */
    fun findInheritedAccountIds(@Param("successorId") successorId: Long): List<Long>

    fun deleteExpired(@Param("now") now: LocalDateTime, @Param("limit") limit: Int): Int
}
