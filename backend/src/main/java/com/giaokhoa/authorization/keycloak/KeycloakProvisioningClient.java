package com.giaokhoa.authorization.keycloak;

import java.net.URI;
import java.util.Arrays;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.security.oauth2.client.AuthorizedClientServiceOAuth2AuthorizedClientManager;
import org.springframework.security.oauth2.client.InMemoryOAuth2AuthorizedClientService;
import org.springframework.security.oauth2.client.OAuth2AuthorizeRequest;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClientManager;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClientProviderBuilder;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.InMemoryClientRegistrationRepository;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
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
    private final OAuth2AuthorizedClientManager manager;

    @Autowired
    public KeycloakProvisioningClient(
            @Value("${giaokhoa.keycloak.admin-base-url}") String baseUrl,
            @Value("${giaokhoa.keycloak.provisioner.client-id}") String clientId,
            @Value("${giaokhoa.keycloak.provisioner.client-secret}") String clientSecret) {
        this(RestClient.builder(), baseUrl, clientId, clientSecret);
    }

    public KeycloakProvisioningClient(RestClient.Builder builder, String baseUrl,
            String clientId, String clientSecret) {
        this(builder, baseUrl, clientManager(baseUrl.replaceAll("/+$", ""), clientId, clientSecret));
    }

    KeycloakProvisioningClient(RestClient.Builder builder, String baseUrl, OAuth2AuthorizedClientManager manager) {
        this.http = builder.build();
        this.baseUrl = baseUrl.replaceAll("/+$", "");
        this.manager = manager;
    }

    private static OAuth2AuthorizedClientManager clientManager(String baseUrl, String clientId, String secret) {
        ClientRegistration registration = ClientRegistration.withRegistrationId("giaokhoa-provisioner")
                .clientId(clientId).clientSecret(secret)
                .clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_POST)
                .authorizationGrantType(AuthorizationGrantType.CLIENT_CREDENTIALS)
                .tokenUri(baseUrl + "/realms/giaokhoa/protocol/openid-connect/token")
                .build();
        InMemoryClientRegistrationRepository repository = new InMemoryClientRegistrationRepository(registration);
        AuthorizedClientServiceOAuth2AuthorizedClientManager manager =
                new AuthorizedClientServiceOAuth2AuthorizedClientManager(
                        repository, new InMemoryOAuth2AuthorizedClientService(repository));
        manager.setAuthorizedClientProvider(OAuth2AuthorizedClientProviderBuilder.builder()
                .clientCredentials().build());
        return manager;
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
            // Never report a revocation as synchronized without identifying its source group.
            throw new IllegalStateException("Cannot revoke membership: realm group does not exist: " + groupPath);
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
        // Exact path lookup avoids pagination and name collisions across workspaces.
        URI uri = URI.create(endpoint("group-by-path") + path);
        try {
            Group group = get(uri, Group.class);
            if (!path.equals(group.path()) || group.id() == null || group.id().isBlank()) {
                throw new IllegalStateException("Keycloak returned a group for an unexpected path");
            }
            return group;
        } catch (RestClientResponseException ex) {
            if (ex.getStatusCode().value() == 404) {
                return null;
            }
            throw ex;
        }
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
        var client = manager.authorize(OAuth2AuthorizeRequest.withClientRegistrationId("giaokhoa-provisioner")
                .principal("giaokhoa-provisioner").build());
        if (client == null || client.getAccessToken() == null) {
            throw new IllegalStateException("Keycloak provisioner cannot obtain an access token");
        }
        return client.getAccessToken().getTokenValue();
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

    private record Group(String id, String name, String path) { }

    private record Organization(String id, String name, String alias) { }
}
