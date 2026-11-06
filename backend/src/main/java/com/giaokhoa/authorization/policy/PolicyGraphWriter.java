package com.giaokhoa.authorization.policy;

import java.net.URI;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.client.AuthorizedClientServiceOAuth2AuthorizedClientManager;
import org.springframework.security.oauth2.client.InMemoryOAuth2AuthorizedClientService;
import org.springframework.security.oauth2.client.OAuth2AuthorizeRequest;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClientManager;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClientProviderBuilder;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.InMemoryClientRegistrationRepository;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.util.UriComponentsBuilder;
import tools.jackson.databind.json.JsonMapper;

/**
 * Writes a {@link PolicyGraph} into the native Keycloak authorization graph of the resource server,
 * using the provisioner credential. Every object is looked up by its deterministic template name
 * before creation, so applying the same graph twice converges without duplicates; the root
 * permission is compared and updated when a new revision changes its policy set. The graph is read
 * back before the result is returned: a sent request is never treated as proof. Leaf policies are
 * shared between graphs and are never deleted here.
 */
@Component
public class PolicyGraphWriter {
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final String POSITIVE = "POSITIVE";
    private static final String NEGATIVE = "NEGATIVE";
    private static final String UNANIMOUS = "UNANIMOUS";
    private static final String AFFIRMATIVE = "AFFIRMATIVE";
    private static final int SINGLE = 1;
    private static final ParameterizedTypeReference<List<Map<String, Object>>> MAP_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Map<String, Object>> MAP =
            new ParameterizedTypeReference<>() {};

    private final RestClient http;
    private final String baseUrl;
    private final OAuth2AuthorizedClientManager manager;
    private final String audienceClientId;
    private String cachedRoot;

    @Autowired
    public PolicyGraphWriter(
            @Value("${giaokhoa.keycloak.admin-base-url}") String baseUrl,
            @Value("${giaokhoa.keycloak.provisioner.client-id}") String clientId,
            @Value("${giaokhoa.keycloak.provisioner.client-secret}") String clientSecret,
            @Value("${giaokhoa.keycloak.authorization-audience}") String audienceClientId) {
        this(
                RestClient.builder(),
                baseUrl,
                provisionerManager(baseUrl.replaceAll("/+$", ""), clientId, clientSecret),
                audienceClientId);
    }

    PolicyGraphWriter(
            RestClient.Builder builder,
            String baseUrl,
            OAuth2AuthorizedClientManager manager,
            String audienceClientId) {
        this.http = builder.build();
        this.baseUrl = baseUrl.replaceAll("/+$", "");
        this.manager = manager;
        this.audienceClientId = audienceClientId;
    }

