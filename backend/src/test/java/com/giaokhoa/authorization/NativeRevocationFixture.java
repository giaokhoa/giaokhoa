package com.giaokhoa.authorization;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.client.RestClient;
import tools.jackson.databind.json.JsonMapper;

/**
 * Disposable, native Keycloak 26.8.1 policy graph on the allowlisted integration TEST realm. The
 * Direct Grant client is test-only: never giaokhoa-web, never an application auth path.
 */
final class NativeRevocationFixture implements AutoCloseable {
    private static final JsonMapper JSON = new JsonMapper();
    private static final String DEFAULT_PERMISSION = "Default Permission";
    private static final String DEFAULT_RESOURCE = "Default Resource";
    private static final String DEFAULT_POLICY = "Default Policy";
    private static final ParameterizedTypeReference<Map<String, Object>> MAP =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<List<Map<String, Object>>> LIST =
            new ParameterizedTypeReference<>() {};

    private final RestClient http = RestClient.create();
    private final String base;
    private final String adminToken;
    private final String clientName;
    private final String clientSecret;
    private String clientId;
    private String userId;
    private String groupA;
    private String groupB;
    private String resourceA;
    private String resourceB;

    NativeRevocationFixture() {
        base = required("TEST_KEYCLOAK_BASE_URL");
        if (!"http://127.0.0.1:18081".equals(base)
                || !"giaokhoa-it".equals(required("TEST_KEYCLOAK_REALM"))) {
            throw new IllegalArgumentException("T014 native fixture is limited to TEST Keycloak");
        }
        clientName = "t014-" + UUID.randomUUID();
        clientSecret = "test-secret-" + UUID.randomUUID();
        adminToken = masterToken();
        boolean provisioned = false;
        try {
            provision();
            provisioned = true;
        } finally {
            if (!provisioned) {
                close();
            }
        }
    }

    String userToken() {
        var form = new LinkedMultiValueMap<String, String>();
        form.add("grant_type", "password");
        form.add("client_id", clientName);
        form.add("client_secret", clientSecret);
        form.add("username", clientName + "-user");
        form.add("password", clientSecret);
        Map<String, Object> tokens =
                http.post()
                        .uri(base + "/realms/giaokhoa-it/protocol/openid-connect/token")
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .body(form)
                        .retrieve()
                        .body(MAP);
        assertNotNull(tokens);
        return (String) tokens.get("access_token");
    }

    boolean containsGroupClaim(String accessToken) {
        String payload =
                new String(
                        Base64.getUrlDecoder().decode(accessToken.split("\\.")[1]),
                        StandardCharsets.UTF_8);
        return JSON.readTree(payload).has("groups");
    }

    boolean allowed(String userToken, String target) {
        var form = new LinkedMultiValueMap<String, String>();
        form.add("grant_type", "urn:ietf:params:oauth:grant-type:uma-ticket");
        form.add("audience", clientName);
        form.add("permission", ("a".equals(target) ? resourceA : resourceB) + "#enter");
        form.add("response_mode", "decision");
        var response =
                http.post()
                        .uri(base + "/realms/giaokhoa-it/protocol/openid-connect/token")
                        .headers(headers -> headers.setBearerAuth(userToken))
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .body(form)
                        .retrieve()
                        .onStatus(status -> status == HttpStatus.FORBIDDEN, (request, reply) -> {})
                        .toEntity(String.class);
        if (response.getStatusCode() == HttpStatus.FORBIDDEN) {
            return false;
        }
        assertEquals(200, response.getStatusCode().value());
        assertNotNull(response.getBody());
        return JSON.readTree(response.getBody()).get("result").asBoolean();
    }

    void revoke(String target) {
        String group = "a".equals(target) ? groupA : groupB;
        http.delete()
                .uri(admin("/users/" + userId + "/groups/" + group))
                .headers(headers -> headers.setBearerAuth(adminToken))
                .retrieve()
                .toBodilessEntity();
    }

    private void provision() {
        clientId =
                create(
                        "/clients",
                        Map.of(
                                "clientId", clientName,
                                "secret", clientSecret,
                                "protocol", "openid-connect",
                                "enabled", true,
                                "publicClient", false,
                                "standardFlowEnabled", false,
                                "directAccessGrantsEnabled", true,
                                "authorizationServicesEnabled", true,
                                "serviceAccountsEnabled", true,
                                "fullScopeAllowed", false));
        String scope =
                create(
                        "/clients/" + clientId + "/authz/resource-server/scope",
                        Map.of("name", "enter"));
        // A newly created authorization server can have wildcard defaults: delete them.
        removeDefaults();
        groupA = create("/groups", Map.of("name", clientName + "-a"));
        groupB = create("/groups", Map.of("name", clientName + "-b"));
        userId =
                create(
                        "/users",
                        Map.of(
                                "username",
                                clientName + "-user",
                                "enabled",
                                true,
                                "email",
                                clientName + "@example.invalid",
                                "emailVerified",
                                true,
                                "firstName",
                                "Synthetic",
                                "lastName",
                                "User",
                                "requiredActions",
                                List.of(),
                                "credentials",
                                List.of(
                                        Map.of(
                                                "type",
                                                "password",
                                                "value",
                                                clientSecret,
                                                "temporary",
                                                false))));
        addToGroup(groupA);
        addToGroup(groupB);
        resourceA = resource("a", scope);
        resourceB = resource("b", scope);
        permission("a", resourceA, scope, groupA);
        permission("b", resourceB, scope, groupB);
    }

