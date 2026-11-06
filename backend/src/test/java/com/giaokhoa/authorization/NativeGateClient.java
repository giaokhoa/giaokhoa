package com.giaokhoa.authorization;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.jspecify.annotations.Nullable;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

/** Gọi token endpoint của Keycloak bằng actor token thật; không có quyết định PDP nào bị mock. */
final class NativeGateClient {
    private static final int EXPECTED_ACTOR_COUNT = 2;

    private final RestClient http = RestClient.create();
    private final String base = required("NATIVE_GATE_KEYCLOAK_BASE_URL");

    String required(String name) {
        return Objects.requireNonNull(
                System.getenv(name), "Use infra/keycloak/verify-native.sh: " + name);
    }

    String token(String user) {
        try {
            // Token chỉ được tạo bởi native-pkce-login.mjs qua Code+PKCE thật của Keycloak.
            List<String> tokens =
                    Files.readAllLines(Path.of(required("NATIVE_GATE_NATIVE_TOKENS_FILE")));
            if (tokens.size() != EXPECTED_ACTOR_COUNT) {
                throw new IllegalStateException("Expected exactly two native PKCE actor tokens");
            }
            return switch (user) {
                case "native-gate-assigned" -> tokens.get(0);
                case "native-gate-claim-only" -> tokens.get(1);
                default -> throw new IllegalArgumentException("Unknown native actor");
            };
        } catch (IOException exception) {
            throw new UncheckedIOException("Unable to read native PKCE actor tokens", exception);
        }
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
            return requireDecision(answer);
        } catch (RestClientResponseException exception) {
            if (exception.getStatusCode().isSameCodeAs(HttpStatus.FORBIDDEN)) {
                return false;
            }
            throw exception;
        }
    }

    static boolean requireDecision(@Nullable Map<String, Object> answer) {
        if (answer == null || !(answer.get("result") instanceof Boolean decision)) {
            throw new IllegalStateException("Native PDP response must contain a boolean result");
        }
        return decision;
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
