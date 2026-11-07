package com.giaokhoa.identity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.giaokhoa.support.IntegrationEnvironment;
import jakarta.servlet.http.Cookie;
import java.net.URI;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
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
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.context.WebApplicationContext;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Contract US1 ở tầng khôi phục danh tính: account không email chỉ được khôi phục bằng quyền hành
 * trên server của nền tảng (operator), người thường không đặt lại được mật khẩu của người khác;
 * account có email đã xác minh nhận action email đặt lại mật khẩu; endpoint recovery của hợp đồng
 * HTTP xác thực vai trò và đăng nhập trước khi chạm nghiệp vụ.
 */
@SpringBootTest
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class RecoveryFlowIT extends IntegrationEnvironment {
    private static final JsonMapper JSON = new JsonMapper();
    private static final String SCHEMA =
            "recovery_flow_" + UUID.randomUUID().toString().replace("-", "");
    private static final String DIRECT_CLIENT = "recovery-flow-direct";
    private static final String WEB_CLIENT = "giaokhoa-it-web";
    private static final ParameterizedTypeReference<Map<String, Object>> MAP =
            new ParameterizedTypeReference<>() {};

    private static final RestClient HTTP = RestClient.create();
    private static final String BASE =
            IdentityFlowIT.fixture("TEST_KEYCLOAK_BASE_URL").replaceAll("/+$", "");
    private static final String REALM = IdentityFlowIT.fixture("TEST_KEYCLOAK_REALM");
    private static @Nullable String ownedDirectClientId;

    @DynamicPropertySource
    static void isolatedSchema(DynamicPropertyRegistry registry) {
        registry.add("spring.flyway.schemas", () -> SCHEMA);
        registry.add("spring.flyway.default-schema", () -> SCHEMA);
        registry.add(
                "spring.datasource.hikari.connection-init-sql",
                () -> "SET search_path TO " + SCHEMA + ",public");
    }

    @AfterAll
    static void removeFixtures() {
        if (ownedDirectClientId != null) {
            try {
                deleteStatic(adminStatic("/clients/" + ownedDirectClientId));
            } catch (RestClientResponseException ex) {
                if (!ex.getStatusCode().isSameCodeAs(HttpStatus.NOT_FOUND)) {
                    throw ex;
                }
            }
        }
    }

    @AfterAll
    static void removeSchema(@Autowired JdbcTemplate jdbc) {
        jdbc.execute("DROP SCHEMA IF EXISTS " + SCHEMA + " CASCADE");
    }

    @Autowired JdbcTemplate jdbc;
    @Autowired PlatformTransactionManager transactionManager;
    @Autowired RecoveryService recoveryService;
    @Autowired WebApplicationContext webContext;
    @Autowired SessionRepositoryFilter<?> sessionFilter;
    @Autowired OAuth2AuthorizedClientRepository authorizedClients;
    @Autowired ClientRegistrationRepository clientRegistrations;
    @Autowired SessionRepository<?> sessions;

    @Test
    void operatorCredentialResetsIssuedUsersPasswordWithoutChangingIdentity() {
        String subject =
                createUser(issuedUser("recovery-issued", "recovery-temp-" + UUID.randomUUID()));

        try {
            String newPassword = "recovery-new-" + UUID.randomUUID();
            int status = adminResetPassword(subject, newPassword);

            assertEquals(204, status, "Operator đặt lại được mật khẩu của account không email");
            Map<String, Object> after = getUser(subject);
            assertEquals(subject, after.get("id"), "subject của danh tính không đổi");
            assertNull(after.get("email"), "Mật khẩu mới không ép account phải có email");
            Object actions = after.get("requiredActions");
            assertFalse(
                    actions instanceof List<?> list && list.contains("UPDATE_PASSWORD"),
                    "Operator đặt mật khẩu permanent thì không còn required action đổi mật khẩu");
        } finally {
            deleteUser(subject);
        }
    }

    @Test
    void ordinaryUserCredentialCannotResetAnotherUsersPassword() {
        String actorSubject = null;
        String targetSubject = null;
        ensureDirectGrantClient();
        try {
            String actorPassword = "recovery-actor-" + UUID.randomUUID();
            actorSubject =
                    createUser(
                            keycloakUser(
                                    "recovery-actor",
                                    "recovery-actor@example.test",
                                    true,
                                    actorPassword));
            targetSubject =
                    createUser(issuedUser("recovery-target", "recovery-temp-" + UUID.randomUUID()));

            String actorToken = directGrantToken("recovery-actor", actorPassword);
            int status;
            try {
                HTTP.put()
                        .uri(admin("/users/" + targetSubject + "/reset-password"))
                        .headers(headers -> headers.setBearerAuth(actorToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .body(
                                Map.of(
                                        "type",
                                        "password",
                                        "value",
                                        "recovery-stolen-" + UUID.randomUUID(),
                                        "temporary",
                                        false))
                        .retrieve()
                        .toBodilessEntity();
                status = 204;
            } catch (HttpStatusCodeException ex) {
                status = ex.getStatusCode().value();
            }

            assertEquals(
                    403,
                    status,
                    "Người dùng thường, kể cả quản lý trung tâm, không tự đổi được mật khẩu"
                            + " của danh tính dùng chung");
        } finally {
            if (actorSubject != null) {
                deleteUser(actorSubject);
            }
            if (targetSubject != null) {
                deleteUser(targetSubject);
            }
        }
    }

    @Test
    void operatorResetLetsVerifiedUserAuthenticateWithNewPasswordOnly() {
        ensureDirectGrantClient();
        String oldPassword = "recovery-old-" + UUID.randomUUID();
        String username = "recovery-verified";
        String subject =
                createUser(
                        keycloakUser(
                                username, "recovery-verified@example.test", true, oldPassword));
        try {
            assertEquals(200, grantStatus(username, oldPassword));

            String newPassword = "recovery-new-" + UUID.randomUUID();
            assertEquals(204, adminResetPassword(subject, newPassword));

            assertEquals(
                    400,
                    grantStatus(username, oldPassword),
                    "Mật khẩu cũ không còn đăng nhập được sau khi khôi phục");
            assertEquals(200, grantStatus(username, newPassword));
        } finally {
            deleteUser(subject);
        }
    }

    @Test
    void verifiedEmailUserCanBeSentPasswordActionEmail() {
        String subject =
                createUser(
                        keycloakUser(
                                "recovery-email",
                                "recovery-email@example.test",
                                true,
                                "recovery-email-" + UUID.randomUUID()));

        try {
            var response =
                    HTTP.put()
                            .uri(
                                    admin("/users/" + subject + "/execute-actions-email")
                                            + "?client_id="
                                            + WEB_CLIENT)
                            .headers(headers -> headers.setBearerAuth(masterToken()))
                            .contentType(MediaType.APPLICATION_JSON)
                            .body(List.of("UPDATE_PASSWORD"))
                            .retrieve()
                            .toEntity(String.class);

            assertEquals(
                    204,
                    response.getStatusCode().value(),
                    "Account có email đã xác minh nhận được action email đặt lại mật khẩu");
        } finally {
            deleteUser(subject);
        }
    }

    @Test
    void recoveryRequestEndpointCreatesRequestForActor() throws Exception {
        String username = "recovery-request-" + UUID.randomUUID();
        String password = "recovery-password-" + UUID.randomUUID();
        String subject =
                createUser(keycloakUser(username, username + "@example.test", true, password));
        try {
            UUID actor = seedActor(subject);

            try (var session = openSession(username, password, subject)) {
                MockHttpServletResponse response =
                        mockMvc()
                                .perform(
                                        post("/api/me/recovery-requests")
                                                .cookie(session.cookie())
                                                .with(csrf())
                                                .header(
                                                        "Idempotency-Key",
                                                        "recovery-flow-" + UUID.randomUUID())
                                                .contentType(MediaType.APPLICATION_JSON)
                                                .content(
                                                        "{\"targetUserId\":\""
                                                                + actor
                                                                + "\",\"reason\":\"Quên mật khẩu\"}"))
                                .andReturn()
                                .getResponse();

                assertEquals(202, response.getStatus());
                JsonNode body = JSON.readTree(response.getContentAsString());
                assertEquals("PENDING", body.get("state").stringValue());
                assertFalse(body.get("completed").booleanValue());
            }
        } finally {
            deleteUser(subject);
        }
    }

    @Test
    void submitWithoutReasonIsRejected() throws Exception {
        String username = "recovery-no-reason-" + UUID.randomUUID();
        String password = "recovery-password-" + UUID.randomUUID();
        String subject =
                createUser(keycloakUser(username, username + "@example.test", true, password));
        try {
            UUID actor = seedActor(subject);

            try (var session = openSession(username, password, subject)) {
                MockHttpServletResponse response =
                        mockMvc()
                                .perform(
                                        post("/api/me/recovery-requests")
                                                .cookie(session.cookie())
                                                .with(csrf())
                                                .header(
                                                        "Idempotency-Key",
                                                        "recovery-no-reason-" + UUID.randomUUID())
                                                .contentType(MediaType.APPLICATION_JSON)
                                                .content("{\"targetUserId\":\"" + actor + "\"}"))
                                .andReturn()
                                .getResponse();

                assertEquals(400, response.getStatus());
            }
        } finally {
            deleteUser(subject);
        }
    }

    @Test
    void rejectedRequestPollShowsRejectionCode() throws Exception {
        String requesterName = "recovery-reject-" + UUID.randomUUID();
        String operatorName = "recovery-operator-" + UUID.randomUUID();
        String password = "recovery-password-" + UUID.randomUUID();
        String requesterSubject =
                createUser(
                        keycloakUser(
                                requesterName, requesterName + "@example.test", true, password));
        String operatorSubject =
                createUser(
                        keycloakUser(operatorName, operatorName + "@example.test", true, password));
        try {
            UUID requester = seedActor(requesterSubject);
            UUID operator = seedActor(operatorSubject);
            RecoveryService.RequestView created =
                    recoveryService.submit(requester, requester, null, "Quên mật khẩu");
            recoveryService.resolve(
                    operator, created.id(), RecoveryService.Decision.REJECT, "Không xác minh được");

            try (var session = openSession(requesterName, password, requesterSubject)) {
                MockHttpServletResponse response =
                        mockMvc()
                                .perform(
                                        get("/api/me/operations/" + created.id())
                                                .cookie(session.cookie()))
                                .andReturn()
                                .getResponse();

                assertEquals(200, response.getStatus());
                JsonNode body = JSON.readTree(response.getContentAsString());
                assertEquals("FAILED", body.get("state").stringValue());
                assertTrue(body.get("completed").booleanValue());
                assertEquals("RECOVERY_REJECTED", body.get("errorCode").stringValue());
            }
        } finally {
            deleteUser(requesterSubject);
            deleteUser(operatorSubject);
        }
    }

    @Test
    void platformRecoveryEndpointsRequireOperatorScope() throws Exception {
        String username = "recovery-plain-" + UUID.randomUUID();
        String password = "recovery-password-" + UUID.randomUUID();
        String subject =
                createUser(keycloakUser(username, username + "@example.test", true, password));
        try {
            try (var session = openSession(username, password, subject)) {
                MockHttpServletResponse list =
                        mockMvc()
                                .perform(
                                        get("/api/platform/recovery-requests")
                                                .cookie(session.cookie()))
                                .andReturn()
                                .getResponse();
                MockHttpServletResponse resolve =
                        mockMvc()
                                .perform(
                                        post("/api/platform/recovery-requests/"
                                                        + UUID.randomUUID()
                                                        + "/resolve")
                                                .cookie(session.cookie())
                                                .with(csrf())
                                                .header(
                                                        "Idempotency-Key",
                                                        "recovery-resolve-" + UUID.randomUUID())
                                                .contentType(MediaType.APPLICATION_JSON)
                                                .content("{\"decision\":\"RESET_PASSWORD\"}"))
                                .andReturn()
                                .getResponse();

                assertEquals(403, list.getStatus(), "Queue khôi phục chỉ dành cho operator");
                assertEquals(403, resolve.getStatus());
            }
        } finally {
            deleteUser(subject);
        }
    }

    @Test
    void anonymousRecoveryRequestIsRedirectedToLogin() throws Exception {
        MockHttpServletResponse response =
                mockMvc()
                        .perform(
                                post("/api/me/recovery-requests")
                                        .with(csrf())
                                        .header(
                                                "Idempotency-Key",
                                                "recovery-anon-" + UUID.randomUUID())
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                "{\"targetUserId\":\"" + UUID.randomUUID() + "\"}"))
                        .andReturn()
                        .getResponse();

        assertEquals(302, response.getStatus());
        String location =
                Objects.requireNonNull(response.getHeader(HttpHeaders.LOCATION), "Location");
        assertTrue(
                location.contains("/oauth2/authorization/keycloak"),
                "Khôi phục ẩn danh bị từ chối và được hướng dẫn đăng nhập");
        assertFalse(response.getContentAsString().contains("targetUserId"));
    }

    @Test
    void anonymousWithForgedCookieStaysUnauthenticated() throws Exception {
        MockHttpServletResponse response =
                mockMvc()
                        .perform(
                                post("/api/me/recovery-requests")
                                        .cookie(
                                                new Cookie(
                                                        "SESSION", "forged-" + UUID.randomUUID()))
                                        .with(csrf())
                                        .header(
                                                "Idempotency-Key",
                                                "recovery-forged-" + UUID.randomUUID())
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                "{\"targetUserId\":\"" + UUID.randomUUID() + "\"}"))
                        .andReturn()
                        .getResponse();

        assertEquals(302, response.getStatus());
    }

    // ---------- Dữ kiện thư mục ----------

    private UUID seedActor(String keycloakSub) {
        UUID actor = UUID.randomUUID();
        // Trigger của DB bắt user_account và personal workspace tồn tại trong cùng một giao dịch.
        new TransactionTemplate(transactionManager)
                .executeWithoutResult(_ -> {
                    jdbc.update(
                            "INSERT INTO user_account(id,keycloak_sub,username,email,"
                                    + "email_verified,origin,identity_state)"
                                    + " VALUES (?,?,?,?,true,'SELF_REGISTERED','ACTIVE')",
                            actor,
                            keycloakSub,
                            "recovery-user-" + actor,
                            keycloakSub + "@example.test");
                    jdbc.update(
                            "INSERT INTO workspace(id,kind,owner_user_id,state)"
                                    + " VALUES (?,'PERSONAL',?,'ACTIVE')",
                            UUID.randomUUID(),
                            actor);
                });
        return actor;
    }

    private IdentityFlowIT.RealSession openSession(String username, String password, String subject)
            throws Exception {
        return IdentityFlowIT.RealSession.open(
                username,
                password,
                subject,
                sessionFilter,
                authorizedClients,
                clientRegistrations,
                sessions);
    }

    private MockMvc mockMvc() {
        return MockMvcBuilders.webAppContextSetup(webContext)
                .addFilters(sessionFilter)
                .apply(springSecurity())
                .build();
    }

    // ---------- Keycloak TEST realm qua Admin API ----------

    private Map<String, Object> keycloakUser(
            String username, @Nullable String email, boolean emailVerified, String password) {
        var body = new HashMap<String, Object>();
        body.put("username", username);
        body.put("enabled", true);
        body.put("firstName", "Synthetic");
        body.put("lastName", "User");
        body.put("emailVerified", emailVerified);
        body.put("requiredActions", List.of());
        if (email != null) {
            body.put("email", email);
        }
        body.put(
                "credentials",
                List.of(Map.of("type", "password", "value", password, "temporary", false)));
        return body;
    }

    private Map<String, Object> issuedUser(String username, String temporaryPassword) {
        var body = new HashMap<String, Object>();
        body.put("username", username);
        body.put("enabled", true);
        body.put("firstName", "Synthetic");
        body.put("lastName", "User");
        body.put("emailVerified", false);
        body.put("requiredActions", List.of("UPDATE_PASSWORD"));
        body.put(
                "credentials",
                List.of(Map.of("type", "password", "value", temporaryPassword, "temporary", true)));
        return body;
    }

    private String createUser(Map<String, Object> body) {
        ResponseEntity<String> response =
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

    private Map<String, Object> getUser(String userId) {
        Map<String, Object> user =
                HTTP.get()
                        .uri(admin("/users/" + userId))
                        .headers(headers -> headers.setBearerAuth(masterToken()))
                        .retrieve()
                        .body(MAP);
        if (user == null) {
            throw new IllegalStateException("Keycloak user not readable: " + userId);
        }
        return user;
    }

    private int adminResetPassword(String userId, String newPassword) {
        try {
            var response =
                    HTTP.put()
                            .uri(admin("/users/" + userId + "/reset-password"))
                            .headers(headers -> headers.setBearerAuth(masterToken()))
                            .contentType(MediaType.APPLICATION_JSON)
                            .body(
                                    Map.of(
                                            "type",
                                            "password",
                                            "value",
                                            newPassword,
                                            "temporary",
                                            false))
                            .retrieve()
                            .toBodilessEntity();
            return response.getStatusCode().value();
        } catch (HttpStatusCodeException ex) {
            return ex.getStatusCode().value();
        }
    }

    private void deleteUser(String userId) {
        try {
            deleteStatic(admin("/users/" + userId));
        } catch (RestClientResponseException ex) {
            if (!ex.getStatusCode().isSameCodeAs(HttpStatus.NOT_FOUND)) {
                throw ex;
            }
        }
    }

    private String admin(String path) {
        return adminStatic(path);
    }

    private static String adminStatic(String path) {
        return BASE + "/admin/realms/" + REALM + path;
    }

    private static void deleteStatic(String uri) {
        HTTP.delete()
                .uri(uri)
                .headers(headers -> headers.setBearerAuth(masterTokenStatic()))
                .retrieve()
                .toBodilessEntity();
    }

    private String masterToken() {
        return masterTokenStatic();
    }

    private static String masterTokenStatic() {
        var form = new LinkedMultiValueMap<String, String>();
        form.add("grant_type", "password");
        form.add("client_id", "admin-cli");
        form.add("username", IdentityFlowIT.fixture("TEST_KEYCLOAK_MASTER_USERNAME"));
        form.add("password", IdentityFlowIT.fixture("TEST_KEYCLOAK_MASTER_PASSWORD"));
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

    // ---------- Direct Access Grants cho probe mật khẩu ----------

    private static void ensureDirectGrantClient() {
        List<Map<String, Object>> matches =
                HTTP.get()
                        .uri(adminStatic("/clients?clientId=" + DIRECT_CLIENT))
                        .headers(headers -> headers.setBearerAuth(masterTokenStatic()))
                        .retrieve()
                        .body(new ParameterizedTypeReference<List<Map<String, Object>>>() {});
        if (matches != null && !matches.isEmpty()) {
            return;
        }
        var response =
                HTTP.post()
                        .uri(adminStatic("/clients"))
                        .headers(headers -> headers.setBearerAuth(masterTokenStatic()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .body(
                                Map.of(
                                        "clientId", DIRECT_CLIENT,
                                        "protocol", "openid-connect",
                                        "enabled", true,
                                        "publicClient", true,
                                        "standardFlowEnabled", false,
                                        "directAccessGrantsEnabled", true,
                                        "fullScopeAllowed", false))
                        .retrieve()
                        .toEntity(String.class);
        URI location = response.getHeaders().getLocation();
        if (location == null) {
            throw new IllegalStateException("Keycloak did not return the created client location");
        }
        String path = location.getPath();
        ownedDirectClientId = path.substring(path.lastIndexOf('/') + 1);
    }

    private int grantStatus(String username, String password) {
        try {
            var form = new LinkedMultiValueMap<String, String>();
            form.add("grant_type", "password");
            form.add("client_id", DIRECT_CLIENT);
            form.add("username", username);
            form.add("password", password);
            var response =
                    HTTP.post()
                            .uri(BASE + "/realms/" + REALM + "/protocol/openid-connect/token")
                            .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                            .body(form)
                            .retrieve()
                            .toBodilessEntity();
            return response.getStatusCode().value();
        } catch (HttpStatusCodeException ex) {
            return ex.getStatusCode().value();
        }
    }

    private String directGrantToken(String username, String password) {
        var form = new LinkedMultiValueMap<String, String>();
        form.add("grant_type", "password");
        form.add("client_id", DIRECT_CLIENT);
        form.add("username", username);
        form.add("password", password);
        Map<String, Object> response =
                HTTP.post()
                        .uri(BASE + "/realms/" + REALM + "/protocol/openid-connect/token")
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .body(form)
                        .retrieve()
                        .body(MAP);
        if (response == null) {
            throw new IllegalStateException("Direct grant token not readable");
        }
        return Objects.requireNonNull((String) response.get("access_token"), "access_token");
    }
}
