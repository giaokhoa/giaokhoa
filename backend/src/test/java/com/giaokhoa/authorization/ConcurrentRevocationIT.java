package com.giaokhoa.authorization;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.giaokhoa.authorization.model.AuthorizationOperation;
import com.giaokhoa.authorization.operation.IdempotencyService;
import com.giaokhoa.support.IntegrationEnvironment;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.core.oidc.OidcIdToken;
import org.springframework.security.oauth2.core.oidc.user.DefaultOidcUser;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.context.WebApplicationContext;

/** Real PostgreSQL locks: a revoke and a protected write must have one commit order. */
@SpringBootTest
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class ConcurrentRevocationIT extends IntegrationEnvironment {
    private static final String SCHEMA =
            "t014_concurrent_" + UUID.randomUUID().toString().replace("-", "");

    @DynamicPropertySource
    static void isolatedCommittedTransactions(DynamicPropertyRegistry registry) {
        registry.add("spring.flyway.schemas", () -> SCHEMA);
        registry.add("spring.flyway.default-schema", () -> SCHEMA);
        registry.add(
                "spring.datasource.hikari.connection-init-sql",
                () -> "SET search_path TO " + SCHEMA + ",public");
    }

    @AfterAll
    static void removeCommittedFixtures(@Autowired JdbcTemplate jdbc) {
        // The real DB forbids deleting individual partitions; only drop this test-owned schema.
        jdbc.execute("DROP SCHEMA IF EXISTS " + SCHEMA + " CASCADE");
    }

    @Autowired JdbcTemplate jdbc;
    @Autowired IdempotencyService idempotency;
    @Autowired PlatformTransactionManager transactionManager;
    @Autowired WebApplicationContext webContext;

    @Test
    void inFlightWriteFinishesBeforeRevocationCanAcquireExclusiveFence() throws Exception {
        UUID partition = partition();
        CountDownLatch protectedLock = new CountDownLatch(1);
        CountDownLatch releaseWrite = new CountDownLatch(1);
        CountDownLatch revokeStarted = new CountDownLatch(1);

        try (var pool = Executors.newFixedThreadPool(2)) {
            var writer =
                    pool.submit(() ->
                            tx(() -> {
                                assertEquals("READY", lockedState(partition, "SHARE"));
                                protectedLock.countDown();
                                await(releaseWrite);
                                // Protected mutation holds the read fence until commit.
                                return 1;
                            }));
            assertTrue(protectedLock.await(10, TimeUnit.SECONDS));
            var revoker =
                    pool.submit(() ->
                            tx(() -> {
                                revokeStarted.countDown();
                                lockedState(partition, "UPDATE");
                                fence(partition, 1);
                                return 1;
                            }));
            assertTrue(revokeStarted.await(10, TimeUnit.SECONDS));
            try {
                assertThrows(
                        TimeoutException.class,
                        () -> revoker.get(300, TimeUnit.MILLISECONDS),
                        "Revoke must block until the protected transaction commits");
            } finally {
                releaseWrite.countDown();
            }

            assertEquals(1, writer.get(10, TimeUnit.SECONDS));
            assertEquals(1, revoker.get(10, TimeUnit.SECONDS));
            assertEquals("PENDING", state(partition));
        } finally {
            releaseWrite.countDown();
        }
    }

    @Test
    void writeStartedAfterRevocationCannotObserveAnOldReadyRevision() throws Exception {
        UUID partition = partition();
        CountDownLatch revokedButNotCommitted = new CountDownLatch(1);
        CountDownLatch commitRevoke = new CountDownLatch(1);

        try (var pool = Executors.newFixedThreadPool(2)) {
            var revoker =
                    pool.submit(() ->
                            tx(() -> {
                                lockedState(partition, "UPDATE");
                                fence(partition, 1);
                                revokedButNotCommitted.countDown();
                                await(commitRevoke);
                                return 1;
                            }));
            assertTrue(revokedButNotCommitted.await(10, TimeUnit.SECONDS));
            var writer = pool.submit(() -> tx(() -> lockedState(partition, "SHARE")));
            try {
                assertThrows(
                        TimeoutException.class,
                        () -> writer.get(300, TimeUnit.MILLISECONDS),
                        "A write may not read the old READY state while revoke holds the fence");
            } finally {
                commitRevoke.countDown();
            }

            assertEquals(1, revoker.get(10, TimeUnit.SECONDS));
            assertEquals("PENDING", writer.get(10, TimeUnit.SECONDS));
        } finally {
            commitRevoke.countDown();
        }
    }

    @Test
    void concurrentProtectedHttpMutationMustNotBypassRevocationFence() throws Exception {
        // RED (T018): real Spring MVC business request must wait for the revoke's DB fence.
        // No test-only PEP: the declared POST /classes route is currently absent (HTTP 404).
        try (var nativeGate = new NativeRevocationFixture()) {
            ActorScope fixture = actorWithReadyPersonalWorkspace(nativeGate.userSubject());
            MockMvc mvc =
                    MockMvcBuilders.webAppContextSetup(webContext).apply(springSecurity()).build();
            var idToken =
                    new OidcIdToken(
                            "synthetic-session-id-token",
                            Instant.now(),
                            Instant.now().plusSeconds(600),
                            Map.of(
                                    "iss",
                                    "http://127.0.0.1:18081/realms/giaokhoa-it",
                                    "sub",
                                    nativeGate.userSubject(),
                                    "aud",
                                    List.of("giaokhoa-it-web")));
            var auth =
                    new OAuth2AuthenticationToken(
                            new DefaultOidcUser(List.of(), idToken, "sub"), List.of(), "keycloak");
            CountDownLatch revokeLocked = new CountDownLatch(1);
            CountDownLatch finishRevoke = new CountDownLatch(1);

            try (var pool = Executors.newFixedThreadPool(2)) {
                var revoker =
                        pool.submit(() ->
                                tx(() -> {
                                    lockedState(fixture.partition(), "UPDATE");
                                    fence(fixture.partition(), 1);
                                    revokeLocked.countDown();
                                    await(finishRevoke);
                                    return 1;
                                }));
                assertTrue(revokeLocked.await(10, TimeUnit.SECONDS));
                var writer =
                        pool.submit(() ->
                                mvc.perform(
                                                post(
                                                                "/api/workspaces/{wid}/classes",
                                                                fixture.workspace())
                                                        .with(csrf())
                                                        .with(authentication(auth))
                                                        .header(
                                                                "Idempotency-Key",
                                                                "t014-concurrent")
                                                        .contentType(MediaType.APPLICATION_JSON)
                                                        .content("{\"name\":\"T014 protected\"}"))
                                        .andReturn()
                                        .getResponse()
                                        .getStatus());
                try {
                    assertThrows(
                            TimeoutException.class,
                            () -> writer.get(300, TimeUnit.MILLISECONDS),
                            "The HTTP mutation must hold a shared fence until the revoke commits");
                } finally {
                    finishRevoke.countDown();
                }

                assertEquals(1, revoker.get(10, TimeUnit.SECONDS));
                assertEquals(
                        HttpStatus.SERVICE_UNAVAILABLE.value(), writer.get(10, TimeUnit.SECONDS));
                assertEquals(
                        0,
                        jdbc.queryForObject(
                                "SELECT count(*) FROM authorization_operation WHERE workspace_id = ?",
                                Integer.class,
                                fixture.workspace()));
            } finally {
                finishRevoke.countDown();
            }
        }
    }

    private ActorScope actorWithReadyPersonalWorkspace(String keycloakSub) {
        return tx(() -> {
            UUID actor = UUID.randomUUID();
            UUID workspace = UUID.randomUUID();
            jdbc.update(
                    "INSERT INTO user_account(id,keycloak_sub,username,email,email_verified,origin,identity_state)"
                            + " VALUES (?,?,?,?,true,'SELF_REGISTERED','ACTIVE')",
                    actor,
                    keycloakSub,
                    "t014-actor-" + actor,
                    "t014-" + actor + "@example.invalid");
            jdbc.update(
                    "INSERT INTO workspace(id,kind,owner_user_id,state)"
                            + " VALUES (?,'PERSONAL',?,'ACTIVE')",
                    workspace,
                    actor);
            UUID partition =
                    jdbc.queryForObject(
                            "SELECT id FROM authz_partition WHERE owner_key = ?",
                            UUID.class,
                            "workspace:" + workspace);
            jdbc.update(
                    "UPDATE authz_partition SET state = 'READY'" + " WHERE owner_key IN (?, ?)",
                    "account:" + actor,
                    "workspace:" + workspace);
            return new ActorScope(workspace, partition);
        });
    }

    private record ActorScope(UUID workspace, UUID partition) {}

    @Test
    void staleWorkerCannotPublishOldRevisionAfterNewRevoke() {
        UUID partition = partition();
        tx(() -> {
            fence(partition, 2);
            return null;
        });

        // A worker for revision 1 cannot claim READY after revision 2 has become desired.
        assertThrows(
                DataAccessException.class,
                () ->
                        tx(() -> {
                            jdbc.update(
                                    "UPDATE authz_partition SET applied_revision = 1,"
                                            + " state = 'READY' WHERE id = ?",
                                    partition);
                            return null;
                        }));
        assertEquals("PENDING", state(partition));
        assertEquals(
                2L,
                jdbc.queryForObject(
                        "SELECT desired_revision FROM authz_partition WHERE id = ?",
                        Long.class,
                        partition));
    }

    @Test
    void abandonedApplyingOperationStaysFencedUntilRecoveryPublishesRevision() {
        Recovery created =
                tx(() -> {
                    UUID actor = UUID.randomUUID();
                    UUID workspace = UUID.randomUUID();
                    UUID grant = UUID.randomUUID();
                    jdbc.update(
                            "INSERT INTO user_account(id,keycloak_sub,username,email_verified,origin,identity_state)"
                                    + " VALUES (?,?,?,false,'SELF_REGISTERED','PENDING')",
                            actor,
                            "t014-sub-" + actor,
                            "t014-user-" + actor);
                    jdbc.update(
                            "INSERT INTO workspace(id,kind,owner_user_id,state)"
                                    + " VALUES (?,'PERSONAL',?,'ACTIVE')",
                            workspace,
                            actor);
                    jdbc.update(
                            "INSERT INTO authz_partition(id,kind,owner_key,state)"
                                    + " VALUES (?,'GRANT',?,'READY')",
                            grant,
                            "grant:" + grant);
                    UUID account =
                            jdbc.queryForObject(
                                    "SELECT id FROM authz_partition WHERE owner_key = ?",
                                    UUID.class,
                                    "account:" + actor);
                    UUID scope =
                            jdbc.queryForObject(
                                    "SELECT id FROM authz_partition WHERE owner_key = ?",
                                    UUID.class,
                                    "workspace:" + workspace);
                    jdbc.update(
                            "UPDATE authz_partition SET state = 'READY' WHERE id IN (?, ?)",
                            account,
                            scope);
                    var operation =
                            new AuthorizationOperation(
                                    UUID.randomUUID(),
                                    actor,
                                    workspace,
                                    "crash-retry",
                                    "a".repeat(64),
                                    new UUID[] {account, scope, grant},
                                    new Long[] {0L, 0L, 1L},
                                    0L);
                    idempotency.executeOnce(operation, () -> fence(grant, 1));
                    jdbc.update(
                            "UPDATE authorization_operation SET state = 'APPLYING',"
                                    + " attempt_count = 1 WHERE id = ?",
                            operation.getId());
                    return new Recovery(actor, grant, operation.getId());
                });

        // The worker has stopped after commit: a new transaction can only return 202.
        assertEquals("PENDING", state(created.grant()));
        assertEquals(
                HttpStatus.ACCEPTED,
                tx(() ->
                        idempotency
                                .responseFor(
                                        idempotency
                                                .findExisting(
                                                        created.actor(),
                                                        "crash-retry",
                                                        "a".repeat(64))
                                                .orElseThrow())
                                .getStatusCode()));

        tx(() -> {
            jdbc.update(
                    "UPDATE authorization_operation SET state = 'RETRYABLE_FAILURE',"
                            + " last_error_code = 'KEYCLOAK_FAILURE', next_attempt_at = now()"
                            + " WHERE id = ?",
                    created.operation());
            return null;
        });
        assertEquals("PENDING", state(created.grant()));

        tx(() -> {
            jdbc.update(
                    "UPDATE authorization_operation SET state = 'APPLYING', attempt_count = 2,"
                            + " next_attempt_at = NULL WHERE id = ?",
                    created.operation());
            jdbc.update(
                    "UPDATE authz_partition SET applied_revision = 1, state = 'READY'"
                            + " WHERE id = ?",
                    created.grant());
            jdbc.update(
                    "UPDATE authorization_operation SET state = 'SUCCEEDED',"
                            + " last_error_code = NULL WHERE id = ?",
                    created.operation());
            return null;
        });

        assertEquals("READY", state(created.grant()));
        assertEquals(
                HttpStatus.OK,
                tx(() ->
                        idempotency
                                .responseFor(
                                        idempotency
                                                .findExisting(
                                                        created.actor(),
                                                        "crash-retry",
                                                        "a".repeat(64))
                                                .orElseThrow())
                                .getStatusCode()));
        assertEquals(
                1,
                jdbc.queryForObject(
                        "SELECT count(*) FROM authorization_operation WHERE initiator_user_id = ?",
                        Integer.class,
                        created.actor()));
    }

    private record Recovery(UUID actor, UUID grant, UUID operation) {}

    private UUID partition() {
        return tx(() -> {
            UUID id = UUID.randomUUID();
            jdbc.update(
                    "INSERT INTO authz_partition(id,kind,owner_key,state)"
                            + " VALUES (?,'GRANT',?,'READY')",
                    id,
                    "grant:" + id);
            return id;
        });
    }

    private String lockedState(UUID partition, String lock) {
        return jdbc.queryForObject(
                "SELECT state FROM authz_partition WHERE id = ? FOR " + lock,
                String.class,
                partition);
    }

    private String state(UUID partition) {
        return jdbc.queryForObject(
                "SELECT state FROM authz_partition WHERE id = ?", String.class, partition);
    }

    private void fence(UUID partition, long revision) {
        jdbc.update(
                "UPDATE authz_partition SET desired_revision = ?, state = 'PENDING' WHERE id = ?",
                revision,
                partition);
    }

    private <T> T tx(java.util.function.Supplier<T> action) {
        return new TransactionTemplate(transactionManager).execute(status -> action.get());
    }

    private static void await(CountDownLatch latch) {
        try {
            assertTrue(latch.await(10, TimeUnit.SECONDS), "Concurrent test timed out");
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(exception);
        }
    }
}
