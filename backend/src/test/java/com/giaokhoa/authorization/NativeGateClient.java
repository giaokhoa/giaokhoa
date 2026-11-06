package com.giaokhoa.authorization;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

/** Calls Keycloak's token endpoint with the real actor token; no mocked PDP decisions. */
final class NativeGateClient {
    private final RestClient http = RestClient.create();
    private final String base = required("T013_KEYCLOAK_BASE_URL");

    String required(String name) {
        return Objects.requireNonNull(
                System.getenv(name), "Use infra/keycloak/verify-native.sh: " + name);
    }

    String token(String user) {
        var form = new LinkedMultiValueMap<String, String>();
        form.add("grant_type", "password");
        form.add(
                "client_id",
                "native-gate-claim-only".equals(user) ? "native-gate-forged" : "native-gate-test");
        form.add("username", user);
        form.add("password", required("T013_NATIVE_PASSWORD"));
        Map<String, Object> body =
                http.post()
                        .uri(base + "/realms/giaokhoa/protocol/openid-connect/token")
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .body(form)
                        .retrieve()
                        .body(new ParameterizedTypeReference<Map<String, Object>>() {});
        return (String)
                Objects.requireNonNull(body, "Missing native actor token").get("access_token");
    }

    boolean decide(String actorToken, String resourceId, String scope) {
        try {
            Map<String, Object> answer =
                    http.post()
                            .uri(base + "/realms/giaokhoa/protocol/openid-connect/token")
                            .headers(h -> h.setBearerAuth(actorToken))
                            .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                            .body(request("decision", resourceId + "#" + scope))
                            .retrieve()
                            .body(new ParameterizedTypeReference<Map<String, Object>>() {});
            return Boolean.TRUE.equals(
                    Objects.requireNonNull(answer, "No native PDP response").get("result"));
        } catch (RestClientResponseException exception) {
            if (exception.getStatusCode().isSameCodeAs(HttpStatus.FORBIDDEN)) {
                return false;
            }
            throw exception;
        }
    }

    List<Map<String, Object>> permissions(String actorToken, String... pairs) {
        try {
            List<Map<String, Object>> granted =
                    http.post()
                            .uri(base + "/realms/giaokhoa/protocol/openid-connect/token")
                            .headers(h -> h.setBearerAuth(actorToken))
                            .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                            .body(request("permissions", pairs))
                            .retrieve()
                            .body(new ParameterizedTypeReference<List<Map<String, Object>>>() {});
            return Objects.requireNonNull(granted, "No native permission response");
        } catch (RestClientResponseException exception) {
            if (exception.getStatusCode().isSameCodeAs(HttpStatus.FORBIDDEN)) {
                return List.of();
            }
            throw exception;
        }
    }

    private MultiValueMap<String, String> request(String mode, String... pairs) {
        var form = new LinkedMultiValueMap<String, String>();
        form.add("grant_type", "urn:ietf:params:oauth:grant-type:uma-ticket");
        form.add("audience", "giaokhoa-api");
        form.add("response_mode", mode);
        for (String pair : pairs) {
            form.add("permission", pair);
        }
        return form;
    }
}
