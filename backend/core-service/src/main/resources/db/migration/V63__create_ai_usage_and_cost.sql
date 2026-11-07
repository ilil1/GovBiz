-- 관리자가 OpenAI 비용을 보도록 요청마다 쓴 토큰과 추정 비용, OpenAI가 알려 준 실제 일별 비용을 남깁니다.
-- 추정 비용은 ai-service가 돌려준 (모델, 처리 등급)별 토큰에 그때의 가격표를 곱한 값이고, 실제 비용은 조직 관리자 키가 있을 때만
-- OpenAI Costs API(일 단위, UTC)에서 가져옵니다. 계정은 삭제 표시로만 지우므로 계정을 지워도 사용 기록은 남깁니다.

-- 모델 가격표(1M 토큰당 USD). 모델 이름은 접두어로 맞추고(`gpt-5.6-luna`는 `gpt-5.6-luna-2026-07-30`도 포함), 같은 접두어·등급은
-- effective_from이 가장 늦은 행을 씁니다. 가격이 바뀌면 행을 고치지 않고 새 날짜로 더합니다. 처리 등급은 응답의 service_tier이며
-- Fast 모드는 응답에서 priority로 옵니다. 긴 문맥(272K 초과)·캐시 쓰기·지역 처리 할증은 아직 반영하지 않습니다.
CREATE TABLE ai_model_price (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    model_prefix VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    service_tier VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    input_usd_per_million DECIMAL(12, 6) NOT NULL,
    cached_input_usd_per_million DECIMAL(12, 6) NULL,
    output_usd_per_million DECIMAL(12, 6) NOT NULL,
    effective_from DATE NOT NULL,
    note VARCHAR(200) NULL,
    created_by_account_id BIGINT UNSIGNED NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uq_ai_model_price UNIQUE (model_prefix, service_tier, effective_from),
    CONSTRAINT fk_ai_model_price_creator FOREIGN KEY (created_by_account_id) REFERENCES account (id) ON DELETE SET NULL,
    CONSTRAINT chk_ai_model_price_model CHECK (model_prefix REGEXP '^[a-z0-9][a-z0-9._:-]{0,99}$'),
    CONSTRAINT chk_ai_model_price_tier CHECK (service_tier IN ('default', 'priority', 'flex')),
    CONSTRAINT chk_ai_model_price_amount CHECK (
        input_usd_per_million >= 0 AND output_usd_per_million >= 0
        AND (cached_input_usd_per_million IS NULL OR cached_input_usd_per_million >= 0)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 2026-10-10 OpenAI 공식 가격 페이지의 Standard(default)·Flex·Fast(priority) 짧은 문맥 가격입니다. gpt-5.6-sol은 11월 21일 이후까지 이어지는 프로모션 가격입니다.
INSERT INTO ai_model_price
    (model_prefix, service_tier, input_usd_per_million, cached_input_usd_per_million, output_usd_per_million, effective_from, note, created_at)
VALUES
    ('gpt-5.6-sol', 'default', 4, 0.4, 20, '2026-10-01', 'OpenAI 공식 가격 페이지 2026-10-10 확인(짧은 문맥)', CURRENT_TIMESTAMP(6)),
    ('gpt-5.6-sol', 'flex', 2, 0.2, 10, '2026-10-01', 'OpenAI 공식 가격 페이지 2026-10-10 확인(짧은 문맥)', CURRENT_TIMESTAMP(6)),
    ('gpt-5.6-sol', 'priority', 8, 0.8, 40, '2026-10-01', 'OpenAI 공식 가격 페이지 2026-10-10 확인(짧은 문맥)', CURRENT_TIMESTAMP(6)),
    ('gpt-5.6-terra', 'default', 2, 0.2, 12, '2026-10-01', 'OpenAI 공식 가격 페이지 2026-10-10 확인(짧은 문맥)', CURRENT_TIMESTAMP(6)),
    ('gpt-5.6-terra', 'flex', 1, 0.1, 6, '2026-10-01', 'OpenAI 공식 가격 페이지 2026-10-10 확인(짧은 문맥)', CURRENT_TIMESTAMP(6)),
    ('gpt-5.6-terra', 'priority', 4, 0.4, 24, '2026-10-01', 'OpenAI 공식 가격 페이지 2026-10-10 확인(짧은 문맥)', CURRENT_TIMESTAMP(6)),
    ('gpt-5.6-luna', 'default', 0.2, 0.02, 1.2, '2026-10-01', 'OpenAI 공식 가격 페이지 2026-10-10 확인(짧은 문맥)', CURRENT_TIMESTAMP(6)),
    ('gpt-5.6-luna', 'flex', 0.1, 0.01, 0.6, '2026-10-01', 'OpenAI 공식 가격 페이지 2026-10-10 확인(짧은 문맥)', CURRENT_TIMESTAMP(6)),
    ('gpt-5.6-luna', 'priority', 0.4, 0.04, 2.4, '2026-10-01', 'OpenAI 공식 가격 페이지 2026-10-10 확인(짧은 문맥)', CURRENT_TIMESTAMP(6)),
    ('gpt-6-astra', 'default', 10, 1, 50, '2026-10-01', 'OpenAI 공식 가격 페이지 2026-10-10 확인(짧은 문맥)', CURRENT_TIMESTAMP(6)),
    ('gpt-6-astra', 'flex', 5, 0.5, 25, '2026-10-01', 'OpenAI 공식 가격 페이지 2026-10-10 확인(짧은 문맥)', CURRENT_TIMESTAMP(6)),
    ('gpt-6-astra', 'priority', 20, 2, 100, '2026-10-01', 'OpenAI 공식 가격 페이지 2026-10-10 확인(짧은 문맥)', CURRENT_TIMESTAMP(6)),
    ('gpt-6.1-sol', 'default', 2, 0.1, 10, '2026-10-01', 'OpenAI 공식 가격 페이지 2026-10-10 확인(짧은 문맥)', CURRENT_TIMESTAMP(6)),
    ('gpt-6.1-sol', 'flex', 1, 0.05, 5, '2026-10-01', 'OpenAI 공식 가격 페이지 2026-10-10 확인(짧은 문맥)', CURRENT_TIMESTAMP(6)),
    ('gpt-6.1-sol', 'priority', 4, 0.2, 20, '2026-10-01', 'OpenAI 공식 가격 페이지 2026-10-10 확인(짧은 문맥)', CURRENT_TIMESTAMP(6)),
    ('gpt-6-sol', 'default', 2, 0.2, 10, '2026-10-01', 'OpenAI 공식 가격 페이지 2026-10-10 확인(짧은 문맥)', CURRENT_TIMESTAMP(6)),
    ('gpt-6-sol', 'flex', 1, 0.1, 5, '2026-10-01', 'OpenAI 공식 가격 페이지 2026-10-10 확인(짧은 문맥)', CURRENT_TIMESTAMP(6)),
    ('gpt-6-sol', 'priority', 4, 0.4, 20, '2026-10-01', 'OpenAI 공식 가격 페이지 2026-10-10 확인(짧은 문맥)', CURRENT_TIMESTAMP(6)),
    ('gpt-6-luna', 'default', 0.1, 0.01, 0.5, '2026-10-01', 'OpenAI 공식 가격 페이지 2026-10-10 확인(짧은 문맥)', CURRENT_TIMESTAMP(6)),
    ('gpt-6-luna', 'flex', 0.05, 0.005, 0.25, '2026-10-01', 'OpenAI 공식 가격 페이지 2026-10-10 확인(짧은 문맥)', CURRENT_TIMESTAMP(6)),
    ('gpt-6-luna', 'priority', 0.2, 0.02, 1, '2026-10-01', 'OpenAI 공식 가격 페이지 2026-10-10 확인(짧은 문맥)', CURRENT_TIMESTAMP(6)),
    ('gpt-5-mini', 'default', 0.25, 0.025, 2, '2026-10-01', 'OpenAI 공식 가격 페이지 2026-10-10 확인(짧은 문맥)', CURRENT_TIMESTAMP(6)),
    ('gpt-5-mini', 'flex', 0.125, 0.0125, 1, '2026-10-01', 'OpenAI 공식 가격 페이지 2026-10-10 확인(짧은 문맥)', CURRENT_TIMESTAMP(6)),
    ('gpt-5-mini', 'priority', 0.45, 0.045, 3.6, '2026-10-01', 'OpenAI 공식 가격 페이지 2026-10-10 확인(짧은 문맥)', CURRENT_TIMESTAMP(6)),
    ('gpt-5-nano', 'default', 0.05, 0.005, 0.4, '2026-10-01', 'OpenAI 공식 가격 페이지 2026-10-10 확인(짧은 문맥)', CURRENT_TIMESTAMP(6)),
    ('gpt-5-nano', 'flex', 0.025, 0.0025, 0.2, '2026-10-01', 'OpenAI 공식 가격 페이지 2026-10-10 확인(짧은 문맥)', CURRENT_TIMESTAMP(6)),
    ('text-embedding-3-small', 'default', 0.02, NULL, 0, '2026-10-01', 'OpenAI 공식 가격 페이지 2026-10-10 확인(짧은 문맥)', CURRENT_TIMESTAMP(6)),
    ('text-embedding-3-large', 'default', 0.13, NULL, 0, '2026-10-01', 'OpenAI 공식 가격 페이지 2026-10-10 확인(짧은 문맥)', CURRENT_TIMESTAMP(6));

-- ai-service 요청 하나가 쓴 (모델, 처리 등급)별 토큰입니다. 입력 토큰은 캐시 토큰을, 출력 토큰은 추론 토큰을 포함합니다.
-- 계정·기능은 Core가 AI를 부른 기능에서 정하며, 없으면 로그인 전 요청이나 시스템 작업(색인·공고 분석)입니다.
-- 가격표에 없는 모델·등급은 추정 비용을 비워 두고 화면에 "가격 없음"으로 셉니다.
CREATE TABLE ai_usage_record (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    occurred_at DATETIME(6) NOT NULL,
    usage_date DATE NOT NULL,
    account_id BIGINT UNSIGNED NULL,
    feature VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL,
    operation VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    model VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    service_tier VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    call_count INT UNSIGNED NOT NULL,
    input_tokens BIGINT UNSIGNED NOT NULL,
    cached_input_tokens BIGINT UNSIGNED NOT NULL,
    output_tokens BIGINT UNSIGNED NOT NULL,
    estimated_cost_usd DECIMAL(20, 10) NULL,
    price_id BIGINT UNSIGNED NULL,
    PRIMARY KEY (id),
    KEY ix_ai_usage_record_date (usage_date),
    KEY ix_ai_usage_record_account (account_id, usage_date),
    KEY ix_ai_usage_record_feature (feature, usage_date),
    CONSTRAINT fk_ai_usage_record_account FOREIGN KEY (account_id) REFERENCES account (id) ON DELETE SET NULL,
    CONSTRAINT fk_ai_usage_record_price FOREIGN KEY (price_id) REFERENCES ai_model_price (id),
    CONSTRAINT chk_ai_usage_record_feature CHECK (feature IS NULL OR feature IN (
        'AI_SEARCH', 'EVIDENCE_QUESTION', 'APPLICATION_DRAFT', 'COMBINATION_REVIEW', 'ASSISTANT', 'DAILY_REPORT', 'SAVED_PROGRAM_PREFETCH', 'GOV_AGENT'
    )),
    CONSTRAINT chk_ai_usage_record_tokens CHECK (call_count >= 1 AND cached_input_tokens <= input_tokens),
    CONSTRAINT chk_ai_usage_record_cost CHECK (estimated_cost_usd IS NULL OR estimated_cost_usd >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- OpenAI Costs API가 알려 준 실제 비용입니다. 날짜는 OpenAI의 하루(UTC)이고 (날짜, 프로젝트, 항목)마다 한 줄입니다.
-- 가져온 기간 전체를 확인한 뒤 그 기간의 행을 한 transaction에서 바꾸며, 가져오지 못하면 기존 행을 그대로 둡니다.
CREATE TABLE ai_cost_daily (
    cost_date DATE NOT NULL,
    project_id VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    line_item VARCHAR(200) NOT NULL,
    amount_usd DECIMAL(20, 10) NOT NULL,
    fetched_at DATETIME(6) NOT NULL,
    PRIMARY KEY (cost_date, project_id, line_item)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 관리자가 AI 비용 화면(많이 쓴 회원의 이메일 포함)을 보는 일도 접속기록에 남깁니다.
-- 기존 행은 바꾸지 않고 CHECK 제약이 허용하는 값만 넓힙니다.
ALTER TABLE admin_access_log
    DROP CHECK chk_admin_access_log_action;

ALTER TABLE admin_access_log
    ADD CONSTRAINT chk_admin_access_log_action CHECK (action IN (
        'ACCOUNT_LIST',
        'ACCOUNT_DETAIL',
        'ACCOUNT_SUSPEND',
        'ACCOUNT_UNSUSPEND',
        'ACCOUNT_SESSIONS_REVOKE',
        'ACCOUNT_ADMIN_GRANT',
        'ACCOUNT_ADMIN_REVOKE',
        'AUDIT_LOG_LIST',
        'AI_COST_VIEW'
    ));
