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

/** Revocation contract: PostgreSQL commit ordering plus opt-in Foundation HTTP contracts. */
@SpringBootTest
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class ConcurrentRevocationIT extends IntegrationEnvironment {
    private static final JsonMapper JSON = new JsonMapper();
    private static final String SCHEMA =
            "revocation_concurrent_" + UUID.randomUUID().toString().replace("-", "");

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

    @Test
    void nativeApiFixtureCleanupPreservesIndependentResourceServerGrants() {
        // First graph owns the isolated TEST API client; second shares only its resource server.
        try (var nativeGate = new NativeRevocationFixture();
                var first =
                        nativeGate.partiallyProvisionApplicationResource(
                                "workspace:" + UUID.randomUUID(), "enter")) {
            first.authorizeOwner();
            String token = nativeGate.userToken();
            assertTrue(first.allowed(token, first.resourceId()));
            long originalPolicies = first.policyCount();
            try (var second =
                    nativeGate.partiallyProvisionApplicationResource(
                            "workspace:" + UUID.randomUUID(), "enter")) {
                second.authorizeOwner();
                assertTrue(second.allowed(token, second.resourceId()));
                assertTrue(first.allowed(token, first.resourceId()));
                assertEquals(1, second.resourceCount());
            }
            assertTrue(first.allowed(token, first.resourceId()));
            assertEquals(
                    originalPolicies, first.policyCount(), "No extra policy after second cleanup");
            assertEquals(
                    1, first.resourceCount(), "The shared client owner still has its resource");
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

    @Tag("pending-contract")
    @ParameterizedTest
    @EnumSource(PendingScope.class)
    void protectedCapabilitiesMustRejectCommittedPendingDependency(PendingScope pending)
            throws Exception {
        // RED: request-fence and sample-action contracts require identical authenticated HTTP
        // request before and after committed fence.
        try (var nativeGate = new NativeRevocationFixture();
                var session = nativeSession(nativeGate)) {
            ActorScope fixture = actorWithReadyPersonalWorkspace(nativeGate.userSubject());
            boolean requiresGrant =
                    pending == PendingScope.GRANT_PENDING || pending == PendingScope.GRANT_FAILED;
            UUID resourceA = UUID.randomUUID();
            UUID versionA = UUID.randomUUID();
            UUID resourceB = UUID.randomUUID();
            UUID versionB = UUID.randomUUID();
            String keyA =
                    requiresGrant
                            ? versionTargetKey(fixture.workspace(), resourceA, versionA)
                            : "workspace:" + fixture.workspace();
            String keyB = versionTargetKey(fixture.workspace(), resourceB, versionB);
            try (var apiGraph =
                    nativeGate.partiallyProvisionApplicationResource(
                            keyA, requiresGrant ? "content.read" : "enter")) {
                apiGraph.authorizeOwner(); // Native Keycloak user policy on the TEST API audience.
                String keycloakResourceB =
                        requiresGrant ? apiGraph.addAuthorizedResource(keyB) : null;
                GrantScope affectedGrant =
                        requiresGrant
                                ? grantDependency(
                                        fixture, resourceA, versionA, apiGraph.resourceId())
                                : null;
                GrantScope independentGrant =
                        requiresGrant
                                ? grantDependency(fixture, resourceB, versionB, keycloakResourceB)
                                : null;
                String targetA =
                        affectedGrant == null
                                ? workspaceTarget(fixture.workspace())
                                : versionTarget(affectedGrant);
                String targetB = independentGrant == null ? null : versionTarget(independentGrant);
                String token = session.currentAccessToken();
                assertTrue(
                        apiGraph.allowed(token, apiGraph.resourceId()),
                        "Native READY A must allow via TEST API audience");
                if (requiresGrant) {
                    assertTrue(
                            apiGraph.allowed(token, keycloakResourceB),
                            "Native independent READY B must allow via TEST API audience");
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
                MockHttpServletResponse fencedA =
                        capabilityResponse(mvc, fixture, session, targetA);
                MockHttpServletResponse independentB =
                        targetB == null ? null : capabilityResponse(mvc, fixture, session, targetB);
                assertTrue(
                        apiGraph.allowed(token, apiGraph.resourceId()),
                        "Native A remains allowed; the DB fence must deny.");
                if (independentB != null) {
                    assertTrue(apiGraph.allowed(token, keycloakResourceB));
                }
                assertAll(
                        "REVOCATION_CONTRACT_READY_AND_FENCED_" + pending,
                        () -> assertReadyAllowed(readyA, "A_BEFORE_" + pending),
                        () ->
                                assertEquals(
                                        HttpStatus.SERVICE_UNAVAILABLE.value(),
                                        fencedA.getStatus(),
                                        "REVOCATION_CONTRACT_FENCED_EXPECT_503_"
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
        assertEquals(
                200, response.getStatus(), "REVOCATION_CONTRACT_READY_EXPECT_ALLOW_" + scenario);
        List<JsonNode> decisions =
                JSON.readTree(response.getContentAsString()).findValues("allowed");
        assertEquals(1, decisions.size(), "One exact target/scope must be evaluated");
        assertTrue(
                decisions.getFirst().isBoolean() && decisions.getFirst().booleanValue(),
                "READY must produce a native allow, not a constant HTTP 200/deny");
    }

    @Tag("pending-contract")
    @Test
    void concurrentFixtureMutationMustWaitForDatabaseRevocationFence() throws Exception {
        // RED: sample actions must use the same production PEP and lock protocol.
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
                                                    .header(
                                                            "Idempotency-Key",
                                                            "revocation-concurrent")
                                                    .contentType(MediaType.APPLICATION_JSON)
                                                    .content(
                                                            ("{\"action\":\"CREATE_RESOURCE\","
                                                                            + "\"subjectId\":\"%s\","
                                                                            + "\"kind\":\"QUESTION\","
                                                                            + "\"label\":\"Revocation contract protected\"}")
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
                                "REVOCATION_CONTRACT_EARLY_HTTP_STATUS="
                                        + earlyStatus
                                        + " before PostgreSQL fence: "
                                        + (earlyStatus == 404
                                                ? "sample action route absent"
                                                : "unexpected security/validation/business response"));
                    }
                    assertTrue(
                            blockedOnRevoke,
                            "REVOCATION_CONTRACT_LOCK_NOT_OBSERVED: writer never waited on revoker PID");
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

    private String versionTargetKey(UUID workspace, UUID resource, UUID version) {
        return "workspace:" + workspace + ":resource:" + resource + ":version:" + version;
    }

    private GrantScope grantDependency(
            ActorScope fixture, UUID resource, UUID version, String keycloakResourceId) {
        return tx(() -> {
            UUID grant = UUID.randomUUID();
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
                    versionTargetKey(fixture.workspace(), resource, version),
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
                    "revocation-actor-" + actor,
                    "revocation-" + actor + "@example.invalid");
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

    @Tag("pending-contract")
    @Test
    void productionWorkerMustReconcilePartiallyProvisionedAppGraphAfterRetry() throws Exception {
        // RED: graph writer and reconciliation worker are not implemented; the source is an actual
        // PERSONAL owner in V001, not a fabricated
        // share_grant (which has no production schema before the later user-story tasks).
        try (var nativeGate = new NativeRevocationFixture()) {
            ActorScope actor = actorWithReadyPersonalWorkspace(nativeGate.userSubject());
            String targetKey = "workspace:" + actor.workspace();
            String scope = "enter";
            // The writer can reconstruct this owner-source graph intent from durable V001 rows.
            String canonicalSource =
                    jdbc.queryForObject(
                            """
                            SELECT concat('PERSONAL_OWNER|workspace=',w.id,
                                '|user=',u.id,'|subject=',u.keycloak_sub,
                                '|target=workspace:',w.id,'|scope=enter')
                            FROM workspace w JOIN user_account u ON u.id=w.owner_user_id
                            WHERE w.id=? AND w.kind='PERSONAL'
                                AND u.email_verified AND u.identity_state='ACTIVE'
                            """,
                            String.class,
                            actor.workspace());
            assertNotNull(canonicalSource, "Expected an eligible durable personal owner source");
            String desiredHash = hashOf(canonicalSource);
            try (var graph = nativeGate.partiallyProvisionApplicationResource(targetKey, scope)) {
                UUID projection = UUID.randomUUID();
                var operation =
                        new AuthorizationOperation(
                                UUID.randomUUID(),
                                actor.actor(),
                                actor.workspace(),
                                "revocation-partial-provision-retry",
                                desiredHash,
                                new UUID[] {actor.account(), actor.workspacePartition()},
                                new Long[] {0L, 1L},
                                0L);
                tx(() -> {
                    // This is a real source the graph writer can reconstruct: native user
                    // policy for workspace.owner_user_id, evaluated for targetKey#enter.
                    assertEquals(
                            actor.actor(),
                            jdbc.queryForObject(
                                    "SELECT owner_user_id FROM workspace WHERE id=?",
                                    UUID.class,
                                    actor.workspace()));
                    assertEquals(
                            nativeGate.userSubject(),
                            jdbc.queryForObject(
                                    "SELECT keycloak_sub FROM user_account WHERE id=?",
                                    String.class,
                                    actor.actor()));
                    fence(actor.workspacePartition(), 1);
                    jdbc.update(
                            "INSERT INTO authz_projection"
                                    + "(id,partition_id,target_key,keycloak_resource_id,"
                                    + "dependency_partition_ids,desired_hash,state)"
                                    + " VALUES (?,?,?,?,ARRAY[?::uuid],?,'PENDING')",
                            projection,
                            actor.workspacePartition(),
                            targetKey,
                            graph.resourceId(),
                            actor.account(),
                            desiredHash);
                    idempotency.executeOnce(operation, () -> {});
                    jdbc.update(
                            "UPDATE authorization_operation SET state='RETRYABLE_FAILURE',"
                                    + " attempt_count=1,next_attempt_at=now(),"
                                    + " last_error_code='PARTIAL_KEYCLOAK_PROVISION'"
                                    + " WHERE id=?",
                            operation.getId());
                    return null;
                });
                graph.cleanupProjectedPolicies(() -> projectionPolicies(projection));
                assertEquals(1, graph.resourceCount(), "Native workspace resource exists already");
                long policiesBefore = graph.policyCount();
                assertEquals(0, graph.permissionCount(), "Permission absent at crash point");
                assertFalse(
                        graph.allowed(
                                nativeGate.webTokensViaCodePkce().accessToken(),
                                graph.resourceId()),
                        "Partial TEST API graph must be native PDP-denied until worker reconciles");
                assertEquals(
                        "PENDING",
                        state(actor.workspacePartition()),
                        "Workspace stays fenced until native reconciliation");
                assertEquals(
                        HttpStatus.ACCEPTED,
                        tx(() ->
                                idempotency
                                        .responseFor(
                                                idempotency
                                                        .findExisting(
                                                                actor.actor(),
                                                                "revocation-partial-provision-retry",
                                                                desiredHash)
                                                        .orElseThrow())
                                        .getStatusCode()));
                assertTrue(
                        webContext.containsBean("projectionWorker"),
                        "REVOCATION_CONTRACT_WORKER_NOT_INSTALLED: the reconciliation worker must resume owner source through"
                                + " production PolicyGraphWriter/ProjectionReconciler");
                long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15);
                while (System.nanoTime() < deadline) {
                    boolean done =
                            "READY".equals(state(actor.workspacePartition()))
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
                        "REVOCATION_CONTRACT_REAL_WORKER_PARTIAL_GRAPH_RECOVERY",
                        () ->
                                assertEquals(
                                        "READY",
                                        state(actor.workspacePartition()),
                                        "Rebuilt owner workspace must be READY"),
                        () ->
                                assertEquals(
                                        "SUCCEEDED",
                                        jdbc.queryForObject(
                                                "SELECT state FROM authorization_operation WHERE id=?",
                                                String.class,
                                                operation.getId())),
                        () ->
                                assertEquals(
                                        desiredHash,
                                        jdbc.queryForObject(
                                                "SELECT applied_hash FROM authz_projection WHERE id=?",
                                                String.class,
                                                projection)),
                        () ->
                                assertFalse(
                                        projectionPolicies(projection).isEmpty(),
                                        "Writer must record exact native policy names for future cleanup"),
                        () ->
                                assertEquals(
                                        1, graph.resourceCount(), "Retry may not clone resource"),
                        () ->
                                assertTrue(
                                        graph.policyCount() > policiesBefore,
                                        "Retry must install the missing native owner policy"),
                        () ->
                                assertEquals(
                                        1,
                                        graph.permissionCount(),
                                        "Exactly one scope permission must reference this resource"),
                        () ->
                                assertTrue(
                                        graph.allowed(
                                                nativeGate.webTokensViaCodePkce().accessToken(),
                                                graph.resourceId()),
                                        "Owner policy must be granted by TEST API audience PDP"));
                tx(() -> {
                    assertEquals(
                            operation.getId(),
                            idempotency
                                    .executeOnce(
                                            operation,
                                            () -> fail("Retry must not create another operation"))
                                    .getId());
                    return null;
                });
                assertEquals(1, graph.resourceCount());
                assertEquals(1, graph.permissionCount());
            }
        }
    }

    private List<String> projectionPolicies(UUID projection) {
        String[] names =
                jdbc.queryForObject(
                        "SELECT policy_names FROM authz_projection WHERE id=?",
                        (rs, rowNum) -> (String[]) rs.getArray(1).getArray(),
                        projection);
        return java.util.Arrays.asList(java.util.Objects.requireNonNull(names));
    }

    private String hashOf(String source) throws Exception {
        byte[] digest =
                java.security.MessageDigest.getInstance("SHA-256")
                        .digest(source.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        return java.util.HexFormat.of().formatHex(digest);
    }

    @Test
    void crashAfterNativeRevokeBeforeDatabaseAckCanReplayWithoutDuplicatingGraph()
            throws Exception {
        // The reconciliation worker is not implemented yet. This tests the network/commit crash
        // window,
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
                            "revocation-native-crash-retry",
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
                                                            "revocation-native-crash-retry",
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
                                                            "revocation-native-crash-retry",
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
                            "revocation-sub-" + actor,
                            "revocation-user-" + actor);
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
