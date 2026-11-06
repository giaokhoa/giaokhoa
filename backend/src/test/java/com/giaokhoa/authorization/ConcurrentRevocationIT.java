package com.giaokhoa.authorization;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.giaokhoa.authorization.model.AuthorizationOperation;
import com.giaokhoa.authorization.operation.IdempotencyService;
import com.giaokhoa.support.IntegrationEnvironment;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizedClientRepository;
import org.springframework.session.SessionRepository;
import org.springframework.session.web.http.SessionRepositoryFilter;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.context.WebApplicationContext;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** T014: PostgreSQL commit ordering plus opt-in Foundation HTTP contracts. */
@SpringBootTest
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class ConcurrentRevocationIT extends IntegrationEnvironment {
    private static final JsonMapper JSON = new JsonMapper();
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
    @Autowired SessionRepositoryFilter<?> sessionFilter;
    @Autowired OAuth2AuthorizedClientRepository authorizedClients;
    @Autowired ClientRegistrationRepository clientRegistrations;
    @Autowired SessionRepository<?> sessions;

    @Test
    void inFlightWriteFinishesBeforeRevocationCanAcquireExclusiveFence() throws Exception {
        UUID partition = partition();
        CountDownLatch protectedLock = new CountDownLatch(1);
        CountDownLatch releaseWrite = new CountDownLatch(1);
        CountDownLatch revokeStarted = new CountDownLatch(1);
        AtomicInteger writerBackendPid = new AtomicInteger();
        AtomicInteger revokeBackendPid = new AtomicInteger();

        try (var pool = Executors.newFixedThreadPool(2)) {
            var writer =
                    pool.submit(() ->
                            tx(() -> {
                                writerBackendPid.set(backendPid());
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
                                revokeBackendPid.set(backendPid());
                                revokeStarted.countDown();
                                lockedState(partition, "UPDATE");
                                fence(partition, 1);
                                return 1;
                            }));
            assertTrue(revokeStarted.await(10, TimeUnit.SECONDS));
            try {
                assertBlockedBy(revoker, revokeBackendPid.get(), writerBackendPid.get());
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
        CountDownLatch writerAtDatabase = new CountDownLatch(1);
        AtomicInteger revokerBackendPid = new AtomicInteger();
        AtomicInteger writerBackendPid = new AtomicInteger();

        try (var pool = Executors.newFixedThreadPool(2)) {
            var revoker =
                    pool.submit(() ->
                            tx(() -> {
                                revokerBackendPid.set(backendPid());
                                lockedState(partition, "UPDATE");
                                fence(partition, 1);
                                revokedButNotCommitted.countDown();
                                await(commitRevoke);
                                return 1;
                            }));
            assertTrue(revokedButNotCommitted.await(10, TimeUnit.SECONDS));
            var writer =
                    pool.submit(() ->
                            tx(() -> {
                                writerBackendPid.set(backendPid());
                                writerAtDatabase.countDown();
                                return lockedState(partition, "SHARE");
                            }));
            try {
                assertTrue(writerAtDatabase.await(10, TimeUnit.SECONDS));
                assertBlockedBy(writer, writerBackendPid.get(), revokerBackendPid.get());
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
    void realCodePkceActorTokenSurvivesJdbcSessionAcrossNativeRevocation() throws Exception {
        try (var nativeGate = new NativeRevocationFixture();
                var session = nativeSession(nativeGate)) {
            String first = session.currentAccessToken();
            assertFalse(nativeGate.containsGroupClaim(first));
            assertTrue(nativeGate.allowed(first, "a"));
            assertTrue(nativeGate.allowed(first, "b"));

            nativeGate.revoke("a");
            String after = session.currentAccessToken();
            assertTrue(
                    java.util.Arrays.equals(first.toCharArray(), after.toCharArray()),
                    "Spring JDBC session must retain the same user token");
            assertFalse(
                    nativeGate.allowed(after, "a"), "Revoked A must deny without another login");
            assertTrue(nativeGate.allowed(after, "b"), "Independent B must remain allowed");
        }
    }

    private NativeSpringSessionFixture nativeSession(NativeRevocationFixture nativeGate)
            throws Exception {
        return new NativeSpringSessionFixture(
                nativeGate, sessionFilter, authorizedClients, clientRegistrations, sessions);
    }

    private enum PendingScope {
        ACCOUNT,
        WORKSPACE,
        GRANT_PENDING,
        GRANT_FAILED
    }

    @Tag("t014-pending")
    @ParameterizedTest
    @EnumSource(PendingScope.class)
    void protectedCapabilitiesMustRejectCommittedPendingDependency(PendingScope pending)
            throws Exception {
        // RED T018/T021: identical HTTP request before and after a committed fence.
        // A handler that returns 503 to every request must NOT pass this contrast.
        try (var nativeGate = new NativeRevocationFixture();
                var session = nativeSession(nativeGate)) {
            ActorScope fixture = actorWithReadyPersonalWorkspace(nativeGate.userSubject());
            boolean requiresGrant =
                    pending == PendingScope.GRANT_PENDING || pending == PendingScope.GRANT_FAILED;
            GrantScope affectedGrant =
                    requiresGrant ? grantDependency(fixture, nativeGate.resourceId("a")) : null;
            GrantScope independentGrant =
                    requiresGrant ? grantDependency(fixture, nativeGate.resourceId("b")) : null;

            String targetA =
                    affectedGrant == null
                            ? workspaceTarget(fixture.workspace())
                            : versionTarget(affectedGrant);
            String targetB = independentGrant == null ? null : versionTarget(independentGrant);
            String token = session.currentAccessToken();
            assertTrue(nativeGate.allowed(token, "a", requiresGrant ? "content.read" : "enter"));
            if (requiresGrant) {
                assertTrue(nativeGate.allowed(token, "b", "content.read"));
            }

            MockMvc mvc =
                    MockMvcBuilders.webAppContextSetup(webContext)
                            .addFilters(sessionFilter)
                            .apply(springSecurity())
                            .build();
            MockHttpServletResponse readyA = capabilityResponse(mvc, fixture, session, targetA);
            if (affectedGrant != null) {
                UUID grantPartition = affectedGrant.partition();
                tx(() -> {
                    jdbc.update(
                            "UPDATE authz_projection SET state = 'PENDING'"
                                    + " WHERE partition_id = ?",
                            grantPartition);
                    jdbc.update(
                            "UPDATE authz_partition SET desired_revision = 1, state = ?"
                                    + " WHERE id = ?",
                            pending == PendingScope.GRANT_FAILED ? "FAILED" : "PENDING",
                            grantPartition);
                    return null;
                });
                assertEquals("READY", state(fixture.workspacePartition()));
                assertEquals("READY", state(fixture.account()));
                assertEquals("READY", state(independentGrant.partition()));
            } else {
                tx(() -> {
                    fence(fixture.partition(pending), 1);
                    return null;
                });
            }
            MockHttpServletResponse fencedA = capabilityResponse(mvc, fixture, session, targetA);
            MockHttpServletResponse independentB =
                    targetB == null ? null : capabilityResponse(mvc, fixture, session, targetB);
            // Native A still has a grant: only the database fence may deny the request.
            assertTrue(nativeGate.allowed(token, "a", requiresGrant ? "content.read" : "enter"));
            if (independentB != null) {
                assertTrue(nativeGate.allowed(token, "b", "content.read"));
            }
            assertAll(
                    "T014_READY_AND_FENCED_" + pending,
                    () -> assertReadyAllowed(readyA, "A_BEFORE_" + pending),
                    () ->
                            assertEquals(
                                    HttpStatus.SERVICE_UNAVAILABLE.value(),
                                    fencedA.getStatus(),
                                    "T014_FENCED_EXPECT_503_"
                                            + pending
                                            + " actual HTTP="
                                            + fencedA.getStatus()),
                    () -> {
                        if (independentB != null) {
                            assertReadyAllowed(independentB, "INDEPENDENT_B_AFTER_" + pending);
                        }
                    });
        }
    }

    private String workspaceTarget(UUID workspace) {
        return ("{\"type\":\"WORKSPACE\",\"id\":\"%s\",\"scopes\":[\"enter\"]}")
                .formatted(workspace);
    }

    private String versionTarget(GrantScope grant) {
        return ("{\"type\":\"RESOURCE_VERSION\",\"id\":\"%s\","
                        + "\"versionId\":\"%s\",\"scopes\":[\"content.read\"]}")
                .formatted(grant.resource(), grant.version());
    }

    private MockHttpServletResponse capabilityResponse(
            MockMvc mvc, ActorScope actor, NativeSpringSessionFixture session, String target)
            throws Exception {
        return mvc.perform(
                        post("/api/workspaces/{wid}/capabilities", actor.workspace())
                                .cookie(session.cookie())
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"targets\":[" + target + "]}"))
                .andReturn()
                .getResponse();
    }

    private void assertReadyAllowed(MockHttpServletResponse response, String scenario)
            throws Exception {
        assertEquals(200, response.getStatus(), "T014_READY_EXPECT_ALLOW_" + scenario);
        List<JsonNode> decisions =
                JSON.readTree(response.getContentAsString()).findValues("allowed");
        assertEquals(1, decisions.size(), "One exact target/scope must be evaluated");
        assertTrue(
                decisions.getFirst().isBoolean() && decisions.getFirst().booleanValue(),
                "READY must produce a native allow, not a constant HTTP 200/deny");
    }

    @Tag("t014-pending")
    @Test
    void concurrentFixtureMutationMustWaitForDatabaseRevocationFence() throws Exception {
        // RED T018/T021: sample actions must use the same production PEP and lock protocol.
        try (var nativeGate = new NativeRevocationFixture();
                var session = nativeSession(nativeGate)) {
            ActorScope fixture = actorWithReadyPersonalWorkspace(nativeGate.userSubject());
            MockMvc mvc =
                    MockMvcBuilders.webAppContextSetup(webContext)
                            .addFilters(sessionFilter)
                            .apply(springSecurity())
                            .build();
            assertTrue(nativeGate.allowed(session.currentAccessToken(), "a"));
            CountDownLatch revokeLocked = new CountDownLatch(1);
            CountDownLatch finishRevoke = new CountDownLatch(1);
            CountDownLatch writerStarted = new CountDownLatch(1);
            AtomicInteger revokerBackendPid = new AtomicInteger();

            try (var pool = Executors.newFixedThreadPool(2)) {
                var revoker =
                        pool.submit(() ->
                                tx(() -> {
                                    revokerBackendPid.set(backendPid());
                                    lockedState(fixture.workspacePartition(), "UPDATE");
                                    fence(fixture.workspacePartition(), 1);
                                    revokeLocked.countDown();
                                    await(finishRevoke);
                                    return 1;
                                }));
                assertTrue(revokeLocked.await(10, TimeUnit.SECONDS));
                var writer =
                        pool.submit(() -> {
                            writerStarted.countDown();
                            return mvc.perform(
                                            post(
                                                            "/api/workspaces/{wid}/samples/actions",
                                                            fixture.workspace())
                                                    .with(csrf())
                                                    .cookie(session.cookie())
                                                    .header("Idempotency-Key", "t014-concurrent")
                                                    .contentType(MediaType.APPLICATION_JSON)
                                                    .content(
                                                            ("{\"action\":\"CREATE_RESOURCE\","
                                                                            + "\"subjectId\":\"%s\","
                                                                            + "\"kind\":\"QUESTION\","
                                                                            + "\"label\":\"T014 protected\"}")
                                                                    .formatted(UUID.randomUUID())))
                                    .andReturn()
                                    .getResponse()
                                    .getStatus();
                        });
                try {
                    assertTrue(writerStarted.await(10, TimeUnit.SECONDS));
                    boolean blockedOnRevoke = false;
                    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
                    while (System.nanoTime() < deadline && !writer.isDone()) {
                        // Match the exact revoker PostgreSQL backend, not mere HTTP slowness.
                        blockedOnRevoke =
                                Boolean.TRUE.equals(
                                        jdbc.queryForObject(
                                                """
                                                SELECT EXISTS (
                                                  SELECT 1 FROM pg_stat_activity a
                                                  WHERE ? = ANY(pg_blocking_pids(a.pid))
                                                    AND a.wait_event_type = 'Lock'
                                                    AND a.query ILIKE '%authz_partition%'
                                                )
                                                """,
                                                Boolean.class, revokerBackendPid.get()));
                        if (blockedOnRevoke) {
                            break;
                        }
                        Thread.sleep(25);
                    }
                    if (writer.isDone()) {
                        int earlyStatus = writer.get(10, TimeUnit.SECONDS);
                        fail(
                                "T014_EARLY_HTTP_STATUS="
                                        + earlyStatus
                                        + " before PostgreSQL fence: "
                                        + (earlyStatus == 404
                                                ? "T021 sample action route absent"
                                                : "unexpected security/validation/business response"));
                    }
                    assertTrue(
                            blockedOnRevoke,
                            "T014_LOCK_NOT_OBSERVED: writer never waited on revoker PID");
                    assertFalse(writer.isDone(), "No mutation response before the revoke commits");
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

    private record GrantScope(UUID partition, UUID resource, UUID version) {}

    private GrantScope grantDependency(ActorScope fixture, String keycloakResourceId) {
        return tx(() -> {
            UUID grant = UUID.randomUUID();
            UUID resource = UUID.randomUUID();
            UUID version = UUID.randomUUID();
            jdbc.update(
                    "INSERT INTO authz_partition(id,kind,owner_key)" + " VALUES (?,'GRANT',?)",
                    grant,
                    "grant:" + grant);
            jdbc.update(
                    "INSERT INTO authz_projection(id,partition_id,target_key,"
                            + "keycloak_resource_id,dependency_partition_ids,desired_hash,"
                            + "applied_hash,state)"
                            + " VALUES (?,?,?,?,ARRAY[?::uuid],?,?,'READY')",
                    UUID.randomUUID(),
                    grant,
                    "workspace:"
                            + fixture.workspace()
                            + ":resource:"
                            + resource
                            + ":version:"
                            + version,
                    keycloakResourceId,
                    fixture.workspacePartition(),
                    "a".repeat(64),
                    "a".repeat(64));
            jdbc.update("UPDATE authz_partition SET state = 'READY' WHERE id = ?", grant);
            return new GrantScope(grant, resource, version);
        });
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
            UUID account =
                    jdbc.queryForObject(
                            "SELECT id FROM authz_partition WHERE owner_key = ?",
                            UUID.class,
                            "account:" + actor);
            UUID workspacePartition =
                    jdbc.queryForObject(
                            "SELECT id FROM authz_partition WHERE owner_key = ?",
                            UUID.class,
                            "workspace:" + workspace);
            jdbc.update(
                    "UPDATE authz_partition SET state = 'READY' WHERE id IN (?, ?)",
                    account,
                    workspacePartition);
            return new ActorScope(actor, workspace, account, workspacePartition);
        });
    }

    private record ActorScope(UUID actor, UUID workspace, UUID account, UUID workspacePartition) {
        UUID partition(PendingScope scope) {
            return switch (scope) {
                case ACCOUNT -> account;
                case WORKSPACE -> workspacePartition;
                case GRANT_PENDING, GRANT_FAILED ->
                        throw new IllegalArgumentException("GRANT is resolved from projection");
            };
        }
    }

    @Tag("t014-pending")
    @Test
    void productionWorkerMustReconcilePartiallyProvisionedAppGraphAfterRetry() throws Exception {
        // RED T016/T017: real Keycloak resource is already provisioned in the application's
        // TEST API audience; the policy/permission is missing after a simulated worker crash.
        // No test-only graph writer, fake PDP, or fake worker is involved.
        try (var nativeGate = new NativeRevocationFixture();
                var graph = nativeGate.partiallyProvisionApplicationResource()) {
            ActorScope actor = actorWithReadyPersonalWorkspace(nativeGate.userSubject());
            UUID grant = UUID.randomUUID();
            UUID projection = UUID.randomUUID();
            UUID version = UUID.randomUUID();
            var operation =
                    new AuthorizationOperation(
                            UUID.randomUUID(),
                            actor.actor(),
                            actor.workspace(),
                            "t014-partial-provision-retry",
                            "b".repeat(64),
                            new UUID[] {actor.account(), actor.workspacePartition(), grant},
                            new Long[] {0L, 0L, 1L},
                            0L);
            tx(() -> {
                jdbc.update(
                        "INSERT INTO authz_partition"
                                + "(id,kind,owner_key,desired_revision,state)"
                                + " VALUES (?,'GRANT',?,1,'PENDING')",
                        grant,
                        "grant:" + grant);
                jdbc.update(
                        "INSERT INTO authz_projection"
                                + "(id,partition_id,target_key,keycloak_resource_id,"
                                + "dependency_partition_ids,desired_hash,state)"
                                + " VALUES (?,?,?,?,ARRAY[?::uuid,?::uuid],?,'PENDING')",
                        projection,
                        grant,
                        "workspace:"
                                + actor.workspace()
                                + ":resource:"
                                + UUID.randomUUID()
                                + ":version:"
                                + version,
                        graph.resourceId(),
                        actor.account(),
                        actor.workspacePartition(),
                        "b".repeat(64));
                idempotency.executeOnce(operation, () -> {});
                jdbc.update(
                        "UPDATE authorization_operation SET state='RETRYABLE_FAILURE',"
                                + " attempt_count=1,next_attempt_at=now(),"
                                + " last_error_code='PARTIAL_KEYCLOAK_PROVISION'"
                                + " WHERE id=?",
                        operation.getId());
                return null;
            });
            assertEquals(1, graph.resourceCount(), "Partial native resource must exist already");
            long policiesBefore = graph.policyCount();
            assertEquals(0, graph.permissionCount(), "Permission is absent at crash point");
            assertEquals("PENDING", state(grant), "Grant must stay fenced until recovery");
            assertEquals(
                    HttpStatus.ACCEPTED,
                    tx(() ->
                            idempotency
                                    .responseFor(
                                            idempotency
                                                    .findExisting(
                                                            actor.actor(),
                                                            "t014-partial-provision-retry",
                                                            "b".repeat(64))
                                                    .orElseThrow())
                                    .getStatusCode()));
            assertTrue(
                    webContext.containsBean("projectionWorker"),
                    "T014_WORKER_NOT_INSTALLED: T017 must resume an existing partial "
                            + "resource via production PolicyGraphWriter/ProjectionReconciler");

            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15);
            while (System.nanoTime() < deadline) {
                boolean done =
                        "READY".equals(state(grant))
                                && "SUCCEEDED"
                                        .equals(
                                                jdbc.queryForObject(
                                                        "SELECT state FROM authorization_operation"
                                                                + " WHERE id=?",
                                                        String.class,
                                                        operation.getId()));
                if (done) {
                    break;
                }
                Thread.sleep(100);
            }
            assertAll(
                    "T014_REAL_WORKER_PARTIAL_GRAPH_RECOVERY",
                    () -> assertEquals("READY", state(grant), "Grant must be reconciled"),
                    () ->
                            assertEquals(
                                    "SUCCEEDED",
                                    jdbc.queryForObject(
                                            "SELECT state FROM authorization_operation WHERE id=?",
                                            String.class,
                                            operation.getId())),
                    () ->
                            assertEquals(
                                    "b".repeat(64),
                                    jdbc.queryForObject(
                                            "SELECT applied_hash FROM authz_projection WHERE id=?",
                                            String.class,
                                            projection)),
                    () -> assertEquals(1, graph.resourceCount(), "Retry may not clone resource"),
                    () ->
                            assertTrue(
                                    graph.policyCount() > policiesBefore,
                                    "Retry must finish the missing native policy, not only a resource"),
                    () ->
                            assertEquals(
                                    1,
                                    graph.permissionCount(),
                                    "Exactly one scope permission must reference the resource"));
            tx(() -> {
                assertEquals(
                        operation.getId(),
                        idempotency
                                .executeOnce(
                                        operation,
                                        () -> fail("Replay must not create another operation"))
                                .getId());
                return null;
            });
            assertEquals(1, graph.resourceCount());
            assertEquals(1, graph.permissionCount());
        }
    }

    @Test
    void crashAfterNativeRevokeBeforeDatabaseAckCanReplayWithoutDuplicatingGraph()
            throws Exception {
        // A worker implementation is still T017. This tests its network/commit crash window,
        // with native Keycloak, committed PostgreSQL revisions and a second identical revoke.
        try (var nativeGate = new NativeRevocationFixture();
                var session = nativeSession(nativeGate)) {
            ActorScope fixture = actorWithReadyPersonalWorkspace(nativeGate.userSubject());
            String token = session.currentAccessToken();
            assertTrue(nativeGate.allowed(token, "a"));
            assertTrue(nativeGate.allowed(token, "b"));
            var graphBefore = nativeGate.graphInventory();
            var operation =
                    new AuthorizationOperation(
                            UUID.randomUUID(),
                            fixture.actor(),
                            fixture.workspace(),
                            "t014-native-crash-retry",
                            "a".repeat(64),
                            new UUID[] {fixture.account(), fixture.workspacePartition()},
                            new Long[] {0L, 1L},
                            0L);
            tx(() -> {
                idempotency.executeOnce(operation, () -> fence(fixture.workspacePartition(), 1));
                jdbc.update(
                        "UPDATE authorization_operation SET state='APPLYING', attempt_count=1"
                                + " WHERE id=?",
                        operation.getId());
                return null;
            });

            // Native operation commits, then the worker disappears before recording READY.
            nativeGate.revoke("a");
            assertFalse(nativeGate.allowed(token, "a"));
            assertTrue(nativeGate.allowed(token, "b"));
            assertEquals("PENDING", state(fixture.workspacePartition()));
            assertEquals(
                    HttpStatus.ACCEPTED,
                    tx(() ->
                            idempotency
                                    .responseFor(
                                            idempotency
                                                    .findExisting(
                                                            fixture.actor(),
                                                            "t014-native-crash-retry",
                                                            "a".repeat(64))
                                                    .orElseThrow())
                                    .getStatusCode()));

            tx(() -> {
                jdbc.update(
                        "UPDATE authorization_operation SET state='RETRYABLE_FAILURE',"
                                + " last_error_code='KEYCLOAK_ACK_LOST', next_attempt_at=now()"
                                + " WHERE id=?",
                        operation.getId());
                return null;
            });
            nativeGate.revoke("a"); // Replay the same native operation, no new graph objects.
            assertEquals(graphBefore, nativeGate.graphInventory());
            assertFalse(nativeGate.allowed(token, "a"));
            assertTrue(nativeGate.allowed(token, "b"));

            tx(() -> {
                var replay =
                        idempotency.executeOnce(
                                operation, () -> fail("Retry must not reapply desired mutation"));
                assertEquals(operation.getId(), replay.getId());
                jdbc.update(
                        "UPDATE authorization_operation SET state='APPLYING',"
                                + " attempt_count=2, next_attempt_at=NULL, last_error_code=NULL"
                                + " WHERE id=?",
                        operation.getId());
                jdbc.update(
                        "UPDATE authz_partition SET applied_revision=1, state='READY' WHERE id=?",
                        fixture.workspacePartition());
                jdbc.update(
                        "UPDATE authorization_operation SET state='SUCCEEDED' WHERE id=?",
                        operation.getId());
                return null;
            });
            assertEquals(
                    HttpStatus.OK,
                    tx(() ->
                            idempotency
                                    .responseFor(
                                            idempotency
                                                    .findExisting(
                                                            fixture.actor(),
                                                            "t014-native-crash-retry",
                                                            "a".repeat(64))
                                                    .orElseThrow())
                                    .getStatusCode()));
            assertEquals(
                    1,
                    jdbc.queryForObject(
                            "SELECT count(*) FROM authorization_operation WHERE id=?",
                            Integer.class,
                            operation.getId()));
        }
    }

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

    private int backendPid() {
        return java.util.Objects.requireNonNull(
                jdbc.queryForObject("SELECT pg_backend_pid()", Integer.class));
    }

    private void assertBlockedBy(Future<?> waiting, int waiterPid, int blockerPid)
            throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (!waiting.isDone() && System.nanoTime() < deadline) {
            Boolean blocked =
                    jdbc.queryForObject(
                            "SELECT ? = ANY(pg_blocking_pids(?))",
                            Boolean.class,
                            blockerPid,
                            waiterPid);
            if (Boolean.TRUE.equals(blocked)) {
                return;
            }
            Thread.sleep(25);
        }
        fail("PostgreSQL did not report backend " + waiterPid + " blocked by " + blockerPid);
    }

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
