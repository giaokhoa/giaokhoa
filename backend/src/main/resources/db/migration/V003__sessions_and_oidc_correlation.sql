-- Đúng schema PostgreSQL của Spring Session JDBC 4.1 (spring-session-jdbc/schema-postgresql.sql).
-- Flyway sở hữu các bảng này; auto-initialization schema của Spring Session luôn bị tắt.
CREATE TABLE SPRING_SESSION (
    PRIMARY_ID CHAR(36) NOT NULL,
    SESSION_ID CHAR(36) NOT NULL,
    CREATION_TIME BIGINT NOT NULL,
    LAST_ACCESS_TIME BIGINT NOT NULL,
    MAX_INACTIVE_INTERVAL INT NOT NULL,
    EXPIRY_TIME BIGINT NOT NULL,
    PRINCIPAL_NAME VARCHAR(100),
    CONSTRAINT SPRING_SESSION_PK PRIMARY KEY (PRIMARY_ID)
);
CREATE UNIQUE INDEX SPRING_SESSION_IX1 ON SPRING_SESSION (SESSION_ID);
CREATE INDEX SPRING_SESSION_IX2 ON SPRING_SESSION (EXPIRY_TIME);
CREATE INDEX SPRING_SESSION_IX3 ON SPRING_SESSION (PRINCIPAL_NAME);

CREATE TABLE SPRING_SESSION_ATTRIBUTES (
    SESSION_PRIMARY_ID CHAR(36) NOT NULL,
    ATTRIBUTE_NAME VARCHAR(200) NOT NULL,
    ATTRIBUTE_BYTES BYTEA NOT NULL,
    CONSTRAINT SPRING_SESSION_ATTRIBUTES_PK PRIMARY KEY (SESSION_PRIMARY_ID, ATTRIBUTE_NAME),
    CONSTRAINT SPRING_SESSION_ATTRIBUTES_FK FOREIGN KEY (SESSION_PRIMARY_ID)
        REFERENCES SPRING_SESSION(PRIMARY_ID) ON DELETE CASCADE
);

-- OAuth2 login đăng ký correlation trước khi Spring Session flush session mới.
-- Không có FK tới SPRING_SESSION: nó sẽ từ chối trình tự đăng ký hợp lệ đó.
-- CSRF header/token phải sống sót qua khởi động lại cho back-channel POST nội bộ của Spring.
CREATE TABLE oidc_session_correlation (
    session_id CHAR(36) PRIMARY KEY,
    issuer VARCHAR(2048) NOT NULL,
    client_id VARCHAR(255) NOT NULL,
    sub VARCHAR(512) NOT NULL,
    sid VARCHAR(512),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    csrf_header_name VARCHAR(128),
    csrf_token VARCHAR(1024),
    CONSTRAINT ck_oidc_correlation_csrf CHECK (
        (csrf_header_name IS NULL) = (csrf_token IS NULL)
    )
);
CREATE INDEX ix_oidc_correlation_sid
    ON oidc_session_correlation (issuer, client_id, sid) WHERE sid IS NOT NULL;
CREATE INDEX ix_oidc_correlation_sub
    ON oidc_session_correlation (issuer, client_id, sub);

-- Spring Session JDBC xóa session hết hạn bằng SQL mà không publish một
-- SessionDestroyedEvent của Spring Security. Giữ vòng đời correlation gắn với JDBC.
CREATE FUNCTION sync_oidc_correlation_session() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        DELETE FROM oidc_session_correlation WHERE session_id = OLD.session_id;
    ELSIF OLD.session_id IS DISTINCT FROM NEW.session_id THEN
        UPDATE oidc_session_correlation SET session_id = NEW.session_id
        WHERE session_id = OLD.session_id;
    END IF;
    RETURN NULL;
END;
$$;
CREATE TRIGGER delete_oidc_correlation_after_session_delete
    AFTER DELETE ON spring_session FOR EACH ROW
    EXECUTE FUNCTION sync_oidc_correlation_session();
CREATE TRIGGER move_oidc_correlation_after_session_id_change
    AFTER UPDATE OF session_id ON spring_session FOR EACH ROW
    EXECUTE FUNCTION sync_oidc_correlation_session();
