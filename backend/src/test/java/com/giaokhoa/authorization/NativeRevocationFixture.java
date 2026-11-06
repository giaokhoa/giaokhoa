package com.giaokhoa.authorization;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import java.io.IOException;
import java.net.CookieManager;
import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;
import tools.jackson.databind.json.JsonMapper;

/**
 * Policy graph Keycloak 26.8.1 native dùng một lần trên integration TEST realm thuộc allowlist.
 * Direct Grant client chỉ dành cho test: không bao giờ là giaokhoa-web, không bao giờ là đường auth
 * của ứng dụng.
 */
final class NativeRevocationFixture implements AutoCloseable {
    private static final JsonMapper JSON = new JsonMapper();
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final String REDIRECT_URI = "http://127.0.0.1:18888/callback";
    private static final Pattern LOGIN_FORM =
            Pattern.compile("<form[^>]*id=\"kc-form-login\"[^>]*action=\"([^\"]+)\"");
    private static final int SINGLE_CLIENT = 1;
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
    private @Nullable String clientId;
    private @Nullable String userId;
    private @Nullable String groupA;
    private @Nullable String groupB;
    private @Nullable String resourceA;
    private @Nullable String resourceB;
    private final List<String> ownedEligibilityGroupIds = new java.util.ArrayList<>();

