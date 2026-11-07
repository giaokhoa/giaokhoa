package com.giaokhoa.shared.audit;

import static org.junit.jupiter.api.Assertions.*;

import com.giaokhoa.authorization.projection.ProjectionWorker;
import com.giaokhoa.shared.audit.AuditEvent.Action;
import com.giaokhoa.shared.audit.AuditEvent.Outcome;
import com.giaokhoa.shared.audit.AuditEvent.TargetType;
import com.giaokhoa.support.IntegrationEnvironment;
import jakarta.persistence.EntityManager;
import java.time.Instant;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@Transactional
class AuditEventSchemaIT extends IntegrationEnvironment {
    private static final String SCHEMA =
            "audit_event_" + UUID.randomUUID().toString().replace("-", "");

    // Schema cô lập riêng thay vì public dùng chung: dữ kiện của class này không còn lẫn với
    // class khác và không cần ai RESET public sau lượt chạy.
    @DynamicPropertySource
    static void isolatedSchema(DynamicPropertyRegistry registry) {
        isolatedSchema(registry, SCHEMA);
    }

    @AfterAll
    static void removeSchema(@Autowired JdbcTemplate jdbc) {
        jdbc.execute("DROP SCHEMA IF EXISTS " + SCHEMA + " CASCADE");
    }

    // Worker thật chạy theo lịch sẽ mở giao dịch trên chính schema cô lập này trong khi
    // @AfterAll DROP SCHEMA cần khóa độc quyền mọi bảng — hai bên khóa chéo nhau và PostgreSQL
    // hủy DROP bằng deadlock (cùng cơ chế BootstrapProfileIT). Mọi khẳng định của class này
    // đều đồng bộ nên mock worker không đổi ý nghĩa kiểm thử.
    @MockitoBean ProjectionWorker scheduledWorker;

    @Autowired JdbcTemplate jdbc;
    @Autowired EntityManager entities;

    @Test
    void recordsOnlyMinimalMetadataAndMapsOccurredAt() {
        UUID target = UUID.randomUUID();
        UUID id = UUID.randomUUID();
        entities.persist(
                new AuditEvent(
                        id,
                        null,
                        null,
                        Action.AUTHORIZATION_SYNC,
                        TargetType.AUTHORIZATION_OPERATION,
                        target,
                        null,
                        Outcome.FAILED));
        entities.flush();
        entities.clear();

        AuditEvent loaded = entities.find(AuditEvent.class, id);
        assertEquals(target, loaded.getTargetId());
        assertEquals(Action.AUTHORIZATION_SYNC, loaded.getAction());
        assertEquals(Outcome.FAILED, loaded.getOutcome());
        assertTrue(loaded.getOccurredAt().isBefore(Instant.now().plusSeconds(2)));
        assertTrue(Objects.isNull(loaded.getActorUserId()));
        assertTrue(Objects.isNull(loaded.getWorkspaceId()));

        Set<String> fields =
                jdbc
                        .queryForList(
                                """
                                SELECT column_name FROM information_schema.columns
                                WHERE table_schema = current_schema() AND table_name = 'audit_event'
                                """,
                                String.class)
                        .stream()
                        .collect(Collectors.toSet());
        assertEquals(
                Set.of(
                        "id",
                        "actor_user_id",
                        "workspace_id",
                        "action",
                        "target_type",
                        "target_id",
                        "operation_id",
                        "outcome",
                        "occurred_at"),
                fields);
    }

    @Test
    void auditHistoryCannotBeRewrittenOrHardDeleted() {
        UUID id = UUID.randomUUID();
        jdbc.update(
                """
                INSERT INTO audit_event(id,action,target_type,target_id,outcome)
                VALUES (?,'RELATIONSHIP_CHANGE','RELATIONSHIP',?,'PENDING')
                """,
                id,
                UUID.randomUUID());
        assertThrows(
                DataAccessException.class,
                () -> jdbc.update("UPDATE audit_event SET outcome='SUCCEEDED' WHERE id=?", id));
    }

    @Test
    void auditHistoryCannotBeDeleted() {
        UUID id = UUID.randomUUID();
        jdbc.update(
                """
                INSERT INTO audit_event(id,action,target_type,target_id,outcome)
                VALUES (?,'RECOVERY','ACCOUNT',?,'FAILED')
                """,
                id,
                UUID.randomUUID());
        assertThrows(
                DataAccessException.class,
                () -> jdbc.update("DELETE FROM audit_event WHERE id=?", id));
    }

    @Test
    void auditHistoryCannotBeTruncated() {
        assertThrows(DataAccessException.class, () -> jdbc.execute("TRUNCATE audit_event"));
    }

    @Test
    void arbitraryActionCannotBeUsedToStoreSensitiveContent() {
        assertThrows(
                DataAccessException.class,
                () ->
                        jdbc.update(
                                """
                                INSERT INTO audit_event(id,action,target_type,target_id,outcome)
                                VALUES (?,'password=secret','ACCOUNT',?,'PENDING')
                                """,
                                UUID.randomUUID(),
                                UUID.randomUUID()));
    }
}
