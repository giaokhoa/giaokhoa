package com.giaokhoa.authorization;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import com.giaokhoa.authorization.operation.IdempotencyService;
import com.giaokhoa.support.IntegrationEnvironment;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.core.oidc.OidcIdToken;
import org.springframework.security.oauth2.core.oidc.user.DefaultOidcUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.context.WebApplicationContext;

/**
 * T014 control-plane gates on real PostgreSQL. The protected-request/PDP integration is added in
 * T015-T018; a READY row alone must never be treated as an authorization decision.
 */
@SpringBootTest
@Transactional
class ProjectionFenceGateIT extends IntegrationEnvironment {
    private static final String HASH = "a".repeat(64);

    private enum Scope {
        ACCOUNT,
        WORKSPACE,
        GRANT
    }

    @Autowired JdbcTemplate jdbc;
    @Autowired IdempotencyService idempotency;
    @Autowired WebApplicationContext webContext;

    @ParameterizedTest
    @EnumSource(Scope.class)
    void pendingDependencyCannotCompleteAnOperationEvenIfOtherScopesAreReady(Scope pending) {
        Fixture fixture = fixture();
        ready(fixture.account());
        ready(fixture.workspacePartition());
        ready(fixture.grant());

        UUID operation = operation(fixture, 0);
        UUID changed = fixture.partition(pending);
        jdbc.update(
                "UPDATE authz_partition SET desired_revision = 1, state = 'PENDING' WHERE id = ?",
                changed);
        jdbc.update(
                "UPDATE authorization_operation SET state = 'SUCCEEDED' WHERE id = ?", operation);

        // The DB rejects any false success, including GRANT and ACCOUNT dependencies.
        assertThrows(
                DataAccessException.class, () -> jdbc.execute("SET CONSTRAINTS ALL IMMEDIATE"));
    }

    @Test
    void failureAndRetryKeepOperationIncompleteAndLeaveRevisionFenced() {
        Fixture fixture = fixture();
        ready(fixture.account());
        ready(fixture.grant());
        UUID operation = operation(fixture, 1);
        jdbc.update(
                "UPDATE authz_partition SET desired_revision = 1, state = 'PENDING' WHERE id = ?",
                fixture.workspacePartition());

        jdbc.update(
                "UPDATE authorization_operation SET state = 'APPLYING', attempt_count = 1 WHERE id = ?",
                operation);
        jdbc.update(
                "UPDATE authorization_operation SET state = 'RETRYABLE_FAILURE',"
                        + " last_error_code = 'KEYCLOAK_UNAVAILABLE', next_attempt_at = now()"
                        + " WHERE id = ?",
                operation);
        var failed = idempotency.findExisting(fixture.actor(), "t014-revoke", HASH).orElseThrow();
        assertEquals(HttpStatus.ACCEPTED, idempotency.responseFor(failed).getStatusCode());
        assertFalse(idempotency.responseFor(failed).getBody().completed());
        assertEquals(
                "PENDING",
                jdbc.queryForObject(
                        "SELECT state FROM authz_partition WHERE id = ?",
                        String.class,
                        fixture.workspacePartition()));

        // Retry does not change the idempotency payload or assume Keycloak succeeded.
        jdbc.update(
                "UPDATE authorization_operation SET state = 'APPLYING', attempt_count = 2,"
                        + " next_attempt_at = NULL WHERE id = ?",
                operation);
        assertEquals(
                HASH,
                jdbc.queryForObject(
                        "SELECT payload_hash FROM authorization_operation WHERE id = ?",
                        String.class,
                        operation));
        jdbc.update(
                "UPDATE authorization_operation SET state = 'SUCCEEDED', last_error_code = NULL"
                        + " WHERE id = ?",
                operation);
        assertThrows(
                DataAccessException.class, () -> jdbc.execute("SET CONSTRAINTS ALL IMMEDIATE"));
    }

    @Test
    void sameActorRetainsIndependentWorkspaceWhenOneWorkspaceIsRevoked() {
        Fixture a = fixture();
        UUID workspaceB = centerWorkspace(a.actor());
        UUID partitionB =
                jdbc.queryForObject(
                        "SELECT id FROM authz_partition WHERE owner_key = ?",
                        UUID.class,
                        "workspace:" + workspaceB);
        ready(a.account());
        ready(a.workspacePartition());
        ready(partitionB);

        jdbc.update(
                "UPDATE authz_partition SET desired_revision = 1, state = 'PENDING' WHERE id = ?",
                a.workspacePartition());

        assertEquals(
                "READY",
                jdbc.queryForObject(
                        "SELECT state FROM authz_partition WHERE id = ?",
                        String.class,
                        partitionB));
        assertEquals(
                0L,
                jdbc.queryForObject(
                        "SELECT desired_revision FROM authz_partition WHERE id = ?",
                        Long.class,
                        partitionB));
        assertEquals(
                "READY",
                jdbc.queryForObject(
                        "SELECT state FROM authz_partition WHERE id = ?",
                        String.class,
                        a.account()));
    }

