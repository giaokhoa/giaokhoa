package com.giaokhoa.authorization;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.junit.jupiter.api.Test;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.MediaType;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.client.RestClient;

/**
 * Native Keycloak 26.8.1 time-policy gate: exact UTC [start,end) via the real admin policy
 * evaluator, plus real-time UMA decisions with an unchanged user access token.
 */
class NativeTimePolicyIT {
    private static final DateTimeFormatter KEYCLOAK_UTC =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss").withZone(ZoneOffset.UTC);

    private final NativeGateClient gate = new NativeGateClient();
    private final RestClient http = RestClient.create();

    @Test
    void nativeTimePolicyIsInclusiveAtStartAndExclusiveExactlyAtEnd() {
        String actor = gate.token("native-gate-assigned");
        String resource = gate.required("T013_ACTIVITY_ID");
        String startId = gate.required("T013_START_POLICY_ID");
        String endId = gate.required("T013_END_POLICY_ID");
        String provisioner = provisionerToken();

        // In the default fixture both native boundaries are in the future.
        assertFalse(gate.decide(actor, resource, "attempt.open"));

        // The admin-only Keycloak policy evaluator executes the *real* policy graph with
        // an exact evaluation context. Never send kc.time.date_time in UMA requests:
        // production decisions must always use Keycloak's server clock.
        Instant start = Instant.parse("2033-01-15T10:00:00Z");
        Instant end = start.plusSeconds(60);
        updateNotBefore(startId, "POSITIVE", start, provisioner);
        updateNotBefore(endId, "NEGATIVE", end, provisioner);
        assertEquals("DENY", evaluateAt(start.minusSeconds(1), provisioner));
        assertEquals("PERMIT", evaluateAt(start, provisioner));
        assertEquals("PERMIT", evaluateAt(end.minusSeconds(1), provisioner));
        assertEquals("DENY", evaluateAt(end, provisioner));
        assertEquals("DENY", evaluateAt(end.plusSeconds(1), provisioner));

        // Real UMA: confirm the gate flips without logout, refresh or a cron process.
        // Both comparisons are deliberately far from now; CI latency cannot skip a
        // narrow live-time window.
        updateNotBefore(startId, "POSITIVE", Instant.now().minusSeconds(180), provisioner);
        updateNotBefore(endId, "NEGATIVE", Instant.now().plusSeconds(180), provisioner);
        assertTrue(gate.decide(actor, resource, "attempt.open"));
        updateNotBefore(endId, "NEGATIVE", Instant.now().minusSeconds(180), provisioner);
        assertFalse(gate.decide(actor, resource, "attempt.open"));
    }

    private String evaluateAt(Instant instant, String provisioner) {
        String endpoint =
                gate.required("T013_KEYCLOAK_BASE_URL")
                        + "/admin/realms/giaokhoa/clients/"
                        + gate.required("T013_API_CLIENT_ID")
                        + "/authz/resource-server/policy/evaluate";
        Map<String, Object> request =
                Map.of(
                        "userId", gate.required("T013_ASSIGNED_USER_ID"),
                        "clientId", gate.required("T013_API_CLIENT_ID"),
                        "resources",
                                List.of(
                                        Map.of(
                                                "_id", gate.required("T013_ACTIVITY_ID"),
                                                "scopes", List.of(Map.of("name", "attempt.open")))),
                        "context",
                                Map.of(
                                        "attributes",
                                        Map.of("kc.time.date_time", KEYCLOAK_UTC.format(instant))));
        Map<String, Object> response =
                http.post()
                        .uri(endpoint)
                        .headers(headers -> headers.setBearerAuth(provisioner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .body(request)
                        .retrieve()
                        .body(new ParameterizedTypeReference<Map<String, Object>>() {});
        return String.valueOf(
                Objects.requireNonNull(response, "No native evaluation").get("status"));
    }

    private String provisionerToken() {
        var form = new LinkedMultiValueMap<String, String>();
        form.add("grant_type", "client_credentials");
        form.add("client_id", "giaokhoa-provisioner");
        form.add("client_secret", gate.required("KEYCLOAK_PROVISIONER_CLIENT_SECRET"));
        Map<String, Object> result =
                http.post()
                        .uri(
                                gate.required("T013_KEYCLOAK_BASE_URL")
                                        + "/realms/giaokhoa/protocol/openid-connect/token")
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .body(form)
                        .retrieve()
                        .body(new ParameterizedTypeReference<Map<String, Object>>() {});
        return (String)
                Objects.requireNonNull(result, "Missing provisioner token").get("access_token");
    }

    private void updateNotBefore(String id, String logic, Instant boundary, String token) {
        String endpoint =
                gate.required("T013_KEYCLOAK_BASE_URL")
                        + "/admin/realms/giaokhoa/clients/"
                        + gate.required("T013_API_CLIENT_ID")
                        + "/authz/resource-server/policy/time/"
                        + id;
        Map<String, Object> current =
                http.get()
                        .uri(endpoint)
                        .headers(headers -> headers.setBearerAuth(token))
                        .retrieve()
                        .body(new ParameterizedTypeReference<Map<String, Object>>() {});
        Map<String, Object> update = new HashMap<>(Objects.requireNonNull(current));
        assertNull(
                update.get("notOnOrAfter"),
                "Keycloak's inclusive noa must not replace negative nbf=end");
        update.put("notBefore", KEYCLOAK_UTC.format(boundary));
        update.put("logic", logic);
        http.put()
                .uri(endpoint)
                .headers(headers -> headers.setBearerAuth(token))
                .contentType(MediaType.APPLICATION_JSON)
                .body(update)
                .retrieve()
                .toBodilessEntity();
    }
}
