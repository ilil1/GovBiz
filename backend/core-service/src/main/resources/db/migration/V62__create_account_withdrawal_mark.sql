-- 탈퇴 후 재가입 남용을 막는 탈퇴 표식입니다. 탈퇴할 때 이메일·소셜 연결(제공자+subject)·사업자등록번호를 원문 대신
-- 서버 비밀값으로 만든 HMAC-SHA256(16진수 64자)으로 한 줄씩 남기고, 보관 만료일(탈퇴 + 1년)이 지나면 지웁니다.
-- 같은 식별자로 다시 가입하거나 기업을 등록하면 새 계정이 탈퇴 계정의 체험 이력과 이번 하루·달 사용량을 이어받고,
-- 그 탈퇴 계정의 표식에 이어받은 시각을 적어 한 번만 쓰게 합니다. 탈퇴는 계정 행을 지우지 않으므로 탈퇴 계정 행은 남아 있습니다.
-- 사용 여부는 inherited_at으로 판단합니다. inherited_by_account_id는 이어받은 계정을 보여 주는 값이며, MySQL은 ON DELETE SET NULL 외래 키
-- 열을 CHECK에 쓸 수 없어 두 열을 함께 묶는 CHECK는 두지 않습니다.
CREATE TABLE account_withdrawal_mark (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    identity_kind VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    identity_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    account_id BIGINT UNSIGNED NOT NULL,
    withdrawn_at DATETIME(6) NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    inherited_by_account_id BIGINT UNSIGNED NULL,
    inherited_at DATETIME(6) NULL,
    PRIMARY KEY (id),
    CONSTRAINT uq_account_withdrawal_mark UNIQUE (account_id, identity_kind, identity_hash),
    KEY ix_account_withdrawal_mark_lookup (identity_kind, identity_hash, expires_at),
    KEY ix_account_withdrawal_mark_expiry (expires_at),
    CONSTRAINT fk_account_withdrawal_mark_account FOREIGN KEY (account_id) REFERENCES account (id) ON DELETE CASCADE,
    CONSTRAINT fk_account_withdrawal_mark_successor FOREIGN KEY (inherited_by_account_id) REFERENCES account (id) ON DELETE SET NULL,
    CONSTRAINT chk_account_withdrawal_mark_kind CHECK (identity_kind IN ('EMAIL', 'OAUTH', 'BUSINESS_NUMBER')),
    CONSTRAINT chk_account_withdrawal_mark_hash CHECK (identity_hash REGEXP '^[0-9a-f]{64}$'),
    CONSTRAINT chk_account_withdrawal_mark_period CHECK (expires_at > withdrawn_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
