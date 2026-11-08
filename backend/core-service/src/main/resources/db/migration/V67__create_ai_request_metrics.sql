CREATE TABLE ai_request_metric (
    metric_date DATE NOT NULL,
    feature VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    outcome VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    latency_bucket_ms INT NOT NULL,
    request_count BIGINT NOT NULL,
    PRIMARY KEY (metric_date, feature, outcome, latency_bucket_ms),
    CONSTRAINT chk_ai_request_metric_count CHECK (request_count > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
