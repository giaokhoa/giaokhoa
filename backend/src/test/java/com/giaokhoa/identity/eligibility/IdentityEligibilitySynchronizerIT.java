package com.giaokhoa.identity.eligibility;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import com.giaokhoa.authorization.model.AuthorizationOperation;
import com.giaokhoa.shared.http.HttpProblemException;
import com.giaokhoa.support.IntegrationEnvironment;
import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

/**
 * Gate eligibility trên stack TEST thật: synchronizer đọc profile hiện hành từ Keycloak 26.8.1, ghi
 * thay đổi lên ACCOUNT partition của PostgreSQL, và worker production chiếu membership {@code
 * /gk/identity/eligible} trước khi operation thành công. Các điều kiện tiên quyết của realm mà
 * bootstrap production sở hữu (đường group eligibility, client audience của authorization) được
 * seed tại đây như fixture revocation vẫn seed, và chỉ phần class này tự tạo mới bị dọn sau test.
 */
@SpringBootTest
@Transactional(propagation = Propagation.NOT_SUPPORTED)
@DirtiesContext
class IdentityEligibilitySynchronizerIT extends IntegrationEnvironment {
    private static final String SCHEMA =
            "eligibility_sync_" + UUID.randomUUID().toString().replace("-", "");
    private static final String ELIGIBLE_GROUP = "/gk/identity/eligible";
    private static final ParameterizedTypeReference<Map<String, Object>> MAP =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<List<Map<String, Object>>> LIST =
            new ParameterizedTypeReference<>() {};

    private static final RestClient HTTP = RestClient.create();
    private static final String BASE = required("TEST_KEYCLOAK_BASE_URL").replaceAll("/+$", "");
    private static final String REALM = required("TEST_KEYCLOAK_REALM");
    private static final String STATE_SUCCEEDED = "SUCCEEDED";
    private static final String STATE_FAILED = "FAILED";
    private static final String DEFAULT_PERMISSION = "Default Permission";
    private static final String DEFAULT_RESOURCE = "Default Resource";
    private static final String DEFAULT_POLICY = "Default Policy";

    @DynamicPropertySource
    static void isolatedSchema(DynamicPropertyRegistry registry) {
        registry.add("spring.flyway.schemas", () -> SCHEMA);
        registry.add("spring.flyway.default-schema", () -> SCHEMA);
        registry.add(
                "spring.datasource.hikari.connection-init-sql",
                () -> "SET search_path TO " + SCHEMA + ",public");
    }

    @BeforeAll
    static void seedRealmPrerequisites() {
        seedEligibilityGroup();
        ensureApiClient();
    }

    @AfterAll
    static void removeSchema(@Autowired ApplicationContext context) {
        // Class này chờ operation do worker thật xử lý (awaitSucceeded) nên không mock được như
        // BootstrapProfileIT; teardown đóng context trước để không còn actor đồng thời nào chạm
        // schema khi DROP.
        closeContextAndDropSchema(context, SCHEMA);
    }

    @Autowired JdbcTemplate jdbc;
    @Autowired IdentityEligibilitySynchronizer synchronizer;
    @Autowired PlatformTransactionManager transactionManager;

    @Test
    void selfRegisteredEligibilityFollowsTheCurrentProfileBothWays() {
        String subject = createUser("sync-self-" + UUID.randomUUID(), "self@example.test", true);
        try {
            UUID actor = account(subject, "SELF_REGISTERED", null, false, "self@example.test");

            Optional<AuthorizationOperation> granted = synchronizer.synchronizeEligibility(actor);
            assertTrue(granted.isPresent(), "A newly verified profile must record a change");
            awaitSucceeded(granted.get().getId());
            assertTrue(
                    groupPathsOf(subject).contains(ELIGIBLE_GROUP),
                    "Eligible actor must be projected into the eligibility group");
            assertEquals(
                    Boolean.TRUE,
                    jdbc.queryForObject(
                            "SELECT email_verified FROM user_account WHERE id = ?",
                            Boolean.class,
                            actor));
            assertEquals(
                    "READY",
                    jdbc.queryForObject(
                            "SELECT state FROM authz_partition WHERE owner_key = ?",
                            String.class,
                            "account:" + actor));

            setEmailVerified(subject, false);
            Optional<AuthorizationOperation> revoked = synchronizer.synchronizeEligibility(actor);
            assertTrue(revoked.isPresent(), "Losing verification must record a change");
            awaitSucceeded(revoked.get().getId());
            assertFalse(
                    groupPathsOf(subject).contains(ELIGIBLE_GROUP),
                    "Unverified actor must lose the eligibility membership");
        } finally {
            deleteUser(subject);
        }
    }

    @Test
    void centerIssuedAccountIsEligibleWithoutAnyVerifiedEmail() {
        String subject = createUser("sync-issued-" + UUID.randomUUID(), null, false);
        try {
            UUID actor = account(subject, "CENTER_ISSUED", subject, false, null);

            Optional<AuthorizationOperation> granted = synchronizer.synchronizeEligibility(actor);

            assertTrue(granted.isPresent());
            awaitSucceeded(granted.get().getId());
            assertTrue(groupPathsOf(subject).contains(ELIGIBLE_GROUP));
        } finally {
            deleteUser(subject);
        }
    }

