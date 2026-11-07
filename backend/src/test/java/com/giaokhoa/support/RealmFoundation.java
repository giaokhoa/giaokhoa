package com.giaokhoa.support;

import java.net.URI;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Supplier;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

/**
 * Nền realm dùng chung của các integration test: cây group eligibility và client resource-server
 * của realm TEST. Đây là object nền cấp realm (cùng vai trò bootstrap.sh ở production) — test chỉ
 * tạo khi thiếu, không bao giờ xóa ở teardown, vì không class nào sở hữu vòng đời của chúng.
 * Token admin được cấp qua {@link Supplier} để từng nơi gọi giữ nguyên nhịp lấy token của mình
 * (lấy mới mỗi request hoặc dùng bản đã cấp một lần).
 */
public final class RealmFoundation {
    private static final ParameterizedTypeReference<Map<String, Object>> MAP =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<List<Map<String, Object>>> LIST =
            new ParameterizedTypeReference<>() {};
    private static final String DEFAULT_PERMISSION = "Default Permission";
    private static final String DEFAULT_RESOURCE = "Default Resource";
    private static final String DEFAULT_POLICY = "Default Policy";

    private RealmFoundation() {}

    /**
     * Đảm bảo cây /gk/identity/eligible tồn tại, chỉ tạo đoạn còn thiếu, và trả ID của group sâu
     * nhất.
     */
    public static String ensureEligibilityTree(
            RestClient http, String adminBase, Supplier<String> token) {
        String parentId = null;
        StringBuilder path = new StringBuilder();
        for (String segment : List.of("gk", "identity", "eligible")) {
            path.append('/').append(segment);
            String currentPath = path.toString();
            String found = null;
            try {
                Map<String, Object> group =
                        http.get()
                                .uri(adminBase + "/group-by-path" + currentPath)
                                .headers(headers -> headers.setBearerAuth(token.get()))
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
                // Cây /gk/identity/eligible là object nền của realm: chỉ tạo khi thiếu, không
                // bao giờ xóa ở teardown — nhiều class dùng chung đường dẫn cố định này.
                found =
                        createResource(
                                http, adminBase + endpoint, token, Map.of("name", segment));
            }
            parentId = found;
        }
        return Objects.requireNonNull(parentId);
    }

    /** Đảm bảo client resource-server theo audience tồn tại; chỉ tạo khi thiếu. */
    public static void ensureApiClient(
            RestClient http, String adminBase, Supplier<String> token, String audience) {
        List<Map<String, Object>> matches =
                http.get()
                        .uri(adminBase + "/clients?clientId=" + audience)
                        .headers(headers -> headers.setBearerAuth(token.get()))
                        .retrieve()
                        .body(LIST);
        if (matches != null && !matches.isEmpty()) {
            return;
        }
        String clientId =
                createResource(
                        http,
                        adminBase + "/clients",
                        token,
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
        removeClientDefaults(http, adminBase, token, clientId);
    }

    private static void removeClientDefaults(
            RestClient http, String adminBase, Supplier<String> token, String clientId) {
        String root = adminBase + "/clients/" + clientId + "/authz/resource-server";
        for (Map<String, Object> permission : getList(http, root + "/permission/resource", token)) {
            if (DEFAULT_PERMISSION.equals(permission.get("name"))) {
                delete(http, root + "/permission/resource/" + permission.get("id"), token);
            }
        }
        for (Map<String, Object> resource : getList(http, root + "/resource", token)) {
            if (DEFAULT_RESOURCE.equals(resource.get("name"))) {
                delete(http, root + "/resource/" + resource.get("_id"), token);
            }
        }
        for (Map<String, Object> policy : getList(http, root + "/policy", token)) {
            if (DEFAULT_POLICY.equals(policy.get("name"))) {
                delete(http, root + "/policy/" + policy.get("id"), token);
            }
        }
    }

    private static List<Map<String, Object>> getList(
            RestClient http, String uri, Supplier<String> token) {
        List<Map<String, Object>> result =
                http.get()
                        .uri(uri)
                        .headers(headers -> headers.setBearerAuth(token.get()))
                        .retrieve()
                        .body(LIST);
        if (result == null) {
            throw new IllegalStateException("Keycloak list not readable: " + uri);
        }
        return result;
    }

    private static String createResource(
            RestClient http, String uri, Supplier<String> token, Map<String, ?> body) {
        var response =
                http.post()
                        .uri(uri)
                        .headers(headers -> headers.setBearerAuth(token.get()))
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

    private static void delete(RestClient http, String uri, Supplier<String> token) {
        http.delete()
                .uri(uri)
                .headers(headers -> headers.setBearerAuth(token.get()))
                .retrieve()
                .toBodilessEntity();
    }
}
