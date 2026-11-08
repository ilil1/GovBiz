ALTER TABLE ai_usage_record
    ADD COLUMN trace_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
    ADD INDEX ix_ai_usage_record_trace_id (trace_id);