    @Test
    void anIdentityThatCannotBeReadFailsClosedAndRecordsNothing() {
        String missingSubject = UUID.randomUUID().toString();
        UUID actor = account(missingSubject, "SELF_REGISTERED", null, false, "ghost@example.test");

        HttpProblemException failure =
                assertThrows(
                        HttpProblemException.class,
                        () -> synchronizer.synchronizeEligibility(actor));

        assertEquals(503, failure.getStatus().value());
        assertEquals("IDENTITY_UNAVAILABLE", failure.getCode());
        assertEquals(
                0,
                jdbc.queryForObject(
                        "SELECT count(*) FROM authorization_operation WHERE initiator_user_id = ?",
                        Integer.class,
                        actor));
    }

    private UUID account(
            String keycloakSub,
            String origin,
            @Nullable String usernameSeed,
            boolean verified,
            @Nullable String email) {
        UUID actor = UUID.randomUUID();
        UUID workspace = UUID.randomUUID();
        String username = "eligibility-" + (usernameSeed == null ? actor : usernameSeed);
        new TransactionTemplate(transactionManager)
                .executeWithoutResult(_ -> {
                    jdbc.update(
                            "INSERT INTO user_account"
                                    + " (id, keycloak_sub, username, email, email_verified,"
                                    + " origin, identity_state)"
                                    + " VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')",
                            actor,
                            keycloakSub,
                            username,
                            email,
                            verified,
                            origin);
                    jdbc.update(
                            "INSERT INTO workspace (id, kind, owner_user_id, state)"
                                    + " VALUES (?, 'PERSONAL', ?, 'ACTIVE')",
                            workspace,
                            actor);
                });
        return actor;
    }

    private void awaitSucceeded(UUID operationId) {
        Instant deadline = Instant.now().plus(Duration.ofSeconds(90));
        while (Instant.now().isBefore(deadline)) {
            Map<String, Object> row =
                    jdbc.queryForMap(
                            "SELECT state, last_error_code FROM authorization_operation"
                                    + " WHERE id = ?",
                            operationId);
            if (STATE_SUCCEEDED.equals(row.get("state"))) {
                return;
            }
            if (STATE_FAILED.equals(row.get("state"))) {
                fail("Operation failed with " + row.get("last_error_code"));
            }
            try {
                Thread.sleep(500);
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
                fail("Interrupted while waiting for the operation");
            }
        }
        fail("Operation did not succeed in time: " + operationId);
    }