    private void removeDefaults() {
        String root = "/clients/" + clientId + "/authz/resource-server";
        for (Map<String, Object> permission : getList(root + "/permission/resource")) {
            if (DEFAULT_PERMISSION.equals(permission.get("name"))) {
                delete(root + "/permission/resource/" + permission.get("id"));
            }
        }
        for (Map<String, Object> resource : getList(root + "/resource")) {
            if (DEFAULT_RESOURCE.equals(resource.get("name"))) {
                delete(root + "/resource/" + resource.get("_id"));
            }
        }
        for (Map<String, Object> policy : getList(root + "/policy")) {
            if (DEFAULT_POLICY.equals(policy.get("name"))) {
                delete(root + "/policy/" + policy.get("id"));
            }
        }
    }

    private String resource(String name, String scope) {
        return create(
                "/clients/" + clientId + "/authz/resource-server/resource",
                Map.of(
                        "name",
                        clientName + "-" + name,
                        "ownerManagedAccess",
                        false,
                        "scopes",
                        List.of(Map.of("id", scope, "name", "enter"))));
    }

    private void permission(String suffix, String resource, String scope, String group) {
        String root = "/clients/" + clientId + "/authz/resource-server";
        String groupPolicy =
                create(
                        root + "/policy/group",
                        Map.of(
                                "name", clientName + "-members-" + suffix,
                                "type", "group",
                                "logic", "POSITIVE",
                                "decisionStrategy", "UNANIMOUS",
                                "groups", List.of(Map.of("id", group, "extendChildren", false))));
        create(
                root + "/permission/scope",
                Map.of(
                        "name",
                        clientName + "-enter-" + suffix,
                        "type",
                        "scope",
                        "decisionStrategy",
                        "UNANIMOUS",
                        "resources",
                        List.of(resource),
                        "scopes",
                        List.of(scope),
                        "policies",
                        List.of(groupPolicy)));
    }

    private void addToGroup(String group) {
        http.put()
                .uri(admin("/users/" + userId + "/groups/" + group))
                .headers(headers -> headers.setBearerAuth(adminToken))
                .retrieve()
                .toBodilessEntity();
    }

    private String masterToken() {
        var form = new LinkedMultiValueMap<String, String>();
        form.add("grant_type", "password");
        form.add("client_id", "admin-cli");
        form.add("username", required("TEST_KEYCLOAK_MASTER_USERNAME"));
        form.add("password", required("TEST_KEYCLOAK_MASTER_PASSWORD"));
        Map<String, Object> response =
                http.post()
                        .uri(base + "/realms/master/protocol/openid-connect/token")
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .body(form)
                        .retrieve()
                        .body(MAP);
        assertNotNull(response);
        return (String) response.get("access_token");
    }

    private String create(String path, Map<String, ?> body) {
        var response =
                http.post()
                        .uri(admin(path))
                        .headers(headers -> headers.setBearerAuth(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .body(body)
                        .retrieve()
                        .toEntity(String.class);
        URI location = response.getHeaders().getLocation();
        if (location != null) {
            String value = location.getPath();
            return value.substring(value.lastIndexOf('/') + 1);
        }
        // Authorization Services POST returns an ID in JSON rather than a Location header.
        assertNotNull(response.getBody(), "Keycloak must return a created ID for " + path);
        var created = JSON.readTree(response.getBody());
        var id = created.has("id") ? created.get("id") : created.get("_id");
        assertNotNull(id, "Keycloak must return a created ID for " + path);
        return id.stringValue();
    }

    private List<Map<String, Object>> getList(String path) {
        List<Map<String, Object>> result =
                http.get()
                        .uri(admin(path))
                        .headers(headers -> headers.setBearerAuth(adminToken))
                        .retrieve()
                        .body(LIST);
        assertNotNull(result);
        return result;
    }

    private void delete(String path) {
        http.delete()
                .uri(admin(path))
                .headers(headers -> headers.setBearerAuth(adminToken))
                .retrieve()
                .toBodilessEntity();
    }

    private String admin(String path) {
        return base + "/admin/realms/giaokhoa-it" + path;
    }

    private static String required(String key) {
        String value = System.getenv(key);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("Missing TEST fixture variable " + key);
        }
        return value;
    }

    @Override
    public void close() {
        if (userId != null) {
            delete("/users/" + userId);
        }
        if (groupA != null) {
            delete("/groups/" + groupA);
        }
        if (groupB != null) {
            delete("/groups/" + groupB);
        }
        if (clientId != null) {
            delete("/clients/" + clientId);
        }
    }
}
