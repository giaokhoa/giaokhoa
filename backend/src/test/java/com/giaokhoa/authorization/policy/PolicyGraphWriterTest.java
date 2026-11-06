package com.giaokhoa.authorization.policy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withNoContent;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.giaokhoa.authorization.policy.PolicyGraph.Gate;
import com.giaokhoa.authorization.policy.PolicyGraph.Source;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClient;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClientManager;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.OAuth2AccessToken;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class PolicyGraphWriterTest {
    private static final String HOST = "http://keycloak.test";
    private static final String CLIENTS =
            HOST + "/admin/realms/giaokhoa/clients?clientId=giaokhoa-api";
    private static final String ROOT =
            HOST + "/admin/realms/giaokhoa/clients/api-uuid/authz/resource-server";
    private static final String LIST = "?first=0&max=1000";
    private static final String PAGE2 = "?first=1000&max=1000";
    private static final UUID WORKSPACE = UUID.fromString("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    private static final String TARGET = "workspace:" + WORKSPACE;
    private static final String ELIGIBLE = "/gk/identity/eligible";
    private static final String OWNERS = "/gk/workspaces/" + WORKSPACE + "/owners";
    private static final String MANAGERS = "/gk/workspaces/" + WORKSPACE + "/managers";
    private static final Instant FROM = Instant.parse("2030-01-01T00:00:00Z");
    private static final Instant UNTIL = Instant.parse("2030-02-01T00:00:00Z");
    private static final Source MANAGER_SOURCE =
            Source.of(new Gate.GroupMembership(MANAGERS), new Gate.Validity(FROM, UNTIL));
    private static final String SOURCE_NAME = "gk-source:" + MANAGER_SOURCE.descriptorHash();
    private static final String ANY_NAME = "gk-any:" + TARGET + "#enter";
    private static final String ROOT_NAME = "gk-root:" + TARGET + "#enter";

    /** Eligibility gate outside the OR; owner alone, or manager inside a validity window. */
    private static PolicyGraph graph() {
        return PolicyGraph.forEligibleActor(
                TARGET,
                "enter",
                List.of(Source.of(new Gate.GroupMembership(OWNERS)), MANAGER_SOURCE));
    }

    @Test
    void writesTheWholeGraphAndReadsItBack() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        PolicyGraphWriter writer = writer(builder);

        expectClients(server);
        expectGet(server, ROOT + "/scope" + LIST, "[]");
        expectCreate(server, ROOT + "/scope", "{\"id\":\"scope-enter\"}");
        expectGet(server, ROOT + "/resource" + LIST, "[]");
        expectCreate(server, ROOT + "/resource", "{\"_id\":\"res-1\"}");
        expectGet(server, ROOT + "/policy" + LIST, "[]");
        expectGroup(server, ELIGIBLE, "g-elig");
        expectCreate(
                server,
                ROOT + "/policy/group",
                "{\"id\":\"pol-elig\"}",
                "{\"name\":\"gk-group:"
                        + ELIGIBLE
                        + "\",\"groups\":[{\"id\":\"g-elig\",\"extendChildren\":false}]}");
        expectGroup(server, MANAGERS, "g-mgr");
        expectCreate(server, ROOT + "/policy/group", "{\"id\":\"pol-mgr\"}");
        expectCreate(
                server,
                ROOT + "/policy/time",
                "{\"id\":\"pol-from\"}",
                "{\"name\":\"gk-valid-from:"
                        + FROM
                        + "\",\"logic\":\"POSITIVE\",\"notBefore\":\"2030-01-01 00:00:00\"}");
        expectCreate(
                server,
                ROOT + "/policy/time",
                "{\"id\":\"pol-until\"}",
                "{\"name\":\"gk-valid-until:"
                        + UNTIL
                        + "\",\"logic\":\"NEGATIVE\",\"notBefore\":\"2030-02-01 00:00:00\"}");
        expectCreate(
                server,
                ROOT + "/policy/aggregate",
                "{\"id\":\"pol-src\"}",
                "{\"name\":\""
                        + SOURCE_NAME
                        + "\",\"decisionStrategy\":\"UNANIMOUS\","
                        + "\"policies\":[\"pol-mgr\",\"pol-from\",\"pol-until\"]}");
        expectGroup(server, OWNERS, "g-own");
        expectCreate(server, ROOT + "/policy/group", "{\"id\":\"pol-own\"}");
        expectCreate(
                server,
                ROOT + "/policy/aggregate",
                "{\"id\":\"pol-any\"}",
                "{\"name\":\""
                        + ANY_NAME
                        + "\",\"decisionStrategy\":\"AFFIRMATIVE\","
                        + "\"policies\":[\"pol-src\",\"pol-own\"]}");
        expectGet(server, ROOT + "/permission/scope" + LIST, "[]");
        expectCreate(
                server,
                ROOT + "/permission/scope",
                "{\"id\":\"perm-1\"}",
                "{\"name\":\""
                        + ROOT_NAME
                        + "\",\"decisionStrategy\":\"UNANIMOUS\","
                        + "\"resources\":[\"res-1\"],\"scopes\":[\"scope-enter\"],"
                        + "\"policies\":[\"pol-elig\",\"pol-any\"]}");
        expectReadBack(server, "perm-1", List.of("pol-elig", "pol-any"));

        PolicyGraphWriter.AppliedGraph applied = writer.apply(graph());

        assertEquals("res-1", applied.resourceId());
        assertEquals(
                List.of(
                        ANY_NAME,
                        "gk-group:" + ELIGIBLE,
                        "gk-group:" + MANAGERS,
                        "gk-group:" + OWNERS,
                        SOURCE_NAME,
                        "gk-valid-from:" + FROM,
                        "gk-valid-until:" + UNTIL),
                applied.policyNames());
        server.verify();
    }

    @Test
    void reapplyingTheSameGraphCreatesAndUpdatesNothing() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        PolicyGraphWriter writer = writer(builder);

        expectClients(server);
        expectGet(server, ROOT + "/scope" + LIST, "[{\"id\":\"scope-enter\",\"name\":\"enter\"}]");
        expectGet(
                server,
                ROOT + "/resource" + LIST,
                "[{\"_id\":\"res-1\",\"name\":\"" + TARGET + "\"}]");
        expectGet(
                server,
                ROOT + "/resource/res-1",
                "{\"_id\":\"res-1\",\"name\":\""
                        + TARGET
                        + "\",\"scopes\":[{\"id\":\"scope-enter\",\"name\":\"enter\"}]}");
        expectGet(
                server,
                ROOT + "/policy" + LIST,
                "[{\"id\":\"pol-elig\",\"name\":\"gk-group:"
                        + ELIGIBLE
                        + "\",\"type\":\"group\"},"
                        + "{\"id\":\"pol-mgr\",\"name\":\"gk-group:"
                        + MANAGERS
                        + "\",\"type\":\"group\"},"
                        + "{\"id\":\"pol-own\",\"name\":\"gk-group:"
                        + OWNERS
                        + "\",\"type\":\"group\"},"
                        + "{\"id\":\"pol-from\",\"name\":\"gk-valid-from:"
                        + FROM
                        + "\",\"type\":\"time\"},"
                        + "{\"id\":\"pol-until\",\"name\":\"gk-valid-until:"
                        + UNTIL
                        + "\",\"type\":\"time\"},"
                        + "{\"id\":\"pol-src\",\"name\":\""
                        + SOURCE_NAME
                        + "\",\"type\":\"aggregate\"},"
                        + "{\"id\":\"pol-any\",\"name\":\""
                        + ANY_NAME
                        + "\",\"type\":\"aggregate\"}]");
        expectGroup(server, ELIGIBLE, "g-elig");
        expectGroup(server, MANAGERS, "g-mgr");
        expectGroup(server, OWNERS, "g-own");
        expectAssociated(
                server, "pol-any", "associatedPolicies", List.of("pol-src", "pol-own"), "id");
        expectGet(
                server,
                ROOT + "/permission/scope" + LIST,
                "[{\"id\":\"perm-1\",\"name\":\"" + ROOT_NAME + "\"}]");
        expectLinked(server, "perm-1", List.of("pol-elig", "pol-any"));
        expectReadBack(server, "perm-1", List.of("pol-elig", "pol-any"));

        PolicyGraphWriter.AppliedGraph applied = writer.apply(graph());
        assertEquals("res-1", applied.resourceId());
        assertEquals(7, applied.policyNames().size());
        server.verify();
    }

    @Test
    void updatesResourceScopesAndStaleRootPoliciesForANewRevision() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        PolicyGraphWriter writer = writer(builder);
        PolicyGraph graph =
                new PolicyGraph(
                        TARGET, "enter", List.of(Source.of(new Gate.GroupMembership(OWNERS))));

        expectClients(server);
        expectGet(server, ROOT + "/scope" + LIST, "[{\"id\":\"scope-enter\",\"name\":\"enter\"}]");
        expectGet(
                server,
                ROOT + "/resource" + LIST,
                "[{\"_id\":\"res-1\",\"name\":\"" + TARGET + "\"}]");
        expectGet(
                server,
                ROOT + "/resource/res-1",
                "{\"_id\":\"res-1\",\"name\":\"" + TARGET + "\",\"scopes\":[]}");
        server.expect(requestTo(ROOT + "/resource/res-1"))
                .andExpect(method(HttpMethod.PUT))
                .andExpect(
                        content()
                                .json(
                                        "{\"_id\":\"res-1\",\"name\":\""
                                                + TARGET
                                                + "\",\"scopes\":[{\"id\":\"scope-enter\"}]}"))
                .andRespond(withNoContent());
        expectGet(
                server,
                ROOT + "/policy" + LIST,
                "[{\"id\":\"pol-own\",\"name\":\"gk-group:" + OWNERS + "\",\"type\":\"group\"}]");
        expectGroup(server, OWNERS, "g-own");
        expectGet(
                server,
                ROOT + "/permission/scope" + LIST,
                "[{\"id\":\"perm-1\",\"name\":\"" + ROOT_NAME + "\"}]");
        expectLinked(server, "perm-1", List.of("pol-stale"));
        server.expect(requestTo(ROOT + "/permission/scope/perm-1"))
                .andExpect(method(HttpMethod.PUT))
                .andExpect(
                        content()
                                .json(
                                        "{\"id\":\"perm-1\",\"name\":\""
                                                + ROOT_NAME
                                                + "\",\"policies\":[\"pol-own\"]}"))
                .andRespond(withNoContent());
        expectReadBack(server, "perm-1", List.of("pol-own"));

        PolicyGraphWriter.AppliedGraph applied = writer.apply(graph);
        assertEquals(List.of("gk-group:" + OWNERS), applied.policyNames());
        server.verify();
    }

    @Test
    void retractRemovesOnlyTheRootPermissionAndItsOrAggregate() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        PolicyGraphWriter writer = writer(builder);

        expectClients(server);
        expectGet(
                server,
                ROOT + "/permission/scope" + LIST,
                "[{\"id\":\"perm-1\",\"name\":\"" + ROOT_NAME + "\"}]");
        server.expect(requestTo(ROOT + "/permission/scope/perm-1"))
                .andExpect(method(HttpMethod.DELETE))
                .andRespond(withNoContent());
        expectGet(
                server,
                ROOT + "/policy" + LIST,
                "[{\"id\":\"pol-any\",\"name\":\""
                        + ANY_NAME
                        + "\",\"type\":\"aggregate\"},"
                        + "{\"id\":\"pol-own\",\"name\":\"gk-group:"
                        + OWNERS
                        + "\",\"type\":\"group\"}]");
        server.expect(requestTo(ROOT + "/policy/pol-any"))
                .andExpect(method(HttpMethod.DELETE))
                .andRespond(withNoContent());

        writer.retractRoot(TARGET, "enter");
        server.verify();

        assertThrows(
                IllegalArgumentException.class, () -> writer.retractRoot(TARGET, "content.read"));
    }

    @Test
    void failsWhenARealmGroupIsNotProvisioned() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        PolicyGraphWriter writer = writer(builder);
        PolicyGraph graph =
                new PolicyGraph(
                        TARGET, "enter", List.of(Source.of(new Gate.GroupMembership(OWNERS))));

        expectClients(server);
        expectGet(server, ROOT + "/scope" + LIST, "[]");
        expectCreate(server, ROOT + "/scope", "{\"id\":\"scope-enter\"}");
        expectGet(server, ROOT + "/resource" + LIST, "[]");
        expectCreate(server, ROOT + "/resource", "{\"_id\":\"res-1\"}");
        expectGet(server, ROOT + "/policy" + LIST, "[]");
        server.expect(requestTo(HOST + "/admin/realms/giaokhoa/group-by-path" + OWNERS))
                .andExpect(method(HttpMethod.GET))
                .andRespond(withStatus(HttpStatus.NOT_FOUND));

        assertThrows(IllegalStateException.class, () -> writer.apply(graph));
        server.verify();
    }

    @Test
    void usesTheExistingPolicyWhenAConcurrentCreateConflicts() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        PolicyGraphWriter writer = writer(builder);
        PolicyGraph graph =
                PolicyGraph.forEligibleActor(
                        TARGET, "enter", List.of(Source.of(new Gate.GroupMembership(OWNERS))));

        expectClients(server);
        expectGet(server, ROOT + "/scope" + LIST, "[]");
        expectCreate(server, ROOT + "/scope", "{\"id\":\"scope-enter\"}");
        expectGet(server, ROOT + "/resource" + LIST, "[]");
        expectCreate(server, ROOT + "/resource", "{\"_id\":\"res-1\"}");
        expectGet(server, ROOT + "/policy" + LIST, "[]");
        expectGroup(server, ELIGIBLE, "g-elig");
        // A concurrent apply created the shared eligibility policy first.
        server.expect(requestTo(ROOT + "/policy/group"))
                .andExpect(method(HttpMethod.POST))
                .andRespond(withStatus(HttpStatus.CONFLICT));
        expectGet(
                server,
                ROOT + "/policy" + LIST,
                "[{\"id\":\"pol-elig\",\"name\":\"gk-group:"
                        + ELIGIBLE
                        + "\",\"type\":\"group\"}]");
        expectGroup(server, OWNERS, "g-own");
        expectCreate(server, ROOT + "/policy/group", "{\"id\":\"pol-own\"}");
        expectGet(server, ROOT + "/permission/scope" + LIST, "[]");
        expectCreate(
                server,
                ROOT + "/permission/scope",
                "{\"id\":\"perm-1\"}",
                "{\"name\":\"" + ROOT_NAME + "\",\"policies\":[\"pol-elig\",\"pol-own\"]}");
        expectReadBack(server, "perm-1", List.of("pol-elig", "pol-own"));

        PolicyGraphWriter.AppliedGraph applied = writer.apply(graph);
        assertEquals(List.of("gk-group:" + ELIGIBLE, "gk-group:" + OWNERS), applied.policyNames());
        server.verify();
    }

    @Test
    void usesTheExistingAggregateWhenAConcurrentCreateConflicts() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        PolicyGraphWriter writer = writer(builder);
        PolicyGraph graph =
                new PolicyGraph(
                        TARGET,
                        "enter",
                        List.of(
                                Source.of(new Gate.GroupMembership(OWNERS)),
                                Source.of(new Gate.GroupMembership(MANAGERS))));

        expectClients(server);
        expectGet(server, ROOT + "/scope" + LIST, "[]");
        expectCreate(server, ROOT + "/scope", "{\"id\":\"scope-enter\"}");
        expectGet(server, ROOT + "/resource" + LIST, "[]");
        expectCreate(server, ROOT + "/resource", "{\"_id\":\"res-1\"}");
        expectGet(server, ROOT + "/policy" + LIST, "[]");
        expectGroup(server, MANAGERS, "g-mgr");
        expectCreate(server, ROOT + "/policy/group", "{\"id\":\"pol-mgr\"}");
        expectGroup(server, OWNERS, "g-own");
        expectCreate(server, ROOT + "/policy/group", "{\"id\":\"pol-own\"}");
        // A concurrent apply created this pair's OR aggregate first.
        server.expect(requestTo(ROOT + "/policy/aggregate"))
                .andExpect(method(HttpMethod.POST))
                .andRespond(withStatus(HttpStatus.CONFLICT));
        expectGet(
                server,
                ROOT + "/policy" + LIST,
                "[{\"id\":\"pol-mgr\",\"name\":\"gk-group:"
                        + MANAGERS
                        + "\",\"type\":\"group\"},"
                        + "{\"id\":\"pol-own\",\"name\":\"gk-group:"
                        + OWNERS
                        + "\",\"type\":\"group\"},"
                        + "{\"id\":\"pol-any\",\"name\":\""
                        + ANY_NAME
                        + "\",\"type\":\"aggregate\"}]");
        expectAssociated(
                server, "pol-any", "associatedPolicies", List.of("pol-mgr", "pol-own"), "id");
        expectGet(server, ROOT + "/permission/scope" + LIST, "[]");
        expectCreate(
                server,
                ROOT + "/permission/scope",
                "{\"id\":\"perm-1\"}",
                "{\"name\":\"" + ROOT_NAME + "\",\"policies\":[\"pol-any\"]}");
        expectReadBack(server, "perm-1", List.of("pol-any"));

        PolicyGraphWriter.AppliedGraph applied = writer.apply(graph);
        assertEquals(
                List.of(ANY_NAME, "gk-group:" + MANAGERS, "gk-group:" + OWNERS),
                applied.policyNames());
        server.verify();
    }

    @Test
    void findsTheScopeOnTheSecondPageWhenApplying() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        PolicyGraphWriter writer = writer(builder);
        PolicyGraph graph =
                new PolicyGraph(
                        TARGET, "enter", List.of(Source.of(new Gate.GroupMembership(OWNERS))));

        expectClients(server);
        expectGet(server, ROOT + "/scope" + LIST, dummyPage("scope", 1000));
        expectGet(server, ROOT + "/scope" + PAGE2, "[{\"id\":\"scope-enter\",\"name\":\"enter\"}]");
        expectGet(server, ROOT + "/resource" + LIST, "[]");
        expectCreate(server, ROOT + "/resource", "{\"_id\":\"res-1\"}");
        expectGet(server, ROOT + "/policy" + LIST, "[]");
        expectGroup(server, OWNERS, "g-own");
        expectCreate(server, ROOT + "/policy/group", "{\"id\":\"pol-own\"}");
        expectGet(server, ROOT + "/permission/scope" + LIST, "[]");
        expectCreate(server, ROOT + "/permission/scope", "{\"id\":\"perm-1\"}");
        expectReadBack(server, "perm-1", List.of("pol-own"));

        PolicyGraphWriter.AppliedGraph applied = writer.apply(graph);
        assertEquals(List.of("gk-group:" + OWNERS), applied.policyNames());
        server.verify();
    }

    @Test
    void findsTheRootPermissionAndAggregateOnSecondPagesWhenRetracting() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        PolicyGraphWriter writer = writer(builder);

        expectClients(server);
        expectGet(server, ROOT + "/permission/scope" + LIST, dummyPage("perm", 1000));
        expectGet(
                server,
                ROOT + "/permission/scope" + PAGE2,
                "[{\"id\":\"perm-1\",\"name\":\"" + ROOT_NAME + "\"}]");
        server.expect(requestTo(ROOT + "/permission/scope/perm-1"))
                .andExpect(method(HttpMethod.DELETE))
                .andRespond(withNoContent());
        expectGet(server, ROOT + "/policy" + LIST, dummyPage("pol", 1000));
        expectGet(
                server,
                ROOT + "/policy" + PAGE2,
                "[{\"id\":\"pol-any\",\"name\":\"" + ANY_NAME + "\",\"type\":\"aggregate\"}]");
        server.expect(requestTo(ROOT + "/policy/pol-any"))
                .andExpect(method(HttpMethod.DELETE))
                .andRespond(withNoContent());

        writer.retractRoot(TARGET, "enter");
        server.verify();
    }

    @Test
    void writesAnActorSourceAsAUserPolicy() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        PolicyGraphWriter writer = writer(builder);
        PolicyGraph graph =
                new PolicyGraph(TARGET, "enter", List.of(Source.of(new Gate.Actor("user-123"))));

        expectClients(server);
        expectGet(server, ROOT + "/scope" + LIST, "[]");
        expectCreate(server, ROOT + "/scope", "{\"id\":\"scope-enter\"}");
        expectGet(server, ROOT + "/resource" + LIST, "[]");
        expectCreate(server, ROOT + "/resource", "{\"_id\":\"res-1\"}");
        expectGet(server, ROOT + "/policy" + LIST, "[]");
        expectCreate(
                server,
                ROOT + "/policy/user",
                "{\"id\":\"pol-user\"}",
                "{\"name\":\"gk-user:user-123\",\"type\":\"user\"," + "\"users\":[\"user-123\"]}");
        expectGet(server, ROOT + "/permission/scope" + LIST, "[]");
        expectCreate(
                server,
                ROOT + "/permission/scope",
                "{\"id\":\"perm-1\"}",
                "{\"name\":\"" + ROOT_NAME + "\",\"policies\":[\"pol-user\"]}");
        expectReadBack(server, "perm-1", List.of("pol-user"));

        PolicyGraphWriter.AppliedGraph applied = writer.apply(graph);
        assertEquals(List.of("gk-user:user-123"), applied.policyNames());
        server.verify();
    }

    @Test
    void failsWhenTheReadBackPermissionMissesAPolicy() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        PolicyGraphWriter writer = writer(builder);
        PolicyGraph graph =
                new PolicyGraph(
                        TARGET, "enter", List.of(Source.of(new Gate.GroupMembership(OWNERS))));

        expectClients(server);
        expectGet(server, ROOT + "/scope" + LIST, "[]");
        expectCreate(server, ROOT + "/scope", "{\"id\":\"scope-enter\"}");
        expectGet(server, ROOT + "/resource" + LIST, "[]");
        expectCreate(server, ROOT + "/resource", "{\"_id\":\"res-1\"}");
        expectGet(server, ROOT + "/policy" + LIST, "[]");
        expectGroup(server, OWNERS, "g-own");
        expectCreate(server, ROOT + "/policy/group", "{\"id\":\"pol-own\"}");
        expectGet(server, ROOT + "/permission/scope" + LIST, "[]");
        expectCreate(server, ROOT + "/permission/scope", "{\"id\":\"perm-1\"}");
        expectReadBack(server, "perm-1", List.of());

        assertThrows(IllegalStateException.class, () -> writer.apply(graph));
        server.verify();
    }

    @Test
    void graphIsIntactWhenTheRootPermissionLinksExactlyTheRecordedPolicies() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        PolicyGraphWriter writer = writer(builder);

        expectClients(server);
        expectStoredGraph(server, List.of("pol-own"));

        assertTrue(writer.isGraphIntact(TARGET, "enter", "res-1", List.of("gk-group:" + OWNERS)));
        server.verify();
    }

    @Test
    void graphIsNotIntactWhenAPolicyWasUnlinkedFromTheRootPermission() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        PolicyGraphWriter writer = writer(builder);

        expectClients(server);
        // The policy itself still exists; only the link from the root permission was removed.
        expectStoredGraph(server, List.of());

        assertFalse(writer.isGraphIntact(TARGET, "enter", "res-1", List.of("gk-group:" + OWNERS)));
        server.verify();
    }

    @Test
    void graphIsNotIntactWhenTheRootPermissionLinksAnExtraPolicy() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        PolicyGraphWriter writer = writer(builder);

        expectClients(server);
        expectStoredGraph(server, List.of("pol-own", "pol-extra"), true);

        assertFalse(writer.isGraphIntact(TARGET, "enter", "res-1", List.of("gk-group:" + OWNERS)));
        server.verify();
    }

    private void expectStoredGraph(MockRestServiceServer server, List<String> permissionPolicyIds) {
        expectStoredGraph(server, permissionPolicyIds, false);
    }

    private void expectStoredGraph(
            MockRestServiceServer server, List<String> permissionPolicyIds, boolean extraPolicy) {
        expectGet(
                server,
                ROOT + "/resource" + LIST,
                "[{\"_id\":\"res-1\",\"name\":\"" + TARGET + "\"}]");
        String policies =
                "[{\"id\":\"pol-own\",\"name\":\"gk-group:"
                        + OWNERS
                        + "\",\"type\":\"group\"}"
                        + (extraPolicy
                                ? ",{\"id\":\"pol-extra\",\"name\":\"gk-extra\",\"type\":\"group\"}"
                                : "")
                        + "]";
        expectGet(server, ROOT + "/policy" + LIST, policies);
        expectGet(
                server,
                ROOT + "/permission/scope" + LIST,
                "[{\"id\":\"perm-1\",\"name\":\"" + ROOT_NAME + "\"}]");
        expectAssociated(server, "perm-1", "resources", List.of("res-1"), "_id");
        expectAssociated(server, "perm-1", "associatedPolicies", permissionPolicyIds, "id");
    }

    /** One association collection of a policy or permission, as Keycloak serves it. */
    private void expectAssociated(
            MockRestServiceServer server,
            String policyId,
            String association,
            List<String> ids,
            String idKey) {
        StringBuilder json = new StringBuilder("[");
        for (int i = 0; i < ids.size(); i++) {
            if (i > 0) {
                json.append(',');
            }
            json.append("{\"").append(idKey).append("\":\"").append(ids.get(i)).append("\"}");
        }
        expectGet(
                server,
                ROOT + "/policy/" + policyId + "/" + association,
                json.append(']').toString());
    }

    /** The linked resources, scopes and policies read before an existing permission is judged. */
    private void expectLinked(
            MockRestServiceServer server, String permissionId, List<String> policyIds) {
        expectAssociated(server, permissionId, "associatedPolicies", policyIds, "id");
        expectAssociated(server, permissionId, "resources", List.of("res-1"), "_id");
        expectAssociated(server, permissionId, "scopes", List.of("scope-enter"), "id");
    }

    /** A full read-back: the permission's associations plus the resource itself. */
    private void expectReadBack(
            MockRestServiceServer server, String permissionId, List<String> policyIds) {
        expectLinked(server, permissionId, policyIds);
        expectGet(
                server,
                ROOT + "/resource/res-1",
                "{\"_id\":\"res-1\",\"name\":\""
                        + TARGET
                        + "\",\"scopes\":[{\"id\":\"scope-enter\",\"name\":\"enter\"}]}");
    }

    /** A full page of unrelated entries, so only a later page can hold the wanted name. */
    private static String dummyPage(String kind, int count) {
        StringBuilder json = new StringBuilder("[");
        for (int i = 0; i < count; i++) {
            if (i > 0) {
                json.append(',');
            }
            json.append("{\"id\":\"")
                    .append(kind)
                    .append('-')
                    .append(i)
                    .append("\",\"name\":\"")
                    .append(kind)
                    .append('-')
                    .append(i)
                    .append("\"}");
        }
        return json.append(']').toString();
    }

    private void expectClients(MockRestServiceServer server) {
        server.expect(requestTo(CLIENTS))
                .andExpect(method(HttpMethod.GET))
                .andRespond(
                        withSuccess(
                                "[{\"id\":\"api-uuid\",\"clientId\":\"giaokhoa-api\"}]",
                                MediaType.APPLICATION_JSON));
    }

    private void expectGet(MockRestServiceServer server, String url, String body) {
        server.expect(requestTo(url))
                .andExpect(method(HttpMethod.GET))
                .andRespond(withSuccess(body, MediaType.APPLICATION_JSON));
    }

    private void expectGroup(MockRestServiceServer server, String path, String id) {
        expectGet(
                server,
                HOST + "/admin/realms/giaokhoa/group-by-path" + path,
                "{\"id\":\"" + id + "\",\"path\":\"" + path + "\"}");
    }

    private void expectCreate(MockRestServiceServer server, String url, String response) {
        server.expect(requestTo(url))
                .andExpect(method(HttpMethod.POST))
                .andRespond(withStatus(HttpStatus.CREATED).body(response));
    }

    private void expectCreate(
            MockRestServiceServer server, String url, String response, String expectedJson) {
        server.expect(requestTo(url))
                .andExpect(method(HttpMethod.POST))
                .andExpect(content().json(expectedJson))
                .andRespond(withStatus(HttpStatus.CREATED).body(response));
    }

    private PolicyGraphWriter writer(RestClient.Builder builder) {
        ClientRegistration registration =
                ClientRegistration.withRegistrationId("giaokhoa-provisioner")
                        .clientId("test-provisioner")
                        .authorizationGrantType(AuthorizationGrantType.CLIENT_CREDENTIALS)
                        .tokenUri(HOST + "/realms/giaokhoa/protocol/openid-connect/token")
                        .build();
        OAuth2AccessToken token =
                new OAuth2AccessToken(
                        OAuth2AccessToken.TokenType.BEARER,
                        "server-token",
                        Instant.now(),
                        Instant.now().plusSeconds(300));
        OAuth2AuthorizedClient authorized =
                new OAuth2AuthorizedClient(registration, "giaokhoa-provisioner", token);
        OAuth2AuthorizedClientManager manager = request -> authorized;
        return new PolicyGraphWriter(builder, HOST, "giaokhoa", manager, "giaokhoa-api");
    }
}
