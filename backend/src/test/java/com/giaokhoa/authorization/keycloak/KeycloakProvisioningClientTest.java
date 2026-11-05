package com.giaokhoa.authorization.keycloak;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class KeycloakProvisioningClientTest {
    private static final String HOST = "http://keycloak.test";
    private static final UUID WORKSPACE = UUID.fromString("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    private static final String NAME = "center-" + WORKSPACE;
    private static final String ORG_QUERY = HOST + "/admin/realms/giaokhoa/organizations?search="
            + NAME + "&max=100";

    @Test
    void createsOrganizationOnceAndReturnsStableOpaqueIdOnRetry() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        KeycloakProvisioningClient client = new KeycloakProvisioningClient(
                builder, HOST, "giaokhoa-provisioner", "test-secret");

        expectToken(server);
        server.expect(requestTo(ORG_QUERY)).andExpect(method(HttpMethod.GET))
                .andRespond(withSuccess("[]", MediaType.APPLICATION_JSON));
        expectToken(server);
        server.expect(requestTo(HOST + "/admin/realms/giaokhoa/organizations"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(content().json("{\"name\":\"" + NAME
                        + "\",\"alias\":\"" + NAME + "\",\"description\":\"Center A\"}"))
                .andRespond(withStatus(HttpStatus.CREATED));
        expectToken(server);
        server.expect(requestTo(ORG_QUERY)).andExpect(method(HttpMethod.GET))
                .andRespond(withSuccess("[{\"id\":\"opaque-keycloak-id\",\"name\":\""
                        + NAME + "\",\"alias\":\"" + NAME + "\"}]", MediaType.APPLICATION_JSON));
        expectToken(server);
        server.expect(requestTo(ORG_QUERY)).andExpect(method(HttpMethod.GET))
                .andRespond(withSuccess("[{\"id\":\"opaque-keycloak-id\",\"name\":\""
                        + NAME + "\",\"alias\":\"" + NAME + "\"}]", MediaType.APPLICATION_JSON));

        assertEquals("opaque-keycloak-id", client.ensureOrganization(WORKSPACE, "Center A"));
        assertEquals("opaque-keycloak-id", client.ensureOrganization(WORKSPACE, "Center A"));
        server.verify();
    }

    @Test
    void resolvesNestedRealmGroupsWithoutCreatingDuplicates() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        KeycloakProvisioningClient client = new KeycloakProvisioningClient(
                builder, HOST, "giaokhoa-provisioner", "test-secret");

        expectToken(server);
        server.expect(requestTo(groupQuery("gk"))).andRespond(withSuccess(
                "[{\"id\":\"root\",\"name\":\"gk\",\"path\":\"/gk\"}]",
                MediaType.APPLICATION_JSON));
        expectToken(server);
        server.expect(requestTo(groupQuery("identity"))).andRespond(withSuccess(
                "[{\"id\":\"root\",\"path\":\"/gk\",\"subGroups\":["
                + "{\"id\":\"branch\",\"name\":\"identity\",\"path\":\"/gk/identity\"}]}]",
                MediaType.APPLICATION_JSON));
        expectToken(server);
        server.expect(requestTo(groupQuery("eligible"))).andRespond(withSuccess(
                "[{\"id\":\"leaf\",\"path\":\"/gk/identity/eligible\"}]",
                MediaType.APPLICATION_JSON));

        assertEquals("leaf", client.ensureRealmGroup("/gk/identity/eligible"));
        server.verify();
    }

    @Test
    void rejectsArbitraryGroupSourcesBeforeCallingKeycloak() {
        KeycloakProvisioningClient client = new KeycloakProvisioningClient(
                RestClient.builder(), HOST, "giaokhoa-provisioner", "test-secret");

        assertThrows(IllegalArgumentException.class, () -> client.ensureRealmGroup("/gk/roles/admin"));
        assertThrows(IllegalArgumentException.class, () -> client.ensureRealmGroup(
                "/gk/workspaces/not-a-uuid/roles/teachers"));
        assertThrows(IllegalArgumentException.class, () -> client.setRealmGroupMembership(
                "opaque-user", "/gk/platform/operators/other", false));
        assertThrows(IllegalArgumentException.class, () -> client.ensureOrganization(null, "A"));
    }

    private String groupQuery(String name) {
        return HOST + "/admin/realms/giaokhoa/groups?search=" + name
                + "&exact=true&briefRepresentation=false&max=1000";
    }

    private void expectToken(MockRestServiceServer server) {
        server.expect(requestTo(HOST + "/realms/giaokhoa/protocol/openid-connect/token"))
                .andExpect(method(HttpMethod.POST))
                .andRespond(withSuccess("{\"access_token\":\"server-token\"}", MediaType.APPLICATION_JSON));
    }
}
