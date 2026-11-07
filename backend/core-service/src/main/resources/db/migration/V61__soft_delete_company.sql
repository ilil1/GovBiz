-- 탈퇴한 계정의 기업은 지우지 않고 deleted_at만 남깁니다. 기업 행을 지우면 FK CASCADE가 그 기업의 모집글과
-- 거기에 다른 회원이 보낸 제안까지 지웠습니다. 행은 남기고 조회에서 탈퇴 여부로 거릅니다.
-- 사업자번호 UNIQUE는 탈퇴하지 않은 기업에만 걸어 같은 번호로 다시 가입해 등록할 수 있게 합니다.
-- 생성 열은 탈퇴한 행에서 NULL이 되고, UNIQUE는 여러 NULL을 허용합니다.
ALTER TABLE company
    ADD COLUMN deleted_at DATETIME(6) NULL,
    ADD COLUMN active_business_number CHAR(10)
        GENERATED ALWAYS AS (IF(deleted_at IS NULL, business_number, NULL)) STORED;

ALTER TABLE company
    DROP INDEX uq_company_business_number,
    ADD CONSTRAINT uq_company_active_business_number UNIQUE (active_business_number);