    private static OAuth2AuthorizedClientManager provisionerManager(
            String baseUrl, String clientId, String secret) {
        ClientRegistration registration =
                ClientRegistration.withRegistrationId("giaokhoa-provisioner")
                        .clientId(clientId)
                        .clientSecret(secret)
                        .clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_POST)
                        .authorizationGrantType(AuthorizationGrantType.CLIENT_CREDENTIALS)
                        .tokenUri(baseUrl + "/realms/giaokhoa/protocol/openid-connect/token")
                        .build();
        InMemoryClientRegistrationRepository repository =
                new InMemoryClientRegistrationRepository(registration);
        AuthorizedClientServiceOAuth2AuthorizedClientManager manager =
                new AuthorizedClientServiceOAuth2AuthorizedClientManager(
                        repository, new InMemoryOAuth2AuthorizedClientService(repository));
        manager.setAuthorizedClientProvider(
                OAuth2AuthorizedClientProviderBuilder.builder().clientCredentials().build());
        return manager;
    }

    /** What a successful apply leaves behind: the projection resource ID and its policy names. */
    public record AppliedGraph(String resourceId, List<String> policyNames) {
        public AppliedGraph {
            policyNames = List.copyOf(policyNames);
        }
    }

    /** Creates or updates the whole graph of one target/scope pair, then verifies it by reading. */
    public AppliedGraph apply(PolicyGraph graph) {
        String root = resourceServerRoot();
        String scopeId = ensureScope(root, graph.scope());
        String resourceId = ensureResource(root, graph.targetKey(), scopeId);
        Map<String, Map<String, Object>> policies = policyIndex(root);

        Set<String> policyNames = new TreeSet<>();
        List<String> rootPolicies = new ArrayList<>();
        for (PolicyGraph.Gate gate : graph.commonGates()) {
            rootPolicies.addAll(gatePolicies(root, policies, gate, policyNames));
        }
        List<String> sourceNodes = new ArrayList<>();
        for (PolicyGraph.Source source : graph.sources()) {
            List<String> leaves = new ArrayList<>();
            for (PolicyGraph.Gate gate : source.gates()) {
                leaves.addAll(gatePolicies(root, policies, gate, policyNames));
            }
            if (leaves.size() == SINGLE) {
                sourceNodes.add(leaves.getFirst());
            } else {
                String name = NativePolicyTemplates.sourcePolicyName(source.descriptorHash());
                sourceNodes.add(
                        ensurePolicy(
                                root,
                                policies,
                                name,
                                "aggregate",
                                aggregate(name, UNANIMOUS, leaves)));
                policyNames.add(name);
            }
        }
        if (sourceNodes.size() > SINGLE) {
            String name =
                    NativePolicyTemplates.anySourcePolicyName(graph.targetKey(), graph.scope());
            rootPolicies.add(ensureAggregate(root, policies, name, AFFIRMATIVE, sourceNodes));
            policyNames.add(name);
        } else {
            rootPolicies.add(sourceNodes.getFirst());
        }

        String permissionName =
                NativePolicyTemplates.rootPermissionName(graph.targetKey(), graph.scope());
        String permissionId =
                ensureRootPermission(root, permissionName, resourceId, scopeId, rootPolicies);
        verifyReadBack(root, permissionId, resourceId, scopeId, rootPolicies, graph.targetKey());
        return new AppliedGraph(resourceId, List.copyOf(policyNames));
    }

    /**
     * Removes the root permission of one target/scope pair, and with it the pair's own OR
     * aggregate: by construction that aggregate is referenced only by this root permission. Shared
     * leaf policies stay for the graphs that still use them.
     */
    public void retractRoot(String targetKey, String scope) {
        // The same fixed-template validation as the graph: unknown targets never reach Keycloak.
        NativePolicyTemplates.TargetType type =
                NativePolicyTemplates.targetTypeOf(targetKey)
                        .orElseThrow(() ->
                                new IllegalArgumentException(
                                        "Target key matches no fixed template: " + targetKey));
        if (scope == null || !type.scopes().contains(scope)) {
            throw new IllegalArgumentException(
                    "Scope is not fixed for target " + targetKey + ": " + scope);
        }
        String root = resourceServerRoot();
        String permissionName = NativePolicyTemplates.rootPermissionName(targetKey, scope);
        for (Map<String, Object> permission : list(root + "/permission/scope")) {
            if (permissionName.equals(permission.get("name"))) {
                delete(root + "/permission/scope/" + permission.get("id"));
            }
        }
        String anyName = NativePolicyTemplates.anySourcePolicyName(targetKey, scope);
        for (Map<String, Object> policy : list(root + "/policy")) {
            if (anyName.equals(policy.get("name"))) {
                delete(root + "/policy/" + policy.get("id"));
            }
        }
    }

    private List<String> gatePolicies(
            String root,
            Map<String, Map<String, Object>> policies,
            PolicyGraph.Gate gate,
            Set<String> policyNames) {
        if (gate instanceof PolicyGraph.Gate.GroupMembership group) {
            String groupId = realmGroupId(group.groupPath());
            String name = NativePolicyTemplates.groupPolicyName(group.groupPath());
            policyNames.add(name);
            return List.of(
                    ensurePolicy(
                            root,
                            policies,
                            name,
                            "group",
                            Map.of(
                                    "name",
                                    name,
                                    "type",
                                    "group",
                                    "logic",
                                    POSITIVE,
                                    "decisionStrategy",
                                    UNANIMOUS,
                                    "groups",
                                    List.of(Map.of("id", groupId, "extendChildren", false)))));
        }
        if (gate instanceof PolicyGraph.Gate.Actor actor) {
            String name = NativePolicyTemplates.userPolicyName(actor.keycloakUserId());
            policyNames.add(name);
            return List.of(
                    ensurePolicy(
                            root,
                            policies,
                            name,
                            "user",
                            Map.of(
                                    "name", name,
                                    "type", "user",
                                    "logic", POSITIVE,
                                    "decisionStrategy", UNANIMOUS,
                                    "users", List.of(actor.keycloakUserId()))));
        }
        if (gate instanceof PolicyGraph.Gate.Validity validity) {
            // [start, end): POSITIVE not-before at the start, NEGATIVE not-before at the end.
            // A single notOnOrAfter would still allow the exact end instant.
            List<String> ids = new ArrayList<>();
            if (validity.validFrom() != null) {
                String name = NativePolicyTemplates.validFromPolicyName(validity.validFrom());
                policyNames.add(name);
                ids.add(
                        ensurePolicy(
                                root,
                                policies,
                                name,
                                "time",
                                Map.of(
                                        "name",
                                        name,
                                        "type",
                                        "time",
                                        "logic",
                                        POSITIVE,
                                        "notBefore",
                                        NativePolicyTemplates.KEYCLOAK_UTC.format(
                                                validity.validFrom()))));
            }
            if (validity.expiresAt() != null) {
                String name = NativePolicyTemplates.validUntilPolicyName(validity.expiresAt());
                policyNames.add(name);
                ids.add(
                        ensurePolicy(
                                root,
                                policies,
                                name,
                                "time",
                                Map.of(
                                        "name",
                                        name,
                                        "type",
                                        "time",
                                        "logic",
                                        NEGATIVE,
                                        "notBefore",
                                        NativePolicyTemplates.KEYCLOAK_UTC.format(
                                                validity.expiresAt()))));
            }
            return ids;
        }
        throw new IllegalStateException("Unsupported gate: " + gate);
    }

    private Map<String, Object> aggregate(
            String name, String decisionStrategy, List<String> policyIds) {
        return Map.of(
                "name", name,
                "type", "aggregate",
                "logic", POSITIVE,
                "decisionStrategy", decisionStrategy,
                "policies", policyIds);
    }

    private String ensurePolicy(
            String root,
            Map<String, Map<String, Object>> policies,
            String name,
            String type,
            Map<String, Object> payload) {
        Map<String, Object> existing = policies.get(name);
        if (existing != null) {
            if (!type.equals(existing.get("type"))) {
                throw new IllegalStateException(
                        "Native policy name collision with another type: " + name);
            }
            return String.valueOf(existing.get("id"));
        }
        String id = create(root + "/policy/" + type, payload);
        Map<String, Object> created = new LinkedHashMap<>(payload);
        created.put("id", id);
        policies.put(name, created);
        return id;
    }

    /** Aggregates named after their target are compared, because a new revision may rewire them. */
    private String ensureAggregate(
            String root,
            Map<String, Map<String, Object>> policies,
            String name,
            String decisionStrategy,
            List<String> policyIds) {
        Map<String, Object> payload = aggregate(name, decisionStrategy, policyIds);
        Map<String, Object> existing = policies.get(name);
        if (existing == null) {
            String id = create(root + "/policy/aggregate", payload);
            Map<String, Object> created = new LinkedHashMap<>(payload);
            created.put("id", id);
            policies.put(name, created);
            return id;
        }
        if (!"aggregate".equals(existing.get("type"))) {
            throw new IllegalStateException(
                    "Native policy name collision with another type: " + name);
        }
        String id = String.valueOf(existing.get("id"));
        Map<String, Object> current = get(root + "/policy/aggregate/" + id);
        if (!new HashSet<>(ids(current.get("policies"))).equals(new HashSet<>(policyIds))) {
            Map<String, Object> update = new LinkedHashMap<>(payload);
            update.put("id", id);
            put(root + "/policy/aggregate/" + id, update);
        }
        return id;
    }

    private String ensureScope(String root, String scope) {
        for (Map<String, Object> existing : list(root + "/scope")) {
            if (scope.equals(existing.get("name"))) {
                return String.valueOf(existing.get("id"));
            }
        }
        return create(root + "/scope", Map.of("name", scope));
    }

    private String ensureResource(String root, String targetKey, String scopeId) {
        for (Map<String, Object> existing : list(root + "/resource")) {
            if (targetKey.equals(existing.get("name"))) {
                String id = String.valueOf(existing.get("_id"));
                Map<String, Object> current = get(root + "/resource/" + id);
                List<String> scopeIds = ids(current.get("scopes"), "id");
                if (!scopeIds.contains(scopeId)) {
                    scopeIds.add(scopeId);
                    List<Map<String, String>> scopes = new ArrayList<>();
                    for (String existingScope : scopeIds) {
                        scopes.add(Map.of("id", existingScope));
                    }
                    Map<String, Object> update = new LinkedHashMap<>();
                    update.put("_id", id);
                    update.put("name", targetKey);
                    update.put("ownerManagedAccess", false);
                    update.put("scopes", scopes);
                    put(root + "/resource/" + id, update);
                }
                return id;
            }
        }
        return create(
                root + "/resource",
                Map.of(
                        "name",
                        targetKey,
                        "ownerManagedAccess",
                        false,
                        "scopes",
                        List.of(Map.of("id", scopeId))));
    }

    private String ensureRootPermission(
            String root, String name, String resourceId, String scopeId, List<String> policyIds) {
        Map<String, Object> desired =
                Map.of(
                        "name", name,
                        "type", "scope",
                        "logic", POSITIVE,
                        "decisionStrategy", UNANIMOUS,
                        "resources", List.of(resourceId),
                        "scopes", List.of(scopeId),
                        "policies", policyIds);
        for (Map<String, Object> existing : list(root + "/permission/scope")) {
            if (name.equals(existing.get("name"))) {
                String id = String.valueOf(existing.get("id"));
                boolean same =
                        new HashSet<>(ids(existing.get("policies")))
                                        .equals(new HashSet<>(policyIds))
                                && new HashSet<>(ids(existing.get("resources")))
                                        .equals(Set.of(resourceId))
                                && new HashSet<>(ids(existing.get("scopes")))
                                        .equals(Set.of(scopeId));
                if (!same) {
                    Map<String, Object> update = new LinkedHashMap<>(desired);
                    update.put("id", id);
                    put(root + "/permission/scope/" + id, update);
                }
                return id;
            }
        }
        return create(root + "/permission/scope", desired);
    }

    private void verifyReadBack(
            String root,
            String permissionId,
            String resourceId,
            String scopeId,
            List<String> policyIds,
            String targetKey) {
        Map<String, Object> permission = get(root + "/permission/scope/" + permissionId);
        Map<String, Object> resource = get(root + "/resource/" + resourceId);
        boolean verified =
                new HashSet<>(ids(permission.get("policies"))).equals(new HashSet<>(policyIds))
                        && ids(permission.get("resources")).contains(resourceId)
                        && ids(permission.get("scopes")).contains(scopeId)
                        && targetKey.equals(resource.get("name"))
                        && ids(resource.get("scopes"), "id").contains(scopeId);
        if (!verified) {
            throw new IllegalStateException(
                    "Native policy graph read-back does not match the desired graph for "
                            + targetKey);
        }
    }

    private Map<String, Map<String, Object>> policyIndex(String root) {
        Map<String, Map<String, Object>> index = new LinkedHashMap<>();
        for (Map<String, Object> policy : list(root + "/policy")) {
            index.put(String.valueOf(policy.get("name")), policy);
        }
        return index;
    }

    private String realmGroupId(String path) {
        URI uri = URI.create(baseUrl + "/admin/realms/giaokhoa/group-by-path" + path);
        try {
            Map<String, Object> group = get(uri, MAP);
            if (!path.equals(group.get("path")) || group.get("id") == null) {
                throw new IllegalStateException("Keycloak returned a group for an unexpected path");
            }
            return String.valueOf(group.get("id"));
        } catch (RestClientResponseException ex) {
            if (ex.getStatusCode().isSameCodeAs(HttpStatus.NOT_FOUND)) {
                // Groups are directory projections; the graph writer never invents them.
                throw new IllegalStateException("Realm group is not provisioned: " + path, ex);
            }
            throw ex;
        }
    }

    private String resourceServerRoot() {
        if (cachedRoot != null) {
            return cachedRoot;
        }
        URI uri =
                UriComponentsBuilder.fromUriString(baseUrl)
                        .pathSegment("admin", "realms", "giaokhoa", "clients")
                        .queryParam("clientId", audienceClientId)
                        .build()
                        .encode()
                        .toUri();
        List<Map<String, Object>> clients = get(uri, MAP_LIST);
        if (clients.size() != SINGLE || clients.getFirst().get("id") == null) {
            throw new IllegalStateException(
                    "Expected exactly one resource server client: " + audienceClientId);
        }
        cachedRoot =
                baseUrl
                        + "/admin/realms/giaokhoa/clients/"
                        + clients.getFirst().get("id")
                        + "/authz/resource-server";
        return cachedRoot;
    }

    private String accessToken() {
        var client =
                manager.authorize(
                        OAuth2AuthorizeRequest.withClientRegistrationId("giaokhoa-provisioner")
                                .principal("giaokhoa-provisioner")
                                .build());
        if (client == null || client.getAccessToken() == null) {
            throw new IllegalStateException("Keycloak provisioner cannot obtain an access token");
        }
        return client.getAccessToken().getTokenValue();
    }

    private List<Map<String, Object>> list(String path) {
        return get(path + "?first=0&max=1000", MAP_LIST);
    }

    private Map<String, Object> get(String path) {
        return get(uri(path), MAP);
    }

    private <T> T get(URI uri, ParameterizedTypeReference<T> type) {
        T body =
                http.get()
                        .uri(uri)
                        .headers(headers -> headers.setBearerAuth(accessToken()))
                        .retrieve()
                        .body(type);
        if (body == null) {
            throw new IllegalStateException("Empty Keycloak authorization response");
        }
        return body;
    }

    private <T> T get(String path, ParameterizedTypeReference<T> type) {
        return get(uri(path), type);
    }

    /** Paths are either absolute (already containing the base URL) or realm-relative. */
    private URI uri(String path) {
        return URI.create(path.startsWith("http") ? path : baseUrl + path);
    }

    private String create(String path, Map<String, Object> payload) {
        var response =
                http.post()
                        .uri(uri(path))
                        .headers(headers -> headers.setBearerAuth(accessToken()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .body(payload)
                        .retrieve()
                        .toEntity(String.class);
        URI location = response.getHeaders().getLocation();
        if (location != null) {
            String value = location.getPath();
            return value.substring(value.lastIndexOf('/') + 1);
        }
        // Authorization Services POST returns the created ID in the JSON body instead.
        if (response.getBody() == null) {
            throw new IllegalStateException("Keycloak returned no created ID for " + path);
        }
        var created = JSON.readTree(response.getBody());
        var id = created.has("id") ? created.get("id") : created.get("_id");
        if (id == null) {
            throw new IllegalStateException("Keycloak returned no created ID for " + path);
        }
        return id.stringValue();
    }

    private void put(String path, Map<String, Object> payload) {
        http.put()
                .uri(uri(path))
                .headers(headers -> headers.setBearerAuth(accessToken()))
                .contentType(MediaType.APPLICATION_JSON)
                .body(payload)
                .retrieve()
                .toBodilessEntity();
    }

    private void delete(String path) {
        http.delete()
                .uri(uri(path))
                .headers(headers -> headers.setBearerAuth(accessToken()))
                .retrieve()
                .toBodilessEntity();
    }

    /** IDs of a JSON field that is either a list of plain IDs or of objects carrying an ID key. */
    private static List<String> ids(Object field) {
        return ids(field, null);
    }

    private static List<String> ids(Object field, String key) {
        List<String> out = new ArrayList<>();
        if (field instanceof List<?> list) {
            for (Object item : list) {
                if (item instanceof Map<?, ?> map && key != null) {
                    out.add(String.valueOf(map.get(key)));
                } else if (item instanceof Map<?, ?> map) {
                    Object id = map.containsKey("id") ? map.get("id") : map.get("_id");
                    out.add(String.valueOf(id));
                } else if (item != null) {
                    out.add(String.valueOf(item));
                }
            }
        }
        return out;
    }
}