    @ParameterizedTest
    @EnumSource(
            value = Scope.class,
            names = {"ACCOUNT", "WORKSPACE"})
    void protectedHttpReadMustFailClosedOnPendingPartition(Scope pending) throws Exception {
        // RED (T018): real Spring Security request, no substitute PEP or PDP.
        // The declared /classes route is not yet implemented; current HTTP 404 must NOT pass as
        // 503.
        try (var nativeGate = new NativeRevocationFixture()) {
            Fixture fixture = fixture(nativeGate.userSubject());
            ready(fixture.account());
            ready(fixture.workspacePartition());
            jdbc.update(
                    "UPDATE authz_partition SET desired_revision = 1, state = 'PENDING' WHERE id = ?",
                    fixture.partition(pending));

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
            var principal = new DefaultOidcUser(List.of(), idToken, "sub");
            var auth = new OAuth2AuthenticationToken(principal, List.of(), "keycloak");
            int status =
                    mvc.perform(
                                    get("/api/workspaces/{wid}/classes", fixture.workspace())
                                            .with(authentication(auth)))
                            .andReturn()
                            .getResponse()
                            .getStatus();
            assertEquals(503, status, "A PENDING " + pending + " must fence the protected route");
        }
    }

    @Test
    void sameAccessTokenSeesNativeRevokeWithoutLosingIndependentGrant() {
        try (var nativeGate = new NativeRevocationFixture()) {
            String token = nativeGate.userToken();
            assertFalse(nativeGate.containsGroupClaim(token));
            assertTrue(nativeGate.allowed(token, "a"));
            assertTrue(nativeGate.allowed(token, "b"));

            nativeGate.revoke("a");
            assertFalse(
                    nativeGate.allowed(token, "a"), "Revoke must invalidate the old token's allow");
            assertTrue(nativeGate.allowed(token, "b"), "Unrelated source must keep working");
        }
    }

    private Fixture fixture() {
        return fixture("t014-sub-" + UUID.randomUUID());
    }

    private Fixture fixture(String keycloakSub) {
        UUID actor = UUID.randomUUID();
        UUID workspace = UUID.randomUUID();
        UUID grant = UUID.randomUUID();
        jdbc.update(
                "INSERT INTO user_account(id,keycloak_sub,username,email,email_verified,origin,identity_state)"
                        + " VALUES (?,?,?,?,true,'SELF_REGISTERED','ACTIVE')",
                actor,
                keycloakSub,
                "t014-user-" + actor,
                "t014-" + actor + "@example.invalid");
        jdbc.update(
                "INSERT INTO workspace(id,kind,owner_user_id,state) VALUES (?,'PERSONAL',?,'ACTIVE')",
                workspace,
                actor);
        jdbc.update(
                "INSERT INTO authz_partition(id,kind,owner_key) VALUES (?,'GRANT',?)",
                grant,
                "grant:" + grant);
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
        return new Fixture(actor, workspace, account, workspacePartition, grant);
    }

    private UUID centerWorkspace(UUID owner) {
        UUID workspace = UUID.randomUUID();
        UUID center = UUID.randomUUID();
        UUID membership = UUID.randomUUID();
        jdbc.update(
                "INSERT INTO workspace(id,kind,center_id,state) VALUES (?,'CENTER',?,'ACTIVE')",
                workspace,
                center);
        jdbc.update(
                "INSERT INTO center(id,workspace_id,keycloak_organization_id,name,owner_user_id,state)"
                        + " VALUES (?,?,?,'T014 Center',?,'ACTIVE')",
                center,
                workspace,
                "t014-org-" + center,
                owner);
        jdbc.update(
                "INSERT INTO center_membership(id,workspace_id,user_id,state,joined_at)"
                        + " VALUES (?,?,?,'ACTIVE',now())",
                membership,
                workspace,
                owner);
        jdbc.update(
                "INSERT INTO membership_role(membership_id,role) VALUES (?,'OWNER')", membership);
        return workspace;
    }

    private void ready(UUID partition) {
        jdbc.update("UPDATE authz_partition SET state = 'READY' WHERE id = ?", partition);
    }

    private UUID operation(Fixture fixture, long revision) {
        UUID id = UUID.randomUUID();
        jdbc.update(
                "INSERT INTO authorization_operation(id,initiator_user_id,workspace_id,"
                        + "idempotency_key,payload_hash,affected_partitions,affected_revisions,desired_revision)"
                        + " VALUES (?,?,?,'t014-revoke',?,ARRAY[?::uuid,?::uuid,?::uuid],"
                        + " ARRAY[?::bigint,?::bigint,?::bigint],?)",
                id,
                fixture.actor(),
                fixture.workspace(),
                HASH,
                fixture.account(),
                fixture.workspacePartition(),
                fixture.grant(),
                0L,
                revision,
                0L,
                0L);
        return id;
    }

    private record Fixture(
            UUID actor, UUID workspace, UUID account, UUID workspacePartition, UUID grant) {
        UUID partition(Scope scope) {
            return switch (scope) {
                case ACCOUNT -> account;
                case WORKSPACE -> workspacePartition;
                case GRANT -> grant;
            };
        }
    }
}
