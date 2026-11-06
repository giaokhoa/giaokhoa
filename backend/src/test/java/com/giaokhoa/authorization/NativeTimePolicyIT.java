package com.giaokhoa.authorization;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import org.junit.jupiter.api.Test;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.MediaType;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.client.RestClient;

/** Native time-policy gate on real Keycloak 26.8.1, with UTC [valid_from, expires_at). */
class NativeTimePolicyIT {
    private final NativeGateClient gate = new NativeGateClient();
    private final RestClient http = RestClient.create();

    @Test
    void startInclusiveAndEndExclusiveEvenWithAnUnchangedUserToken() throws InterruptedException {
        String actor = gate.token("native-gate-assigned");
        String resource = gate.required("T013_ACTIVITY_ID");
        String startId = gate.required("T013_START_POLICY_ID");
        String endId = gate.required("T013_END_POLICY_ID");
        String adminToken = provisionerToken();

        // The fixed fixture starts in the future: a valid teacher is not enough.
        assertFalse(gate.decide(actor, resource, "attempt.open"));

        Instant start = Instant.now().plusSeconds(6).truncatedTo(ChronoUnit.SECONDS);
        Instant end = start.plusSeconds(6);
        updateNotBefore(startId, "POSITIVE", start, adminToken);
        updateNotBefore(endId, "NEGATIVE", end, adminToken);
        assertFalse(gate.decide(actor, resource, "attempt.open"), "Before valid_from is denied");

        awaitBoundary(start);
        assertTrue(gate.decide(actor, resource, "attempt.open"), "At valid_from permission starts");
        awaitBoundary(end);
        assertFalse(
                gate.decide(actor, resource, "attempt.open"), "At expires_at permission is denied");
        Thread.sleep(1100);
        assertFalse(
                gate.decide(actor, resource, "attempt.open"), "After expires_at remains denied");
    }

    private void awaitBoundary(Instant boundary) throws InterruptedException {
        long millis = Duration.between(Instant.now(), boundary).toMillis();
        if (millis > 0) {
            Thread.sleep(millis + 100);
        }
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
                "Do not use Keycloak's inclusive noa for half-open time");
        update.put(
                "notBefore",
                DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")
                        .withZone(ZoneOffset.UTC)
                        .format(boundary));
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
