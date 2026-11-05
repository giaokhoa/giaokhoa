package com.giaokhoa.authorization.operation;

import static org.junit.jupiter.api.Assertions.*;

import com.giaokhoa.authorization.model.AuthorizationOperation;
import com.giaokhoa.shared.http.HttpProblemException;
import com.giaokhoa.support.IntegrationEnvironment;
import jakarta.persistence.EntityManager;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@Transactional
class IdempotencyServiceIT extends IntegrationEnvironment {
    @Autowired IdempotencyService idempotency;
    @Autowired JdbcTemplate jdbc;
    @Autowired EntityManager entities;

    @Test
    void sameActorAndKeyReusesPendingOperationWithoutDuplicatingQueueItem() {
        UUID actor = user();
        UUID partition = workspacePartition(actor);
        var first = operation(actor, partition, "key-one", "a".repeat(64));
        var same = operation(actor, partition, "key-one", "a".repeat(64));

        assertEquals(first.getId(), idempotency.register(first).getId());
        var replay = idempotency.register(same);
        assertEquals(first.getId(), replay.getId());
        assertEquals(HttpStatus.ACCEPTED, idempotency.responseFor(replay).getStatusCode());
        assertFalse(idempotency.responseFor(replay).getBody().completed());
        assertEquals(1, jdbc.queryForObject(
                "SELECT count(*) FROM authorization_operation WHERE initiator_user_id=?",
                Integer.class, actor));
        var conflict = assertThrows(HttpProblemException.class, () -> idempotency.register(
                operation(actor, partition, "key-one", "b".repeat(64))));
        assertEquals(HttpStatus.CONFLICT, conflict.getStatus());
        assertEquals("IDEMPOTENCY_CONFLICT", conflict.getCode());
    }

    @Test
    void completedResponseRequiresSucceededState() {
        UUID actor = user();
        UUID partition = workspacePartition(actor);
        var operation = operation(actor, partition, "key-complete", "a".repeat(64));
        idempotency.register(operation);

        jdbc.update("UPDATE authz_partition SET state='READY' WHERE id=?", partition);
        jdbc.update("UPDATE authorization_operation SET state='SUCCEEDED' WHERE id=?", operation.getId());
        jdbc.execute("SET CONSTRAINTS ALL IMMEDIATE");
        entities.clear();

        var completed = idempotency.findExisting(actor, "key-complete", "a".repeat(64)).orElseThrow();
        assertEquals(HttpStatus.OK, idempotency.responseFor(completed).getStatusCode());
        assertTrue(idempotency.responseFor(completed).getBody().completed());
    }

    @Test
    void sameKeyCanBeUsedByDifferentActors() {
        UUID first = user();
        UUID second = user();
        idempotency.register(operation(first, workspacePartition(first), "key-two", "a".repeat(64)));
        idempotency.register(operation(second, workspacePartition(second), "key-two", "b".repeat(64)));
        assertEquals(2, jdbc.queryForObject(
                "SELECT count(*) FROM authorization_operation WHERE idempotency_key='key-two'", Integer.class));
    }

    private AuthorizationOperation operation(UUID actor, UUID partition, String key, String hash) {
        return new AuthorizationOperation(UUID.randomUUID(), actor, jdbc.queryForObject(
                "SELECT id FROM workspace WHERE owner_user_id=?", UUID.class, actor),
                key, hash, new UUID[]{partition}, new Long[]{0L}, 0L);
    }

    private UUID workspacePartition(UUID actor) {
        UUID workspace = jdbc.queryForObject(
                "SELECT id FROM workspace WHERE owner_user_id=?", UUID.class, actor);
        return jdbc.queryForObject("SELECT id FROM authz_partition WHERE owner_key=?",
                UUID.class, "workspace:" + workspace);
    }

    private UUID user() {
        UUID actor = UUID.randomUUID();
        jdbc.update("INSERT INTO user_account(id,keycloak_sub,username,email_verified,origin,identity_state)"
                        + " VALUES (?,?,?,false,'CENTER_ISSUED','PENDING')",
                actor, "sub-" + actor, "user-" + actor);
        jdbc.update("INSERT INTO workspace(id,kind,owner_user_id,state) VALUES (?, 'PERSONAL', ?, 'ACTIVE')",
                UUID.randomUUID(), actor);
        return actor;
    }
}