    private String createUser(String username, @Nullable String email, boolean emailVerified) {
        var body = new java.util.HashMap<String, Object>();
        body.put("username", username);
        body.put("enabled", true);
        body.put("emailVerified", emailVerified);
        body.put("requiredActions", List.of());
        if (email != null) {
            body.put("email", email);
        }
        var response =
                HTTP.post()
                        .uri(admin("/users"))
                        .headers(headers -> headers.setBearerAuth(masterToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .body(body)
                        .retrieve()
                        .toEntity(String.class);
        URI location = response.getHeaders().getLocation();
        if (location == null) {
            throw new IllegalStateException("Keycloak did not return the created user location");
        }
        String path = location.getPath();
        return path.substring(path.lastIndexOf('/') + 1);
    }

    private void setEmailVerified(String userId, boolean verified) {
        Map<String, Object> user =
                HTTP.get()
                        .uri(admin("/users/" + userId))
                        .headers(headers -> headers.setBearerAuth(masterToken()))
                        .retrieve()
                        .body(MAP);
        if (user == null) {
            throw new IllegalStateException("Keycloak user not readable: " + userId);
        }
        user.put("emailVerified", verified);
        HTTP.put()
                .uri(admin("/users/" + userId))
                .headers(headers -> headers.setBearerAuth(masterToken()))
                .contentType(MediaType.APPLICATION_JSON)
                .body(user)
                .retrieve()
                .toBodilessEntity();
    }

    private List<String> groupPathsOf(String userId) {
        List<Map<String, Object>> groups =
                HTTP.get()
                        .uri(admin("/users/" + userId + "/groups"))
                        .headers(headers -> headers.setBearerAuth(masterToken()))
                        .retrieve()
                        .body(LIST);
        if (groups == null) {
            throw new IllegalStateException("Keycloak groups not readable: " + userId);
        }
        return groups.stream().map(group -> String.valueOf(group.get("path"))).toList();
    }

    private void deleteUser(String userId) {
        delete(admin("/users/" + userId));
    }

    private String admin(String path) {
        return adminStatic(path);
    }

    private static String adminStatic(String path) {
        return BASE + "/admin/realms/" + REALM + path;
    }

    private static void seedEligibilityGroup() {
        String parentId = null;
        StringBuilder path = new StringBuilder();
        for (String segment : List.of("gk", "identity", "eligible")) {
            path.append('/').append(segment);
            String currentPath = path.toString();
            String found = null;
            try {
                Map<String, Object> group =
                        HTTP.get()
                                .uri(adminStatic("/group-by-path" + currentPath))
                                .headers(headers -> headers.setBearerAuth(masterToken()))
                                .retrieve()
                                .body(MAP);
                if (group != null && currentPath.equals(group.get("path"))) {
                    found = String.valueOf(group.get("id"));
                }
            } catch (RestClientResponseException ex) {
                if (!ex.getStatusCode().isSameCodeAs(HttpStatus.NOT_FOUND)) {
                    throw ex;
                }
            }
            if (found == null) {
                String endpoint =
                        parentId == null ? "/groups" : "/groups/" + parentId + "/children";
                // Cây /gk/identity/eligible là object nền của realm: chỉ tạo khi thiếu,
                // không bao giờ xóa ở teardown — nhiều class dùng chung đường dẫn cố định này.
                found = createResource(adminStatic(endpoint), Map.of("name", segment));
            }
            parentId = found;
        }
    }

    private static void ensureApiClient() {
        String audience = required("TEST_KEYCLOAK_AUTHZ_AUDIENCE");
        List<Map<String, Object>> matches =
                HTTP.get()
                        .uri(adminStatic("/clients?clientId=" + audience))
                        .headers(headers -> headers.setBearerAuth(masterToken()))
                        .retrieve()
                        .body(LIST);
        if (matches != null && !matches.isEmpty()) {
            return;
        }
        String clientId =
                createResource(
                        adminStatic("/clients"),
                        Map.of(
                                "clientId", audience,
                                "protocol", "openid-connect",
                                "enabled", true,
                                "publicClient", false,
                                "standardFlowEnabled", false,
                                "directAccessGrantsEnabled", false,
                                "authorizationServicesEnabled", true,
                                "serviceAccountsEnabled", true,
                                "fullScopeAllowed", false,
                                "authorizationSettings",
                                        Map.of(
                                                "policyEnforcementMode", "ENFORCING",
                                                "allowRemoteResourceManagement", true,
                                                "decisionStrategy", "UNANIMOUS")));
        // Client này là object nền của realm (cùng vai trò bootstrap.sh ở production): chỉ
        // tạo khi thiếu và gỡ default do Keycloak tự sinh đúng như bootstrap, không bao giờ
        // xóa ở teardown — nhiều class dùng chung client theo clientId cố định này.
        removeClientDefaults(clientId);
    }

    private static void removeClientDefaults(String clientId) {
        String root = "/clients/" + clientId + "/authz/resource-server";
        for (Map<String, Object> permission : getList(adminStatic(root + "/permission/resource"))) {
            if (DEFAULT_PERMISSION.equals(permission.get("name"))) {
                delete(adminStatic(root + "/permission/resource/" + permission.get("id")));
            }
        }
        for (Map<String, Object> resource : getList(adminStatic(root + "/resource"))) {
            if (DEFAULT_RESOURCE.equals(resource.get("name"))) {
                delete(adminStatic(root + "/resource/" + resource.get("_id")));
            }
        }
        for (Map<String, Object> policy : getList(adminStatic(root + "/policy"))) {
            if (DEFAULT_POLICY.equals(policy.get("name"))) {
                delete(adminStatic(root + "/policy/" + policy.get("id")));
            }
        }
    }

    private static List<Map<String, Object>> getList(String uri) {
        List<Map<String, Object>> result =
                HTTP.get()
                        .uri(uri)
                        .headers(headers -> headers.setBearerAuth(masterToken()))
                        .retrieve()
                        .body(LIST);
        if (result == null) {
            throw new IllegalStateException("Keycloak list not readable: " + uri);
        }
        return result;
    }

    private static String createResource(String uri, Map<String, ?> body) {
        var response =
                HTTP.post()
                        .uri(uri)
                        .headers(headers -> headers.setBearerAuth(masterToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .body(body)
                        .retrieve()
                        .toEntity(String.class);
        URI location = response.getHeaders().getLocation();
        if (location == null) {
            throw new IllegalStateException("Keycloak did not return a location for " + uri);
        }
        String path = location.getPath();
        return path.substring(path.lastIndexOf('/') + 1);
    }

    private static void delete(String uri) {
        HTTP.delete()
                .uri(uri)
                .headers(headers -> headers.setBearerAuth(masterToken()))
                .retrieve()
                .toBodilessEntity();
    }

    private static String masterToken() {
        var form = new LinkedMultiValueMap<String, String>();
        form.add("grant_type", "password");
        form.add("client_id", "admin-cli");
        form.add("username", required("TEST_KEYCLOAK_MASTER_USERNAME"));
        form.add("password", required("TEST_KEYCLOAK_MASTER_PASSWORD"));
        Map<String, Object> response =
                HTTP.post()
                        .uri(BASE + "/realms/master/protocol/openid-connect/token")
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .body(form)
                        .retrieve()
                        .body(MAP);
        if (response == null) {
            throw new IllegalStateException("Master token not readable");
        }
        return Objects.requireNonNull((String) response.get("access_token"), "access_token");
    }

    private static String required(String key) {
        String value = System.getenv(key);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("Missing TEST fixture variable " + key);
        }
        return value;
    }
}
