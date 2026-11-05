package com.giaokhoa.authorization.keycloak;

import java.net.URI;
import java.util.Arrays;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.util.UriComponentsBuilder;

/**
 * Server-only directory and realm-group projection client.
 * Keycloak IDs are opaque; business workspace IDs remain UUIDs.
 */
@Component
public class KeycloakProvisioningClient {
    private static final String UUID_PATTERN = "[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}";
    private static final Pattern GROUP_SOURCE = Pattern.compile(
            "/gk/(?:identity/eligible|platform/operators|workspaces/" + UUID_PATTERN
            + "/(?:members|owners|managers|roles/(?:teachers|students|parents)"
            + "|classes/" + UUID_PATTERN + "/homeroom"
            + "|course-subjects/" + UUID_PATTERN + "/(?:teachers|students)"
            + "|students/" + UUID_PATTERN + "/guardians))");

    private final RestClient http;
    private final String baseUrl;
    private final String clientId;
    private final String clientSecret;

    public KeycloakProvisioningClient(
            RestClient.Builder builder,
            @Value("${giaokhoa.keycloak.admin-base-url}") String baseUrl,
            @Value("${giaokhoa.keycloak.provisioner.client-id}") String clientId,
            @Value("${giaokhoa.keycloak.provisioner.client-secret}") String clientSecret) {
        this.http = builder.build();
        this.baseUrl = baseUrl.replaceAll("/+$", "");
        this.clientId = clientId;
        this.clientSecret = clientSecret;
    }

    /** One Organization per center; stable name prevents duplicate organizations on retry. */
    public String ensureOrganization(UUID workspaceId, String displayName) {
        if (workspaceId == null || displayName == null || displayName.isBlank()) {
            throw new IllegalArgumentException("Workspace ID and organization name are required");
        }
        String name = "center-" + workspaceId;
        Organization existing = findOrganization(name);
        if (existing != null) {
            return existing.id();
        }
        try {
            post(endpoint("organizations"),
                    Map.of("name", name, "alias", name, "description", displayName, "enabled", true));
        } catch (RestClientResponseException ex) {
            if (ex.getStatusCode().value() != 409) {
                throw ex;
            }
            // A concurrent retry may have created the same stable organization.
        }
        Organization created = findOrganization(name);
        if (created == null) {
            throw new IllegalStateException("Keycloak organization not visible after creation");
        }
        return created.id();
    }

    /** Allowed templates are fixed by the authorization contract, not chosen by a center. */
    public String ensureRealmGroup(String path) {
        if (path == null || !GROUP_SOURCE.matcher(path).matches()) {
            throw new IllegalArgumentException("Unrecognized authorization group source");
        }
        String parentId = null;
        String currentPath = "";
        for (String segment : path.substring(1).split("/")) {
            currentPath += "/" + segment;
            Group group = findGroup(currentPath);
            if (group == null) {
                URI destination = parentId == null
                        ? endpoint("groups") : endpoint("groups", parentId, "children");
                try {
                    post(destination, Map.of("name", segment));
                } catch (RestClientResponseException ex) {
                    if (ex.getStatusCode().value() != 409) {
                        throw ex;
                    }
                }
                group = findGroup(currentPath);
                if (group == null) {
                    throw new IllegalStateException("Keycloak group not visible after creation: " + currentPath);
                }
            }
            parentId = group.id();
        }
        return parentId;
    }

    /** Membership is independent of Organization groups; no inherited policy is implied. */
    public void setRealmGroupMembership(String keycloakUserId, String groupPath, boolean member) {
        if (keycloakUserId == null || keycloakUserId.isBlank()) {
            throw new IllegalArgumentException("Keycloak user ID is required");
        }
        String groupId = member ? ensureRealmGroup(groupPath) : findExistingSourceGroup(groupPath);
        if (groupId == null) {
            return;
        }
        URI destination = endpoint("users", keycloakUserId, "groups", groupId);
        if (member) {
            put(destination);
        } else {
            delete(destination);
        }
    }

    private String findExistingSourceGroup(String path) {
        if (path == null || !GROUP_SOURCE.matcher(path).matches()) {
            throw new IllegalArgumentException("Unrecognized authorization group source");
        }
        Group group = findGroup(path);
        return group == null ? null : group.id();
    }

    private Organization findOrganization(String name) {
        URI uri = UriComponentsBuilder.fromUri(endpoint("organizations"))
                .queryParam("search", name).queryParam("max", 100).build().encode().toUri();
        Organization[] organizations = get(uri, Organization[].class);
        return Arrays.stream(organizations).filter(org ->
                name.equals(org.name()) || name.equals(org.alias())).findFirst().orElse(null);
    }

    private Group findGroup(String path) {
        String name = path.substring(path.lastIndexOf('/') + 1);
        URI uri = UriComponentsBuilder.fromUri(endpoint("groups"))
                .queryParam("search", name).queryParam("exact", true)
                .queryParam("briefRepresentation", false).queryParam("max", 1000)
                .build().encode().toUri();
        Group[] groups = get(uri, Group[].class);
        for (Group group : groups) {
            Group match = findInHierarchy(group, path);
            if (match != null) {
                return match;
            }
        }
        return null;
    }

    private Group findInHierarchy(Group group, String path) {
        if (path.equals(group.path())) {
            return group;
        }
        if (group.subGroups() != null) {
            for (Group child : group.subGroups()) {
                Group match = findInHierarchy(child, path);
                if (match != null) {
                    return match;
                }
            }
        }
        return null;
    }

    private URI endpoint(String... segments) {
        UriComponentsBuilder uri = UriComponentsBuilder.fromUriString(baseUrl)
                .pathSegment("admin", "realms", "giaokhoa");
        for (String segment : segments) {
            uri.pathSegment(segment);
        }
        return uri.build().encode().toUri();
    }

    private String accessToken() {
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("grant_type", "client_credentials");
        form.add("client_id", clientId);
        form.add("client_secret", clientSecret);
        @SuppressWarnings("unchecked")
        Map<String, Object> token = http.post()
                .uri(baseUrl + "/realms/giaokhoa/protocol/openid-connect/token")
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .body(form).retrieve().body(Map.class);
        if (token == null || !(token.get("access_token") instanceof String value) || value.isBlank()) {
            throw new IllegalStateException("Keycloak provisioner did not return an access token");
        }
        return value;
    }

    private <T> T get(URI uri, Class<T> type) {
        T body = http.get().uri(uri).headers(headers -> headers.setBearerAuth(accessToken()))
                .retrieve().body(type);
        if (body == null) {
            throw new IllegalStateException("Empty Keycloak directory response");
        }
        return body;
    }

    private void post(URI uri, Object payload) {
        http.post().uri(uri).headers(headers -> headers.setBearerAuth(accessToken()))
                .contentType(MediaType.APPLICATION_JSON).body(payload).retrieve().toBodilessEntity();
    }

    private void put(URI uri) {
        http.put().uri(uri).headers(headers -> headers.setBearerAuth(accessToken()))
                .retrieve().toBodilessEntity();
    }

    private void delete(URI uri) {
        http.delete().uri(uri).headers(headers -> headers.setBearerAuth(accessToken()))
                .retrieve().toBodilessEntity();
    }

    private record Group(String id, String name, String path, Group[] subGroups) { }

    private record Organization(String id, String name, String alias) { }
}