    NativeRevocationFixture() {
        base = required("TEST_KEYCLOAK_BASE_URL");
        if (!"http://127.0.0.1:18081".equals(base)
                || !"giaokhoa-it".equals(required("TEST_KEYCLOAK_REALM"))) {
            throw new IllegalArgumentException(
                    "Revocation native fixture is limited to TEST Keycloak");
        }
        clientName = "revocation-" + UUID.randomUUID();
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

    /**
     * Worker không thể bịa ra directory group. Seed native identity eligibility projection cho user
     * chỉ-dùng-cho-TEST này trước khi yêu cầu writer thật áp một business graph.
     */
    void provisionEligibilityForWorkerFixture() {
        String parentId = null;
        StringBuilder path = new StringBuilder();
        for (String segment : List.of("gk", "identity", "eligible")) {
            path.append('/').append(segment);
            String currentPath = path.toString();
            String found = null;
            try {
                Map<String, Object> group =
                        http.get()
                                .uri(admin("/group-by-path" + currentPath))
                                .headers(headers -> headers.setBearerAuth(adminToken))
                                .retrieve()
                                .body(MAP);
                if (group != null && currentPath.equals(group.get("path"))) {
                    found = String.valueOf(group.get("id"));
                }
            } catch (RestClientResponseException exception) {
                if (!exception.getStatusCode().isSameCodeAs(HttpStatus.NOT_FOUND)) {
                    throw exception;
                }
            }
            if (found == null) {
                String endpoint =
                        parentId == null ? "/groups" : "/groups/" + parentId + "/children";
                found = create(endpoint, Map.of("name", segment));
                ownedEligibilityGroupIds.add(found);
            }
            parentId = found;
        }
        addToGroup(java.util.Objects.requireNonNull(parentId));
    }

    String userSubject() {
        return Objects.requireNonNull(userId);
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
        return Objects.requireNonNull((String) tokens.get("access_token"), "access_token");
    }

    record WebTokens(String accessToken, String idToken, String refreshToken) {}

    WebTokens webTokensViaCodePkce() {
        // Authorization Code+PKCE thật của Keycloak cho confidential TEST client của ứng dụng.
        // HTTP form login là đủ ở đây; acceptance đầu-cuối bao phủ thêm
        // callback của trình duyệt/BFF.
        String client = required("TEST_OIDC_CLIENT_ID");
        if (!"giaokhoa-it-web".equals(client)) {
            throw new IllegalArgumentException("Only TEST BFF client can be used");
        }
        byte[] nonce = new byte[32];
        RANDOM.nextBytes(nonce);
        String verifier = Base64.getUrlEncoder().withoutPadding().encodeToString(nonce);
        String challenge;
        try {
            challenge =
                    Base64.getUrlEncoder()
                            .withoutPadding()
                            .encodeToString(
                                    MessageDigest.getInstance("SHA-256")
                                            .digest(verifier.getBytes(StandardCharsets.US_ASCII)));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("PKCE requires SHA-256", ex);
        }
        String state = UUID.randomUUID().toString();
        String url =
                base
                        + "/realms/giaokhoa-it/protocol/openid-connect/auth?client_id="
                        + encode(client)
                        + "&redirect_uri="
                        + encode(REDIRECT_URI)
                        + "&response_type=code&scope=openid&state="
                        + encode(state)
                        + "&nonce="
                        + UUID.randomUUID()
                        + "&code_challenge="
                        + encode(challenge)
                        + "&code_challenge_method=S256";

        try (HttpClient browser =
                HttpClient.newBuilder()
                        .cookieHandler(new CookieManager())
                        .connectTimeout(Duration.ofSeconds(10))
                        .followRedirects(HttpClient.Redirect.NEVER)
                        .build()) {
            var loginPage =
                    browser.send(
                            HttpRequest.newBuilder(URI.create(url)).GET().build(),
                            HttpResponse.BodyHandlers.ofString());
            assertEquals(200, loginPage.statusCode(), "Expected native Keycloak login form");
            var form = LOGIN_FORM.matcher(loginPage.body());
            if (!form.find()) {
                throw new IllegalStateException("Native TEST Code login form not found");
            }
            String loginUrl = form.group(1).replace("&amp;", "&");
            if (!loginUrl.startsWith(base + "/realms/giaokhoa-it/login-actions/")) {
                throw new IllegalStateException("Unexpected TEST login form target");
            }
            // TEST Keycloak phát hành cookie Secure ngay cả trên HTTP loopback. Chỉ trả chúng
            // về login action 127.0.0.1:18081 thuộc allowlist, không về origin nào khác.
            String loginCookies =
                    loginPage.headers().allValues("set-cookie").stream()
                            .map(cookie -> cookie.split(";", 2)[0])
                            .collect(java.util.stream.Collectors.joining("; "));
            var loginResponse =
                    browser.send(
                            HttpRequest.newBuilder(URI.create(loginUrl))
                                    .header("Cookie", loginCookies)
                                    .header("Content-Type", "application/x-www-form-urlencoded")
                                    .POST(
                                            HttpRequest.BodyPublishers.ofString(
                                                    "username="
                                                            + encode(clientName + "-user")
                                                            + "&password="
                                                            + encode(clientSecret)
                                                            + "&credentialId="))
                                    .build(),
                            HttpResponse.BodyHandlers.ofString());
            assertEquals(302, loginResponse.statusCode(), "Native Code login must redirect");
            URI redirected =
                    URI.create(loginResponse.headers().firstValue("location").orElseThrow());
            if (!REDIRECT_URI.equals(
                    redirected.getScheme()
                            + "://"
                            + redirected.getHost()
                            + ":"
                            + redirected.getPort()
                            + redirected.getPath())) {
                throw new IllegalStateException("Unexpected TEST OIDC redirect target");
            }
            Map<String, String> params =
                    java.util.Arrays.stream(redirected.getRawQuery().split("&"))
                            .map(value -> value.split("=", 2))
                            .collect(
                                    java.util.stream.Collectors.toMap(
                                            pair ->
                                                    URLDecoder.decode(
                                                            pair[0], StandardCharsets.UTF_8),
                                            pair ->
                                                    URLDecoder.decode(
                                                            pair[1], StandardCharsets.UTF_8)));
            assertEquals(state, params.get("state"));
            String code = java.util.Objects.requireNonNull(params.get("code"));
            var exchange = new LinkedMultiValueMap<String, String>();
            exchange.add("grant_type", "authorization_code");
            exchange.add("client_id", client);
            exchange.add("client_secret", required("TEST_OIDC_CLIENT_SECRET"));
            exchange.add("redirect_uri", REDIRECT_URI);
            exchange.add("code", code);
            exchange.add("code_verifier", verifier);
            Map<String, Object> tokens =
                    http.post()
                            .uri(base + "/realms/giaokhoa-it/protocol/openid-connect/token")
                            .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                            .body(exchange)
                            .retrieve()
                            .body(MAP);
            assertNotNull(tokens);
            String idToken = (String) tokens.get("id_token");
            assertNotNull(idToken);
            String claims =
                    new String(
                            Base64.getUrlDecoder().decode(idToken.split("[.]")[1]),
                            StandardCharsets.UTF_8);
            assertEquals(
                    Objects.requireNonNull(userId), JSON.readTree(claims).get("sub").stringValue());
            return new WebTokens(
                    Objects.requireNonNull((String) tokens.get("access_token"), "access_token"),
                    idToken,
                    Objects.requireNonNull((String) tokens.get("refresh_token"), "refresh_token"));
        } catch (IOException exception) {
            throw new IllegalStateException("Native TEST Code+PKCE login failed", exception);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Native TEST Code+PKCE login interrupted", exception);
        }
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    boolean containsGroupClaim(String accessToken) {
        String payload =
                new String(
                        Base64.getUrlDecoder().decode(accessToken.split("\\.")[1]),
                        StandardCharsets.UTF_8);
        return JSON.readTree(payload).has("groups");
    }

    boolean allowed(String userToken, String target) {
        return allowed(userToken, target, "enter");
    }

    boolean allowed(String userToken, String target, String scope) {
        var form = new LinkedMultiValueMap<String, String>();
        form.add("grant_type", "urn:ietf:params:oauth:grant-type:uma-ticket");
        form.add("audience", clientName);
        form.add("permission", ("a".equals(target) ? resourceA : resourceB) + "#" + scope);
        form.add("response_mode", "decision");
        var response =
                http.post()
                        .uri(base + "/realms/giaokhoa-it/protocol/openid-connect/token")
                        .headers(headers -> headers.setBearerAuth(userToken))
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .body(form)
                        .retrieve()
                        .onStatus(status -> status == HttpStatus.FORBIDDEN, (_, _) -> {})
                        .toEntity(MAP);
        if (response.getStatusCode() == HttpStatus.FORBIDDEN) {
            return false;
        }
        assertEquals(200, response.getStatusCode().value());
        return NativeGateClient.requireDecision(response.getBody());
    }

    record GraphInventory(long resources, long policies, long permissions) {}

    GraphInventory graphInventory() {
        String root = "/clients/" + clientId + "/authz/resource-server";
        return new GraphInventory(
                countNative(root + "/resource"),
                countNative(root + "/policy"),
                countNative(root + "/permission/scope"));
    }

    private long countNative(String path) {
        return getList(path).stream()
                .filter(item -> String.valueOf(item.get("name")).startsWith(clientName + "-"))
                .count();
    }

    /**
     * Fixture lỗi phục vụ khôi phục của reconciliation worker: native resource tồn tại trong API
     * audience của ứng dụng TEST, nhưng scope permission/policy chưa được provision. Không bao giờ
     * đụng vào DEV.
     */
    PartialApplicationGraph partiallyProvisionApplicationResource(String targetKey, String scope) {
        String audience = required("TEST_KEYCLOAK_AUTHZ_AUDIENCE");
        if (!"giaokhoa-it-api".equals(audience)) {
            throw new IllegalArgumentException(
                    "Revocation partial graph requires TEST API audience");
        }
        var matches =
                getList("/clients?clientId=" + encode(audience)).stream()
                        .filter(item -> audience.equals(item.get("clientId")))
                        .toList();
        if (matches.size() > SINGLE_CLIENT) {
            throw new IllegalStateException("Duplicate TEST API audience clients");
        }
        boolean ownedClient = matches.isEmpty();
        String appClient =
                ownedClient
                        ? create(
                                "/clients",
                                Map.of(
                                        "clientId",
                                        audience,
                                        "protocol",
                                        "openid-connect",
                                        "enabled",
                                        true,
                                        "publicClient",
                                        false,
                                        "standardFlowEnabled",
                                        false,
                                        "directAccessGrantsEnabled",
                                        false,
                                        "authorizationServicesEnabled",
                                        true,
                                        "serviceAccountsEnabled",
                                        true,
                                        "fullScopeAllowed",
                                        false,
                                        "authorizationSettings",
                                        Map.of(
                                                "policyEnforcementMode", "ENFORCING",
                                                "allowRemoteResourceManagement", true,
                                                "decisionStrategy", "UNANIMOUS")))
                        : String.valueOf(matches.getFirst().get("id"));
        String root = "/clients/" + appClient + "/authz/resource-server";
        String scopeId = null;
        String resourceId = null;
        boolean ownedScope = false;
        boolean created = false;
        try {
            if (ownedClient) {
                removeDefaults(root);
            }
            var scopes =
                    getList(root + "/scope").stream()
                            .filter(item -> scope.equals(item.get("name")))
                            .toList();
            if (scopes.size() > SINGLE_CLIENT) {
                throw new IllegalStateException("Duplicate native content.read scope");
            }
            ownedScope = scopes.isEmpty();
            scopeId =
                    ownedScope
                            ? create(root + "/scope", Map.of("name", scope))
                            : String.valueOf(scopes.getFirst().get("id"));
            String name = targetKey;
            resourceId =
                    create(
                            root + "/resource",
                            Map.of(
                                    "name",
                                    name,
                                    "ownerManagedAccess",
                                    false,
                                    "scopes",
                                    List.of(Map.of("id", scopeId, "name", scope))));
            created = true;
            return new PartialApplicationGraph(
                    appClient, name, resourceId, scopeId, scope, ownedClient, ownedScope);
        } finally {
            if (!created) {
                if (ownedClient) {
                    delete("/clients/" + appClient);
                } else {
                    if (resourceId != null) {
                        delete(root + "/resource/" + resourceId);
                    }
                    if (ownedScope && scopeId != null) {
                        delete(root + "/scope/" + scopeId);
                    }
                }
            }
        }
    }

    final class PartialApplicationGraph implements AutoCloseable {
        private final String appClient;
        private final String name;
        private final String resource;
        private final String scopeId;
        private final String scopeName;
        private final boolean ownedClient;
        private final boolean ownedScope;
        private final List<String> ownedResources = new java.util.ArrayList<>();
        private final List<String> ownedPolicies = new java.util.ArrayList<>();
        private java.util.function.Supplier<List<String>> projectionPolicyNames = List::of;

        PartialApplicationGraph(
                String appClient,
                String name,
                String resource,
                String scopeId,
                String scopeName,
                boolean ownedClient,
                boolean ownedScope) {
            this.appClient = appClient;
            this.name = name;
            this.resource = resource;
            this.scopeId = scopeId;
            this.scopeName = scopeName;
            this.ownedClient = ownedClient;
            this.ownedScope = ownedScope;
            ownedResources.add(resource);
        }

        String resourceId() {
            return resource;
        }

        void cleanupProjectedPolicies(java.util.function.Supplier<List<String>> names) {
            // Graph writer production ghi đúng các native policy name thuộc sở hữu trong
            // authz_projection.
            // Đọc chúng lúc đóng, sau khi worker đã có cơ hội ghi chúng.
            projectionPolicyNames = names;
        }

        String addAuthorizedResource(String targetKey) {
            String nextResource =
                    create(
                            root() + "/resource",
                            Map.of(
                                    "name",
                                    targetKey,
                                    "ownerManagedAccess",
                                    false,
                                    "scopes",
                                    List.of(Map.of("id", scopeId, "name", scopeName))));
            ownedResources.add(nextResource);
            authorizeOwner(nextResource, targetKey);
            return nextResource;
        }

        void authorizeOwner() {
            authorizeOwner(resource, name);
        }

        private void authorizeOwner(String id, String targetKey) {
            // User policy là projection native của recipient/owner thật đã đăng nhập.
            String sourcePolicy =
                    create(
                            root() + "/policy/user",
                            Map.of(
                                    "name", "revocation-owner-" + targetKey,
                                    "type", "user",
                                    "logic", "POSITIVE",
                                    "decisionStrategy", "UNANIMOUS",
                                    "users", List.of(userId)));
            ownedPolicies.add(sourcePolicy);
            create(
                    root() + "/permission/scope",
                    Map.of(
                            "name",
                            "revocation-scope-" + targetKey,
                            "type",
                            "scope",
                            "decisionStrategy",
                            "UNANIMOUS",
                            "resources",
                            List.of(id),
                            "scopes",
                            List.of(scopeId),
                            "policies",
                            List.of(sourcePolicy)));
        }

        boolean allowed(String userToken, String resourceId) {
            var form = new LinkedMultiValueMap<String, String>();
            form.add("grant_type", "urn:ietf:params:oauth:grant-type:uma-ticket");
            form.add("audience", required("TEST_KEYCLOAK_AUTHZ_AUDIENCE"));
            form.add("permission", resourceId + "#" + scopeName);
            form.add("response_mode", "decision");
            var response =
                    http.post()
                            .uri(base + "/realms/giaokhoa-it/protocol/openid-connect/token")
                            .headers(headers -> headers.setBearerAuth(userToken))
                            .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                            .body(form)
                            .retrieve()
                            .onStatus(status -> status == HttpStatus.FORBIDDEN, (_, _) -> {})
                            .toEntity(MAP);
            if (response.getStatusCode() == HttpStatus.FORBIDDEN) {
                return false;
            }
            assertEquals(200, response.getStatusCode().value());
            return NativeGateClient.requireDecision(response.getBody());
        }

        int resourceCount() {
            return (int)
                    getList(root() + "/resource").stream()
                            .filter(item -> name.equals(item.get("name")))
                            .count();
        }

        long policyCount() {
            return getList(root() + "/policy").stream()
                    .filter(item -> !DEFAULT_POLICY.equals(item.get("name")))
                    .count();
        }

        long permissionCount() {
            // Representation của permission không mang association; các permission của một
            // resource được đọc từ association endpoint của chính resource đó.
            return getList(root() + "/resource/" + resource + "/permissions").size();
        }

        /**
         * Các policy liên kết từ bất kỳ permission hoặc policy nào khác; representation đơn thuần
         * che giấu các liên kết, nên chúng được đọc từ association endpoint của từng holder.
         */
        private java.util.Set<String> referencedPolicyIds(
                List<Map<String, Object>> policies, List<Map<String, Object>> permissions) {
            java.util.Set<String> referenced = new java.util.HashSet<>();
            List<Map<String, Object>> holders = new java.util.ArrayList<>(permissions);
            holders.addAll(policies);
            for (Map<String, Object> holder : holders) {
                for (Map<String, Object> linked :
                        getList(root() + "/policy/" + holder.get("id") + "/associatedPolicies")) {
                    referenced.add(String.valueOf(linked.get("id")));
                }
            }
            return referenced;
        }

        private String root() {
            return "/clients/" + appClient + "/authz/resource-server";
        }

        @Override
        public void close() {
            if (ownedClient) {
                delete("/clients/" + appClient);
                return;
            }
            // Xóa permission trước, gồm cả những permission writer thật đã provision trên
            // resource duy nhất của ta. Không bao giờ xóa shared policy/scope hay API resource
            // không liên quan.
            for (String id : ownedResources) {
                for (Map<String, Object> permission :
                        getList(root() + "/resource/" + id + "/permissions")) {
                    delete(root() + "/permission/scope/" + permission.get("id"));
                }
            }
            for (String id : ownedPolicies) {
                delete(root() + "/policy/" + id);
            }
            // Chỉ các policy được projection này nêu tên mới bị thu gom rác.
            // Shared policy vẫn còn được resource không liên quan tham chiếu thì được giữ lại.
            List<String> projected = projectionPolicyNames.get();
            int remaining = projected.size();
            while (remaining > 0) {
                remaining--;
                boolean deleted = false;
                List<Map<String, Object>> policies = getList(root() + "/policy");
                List<Map<String, Object>> permissions = getList(root() + "/permission/scope");
                java.util.Set<String> referenced = referencedPolicyIds(policies, permissions);
                for (Map<String, Object> policy : policies) {
                    if (!projected.contains(policy.get("name"))) {
                        continue;
                    }
                    String id = String.valueOf(policy.get("id"));
                    boolean stillInUse = referenced.contains(id);
                    if (!stillInUse) {
                        delete(root() + "/policy/" + id);
                        deleted = true;
                        break;
                    }
                }
                if (!deleted) {
                    break; // Không còn policy nào do test sở hữu có thể xóa an toàn nữa.
                }
            }
            for (String id : ownedResources) {
                delete(root() + "/resource/" + id);
            }
            if (ownedScope) {
                delete(root() + "/scope/" + scopeId);
            }
        }
    }

    String resourceId(String target) {
        return Objects.requireNonNull("a".equals(target) ? resourceA : resourceB);
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
        String contentScope =
                create(
                        "/clients/" + clientId + "/authz/resource-server/scope",
                        Map.of("name", "content.read"));
        // Một authorization server mới tạo có thể có các mặc định wildcard: xóa chúng.
        removeDefaults();
        String createdGroupA = create("/groups", Map.of("name", clientName + "-a"));
        groupA = createdGroupA;
        String createdGroupB = create("/groups", Map.of("name", clientName + "-b"));
        groupB = createdGroupB;
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
        addToGroup(createdGroupA);
        addToGroup(createdGroupB);
        String createdResourceA = resource("a", scope, contentScope);
        resourceA = createdResourceA;
        String createdResourceB = resource("b", scope, contentScope);
        resourceB = createdResourceB;
        permission("a", createdResourceA, scope, createdGroupA);
        permission("b", createdResourceB, scope, createdGroupB);
        permission("a-content", createdResourceA, contentScope, createdGroupA);
        permission("b-content", createdResourceB, contentScope, createdGroupB);
    }

    private void removeDefaults() {
        removeDefaults("/clients/" + clientId + "/authz/resource-server");
    }

    private void removeDefaults(String root) {
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

    private String resource(String name, String scope, String contentScope) {
        return create(
                "/clients/" + clientId + "/authz/resource-server/resource",
                Map.of(
                        "name",
                        clientName + "-" + name,
                        "ownerManagedAccess",
                        false,
                        "scopes",
                        List.of(
                                Map.of("id", scope, "name", "enter"),
                                Map.of("id", contentScope, "name", "content.read"))));
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
        return Objects.requireNonNull((String) response.get("access_token"), "access_token");
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
        // POST của Authorization Services trả một ID trong JSON thay vì trong Location header.
        String createdBody =
                Objects.requireNonNull(
                        response.getBody(), "Keycloak must return a created ID for " + path);
        var created = JSON.readTree(createdBody);
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
        // Chỉ xóa các segment directory do fixture này tạo, từ lá về gốc.
        for (int i = ownedEligibilityGroupIds.size() - 1; i >= 0; i--) {
            delete("/groups/" + ownedEligibilityGroupIds.get(i));
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
