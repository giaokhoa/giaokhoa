package com.giaokhoa.authorization.decision;

import static org.hamcrest.Matchers.allOf;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.giaokhoa.shared.http.HttpProblemException;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClient;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.web.HttpSessionOAuth2AuthorizedClientRepository;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizedClientRepository;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.OAuth2AccessToken;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.test.web.client.ResponseActions;
import org.springframework.test.web.client.ResponseCreator;
import org.springframework.web.client.RestClient;

class KeycloakDecisionClientTest {
    private static final String HOST = "http://keycloak.test";
    private static final String TOKEN_URL = HOST + "/realms/giaokhoa/protocol/openid-connect/token";
    private static final String AUDIENCE = "giaokhoa-api";
    private static final String USER = "session-user";
    private static final String USER_TOKEN = "user-access-token";

    @Test
    void allowsOnlyWhenEveryRequiredPairIsAllowed() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        Session session = sessionWithToken(USER, tokenExpiringIn(300));
        KeycloakDecisionClient client = client(builder, session.repository());

        expectDecision(server, "resource-a%23enter", "resource-b").andRespond(allowed());
        expectDecision(server, "resource-b%23read", "resource-a").andRespond(allowed());

        assertTrue(
                client.isAllowed(
                        authentication(USER),
                        session.request(),
                        RequiredPermissions.of(
                                RequiredPermissions.require("resource-a", "enter"),
                                RequiredPermissions.require("resource-b", "read"))));
        server.verify();
    }

    @Test
    void deniesWhenOnePairIsDeniedByThePdp() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        Session session = sessionWithToken(USER, tokenExpiringIn(300));
        KeycloakDecisionClient client = client(builder, session.repository());

        expectDecision(server, "resource-a%23enter", "resource-b").andRespond(allowed());
        expectDecision(server, "resource-b%23read", "resource-a")
                .andRespond(withStatus(HttpStatus.FORBIDDEN));

        assertFalse(
                client.isAllowed(
                        authentication(USER),
                        session.request(),
                        RequiredPermissions.of(
                                RequiredPermissions.require("resource-a", "enter"),
                                RequiredPermissions.require("resource-b", "read"))));
        server.verify();
    }

    @Test
    void deniesWhenThePdpDecisionResultIsFalse() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        Session session = sessionWithToken(USER, tokenExpiringIn(300));
        KeycloakDecisionClient client = client(builder, session.repository());

        expectDecision(server, "resource-a%23enter", "resource-b")
                .andRespond(withSuccess("{\"result\":false}", MediaType.APPLICATION_JSON));

        assertFalse(
                client.isAllowed(
                        authentication(USER),
                        session.request(),
                        RequiredPermissions.of(
                                RequiredPermissions.require("resource-a", "enter"))));
        server.verify();
    }

    @Test
    void doesNotCacheAllowDecisionsBetweenRequests() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        Session session = sessionWithToken(USER, tokenExpiringIn(300));
        KeycloakDecisionClient client = client(builder, session.repository());
        RequiredPermissions required =
                RequiredPermissions.of(RequiredPermissions.require("resource-a", "enter"));
        Authentication authentication = authentication(USER);

        expectDecision(server, "resource-a%23enter", "resource-b").andRespond(allowed());
        expectDecision(server, "resource-a%23enter", "resource-b").andRespond(allowed());

        assertTrue(client.isAllowed(authentication, session.request(), required));
        assertTrue(client.isAllowed(authentication, session.request(), required));
        server.verify();
    }

    @Test
    void failsClosedWhenTheDecisionResponseHasNoBooleanResult() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        Session session = sessionWithToken(USER, tokenExpiringIn(300));
        KeycloakDecisionClient client = client(builder, session.repository());

        expectDecision(server, "resource-a%23enter", "resource-b")
                .andRespond(withSuccess("{\"result\":\"true\"}", MediaType.APPLICATION_JSON));

        HttpProblemException exception =
                assertThrows(
                        HttpProblemException.class,
                        () ->
                                client.isAllowed(
                                        authentication(USER),
                                        session.request(),
                                        RequiredPermissions.of(
                                                RequiredPermissions.require(
                                                        "resource-a", "enter"))));
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, exception.getStatus());
        assertEquals("DECISION_UNVERIFIABLE", exception.getCode());
        server.verify();
    }

    @Test
    void failsClosedWhenKeycloakReturnsAServerError() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        Session session = sessionWithToken(USER, tokenExpiringIn(300));
        KeycloakDecisionClient client = client(builder, session.repository());

        expectDecision(server, "resource-a%23enter", "resource-b")
                .andRespond(withStatus(HttpStatus.INTERNAL_SERVER_ERROR));

        HttpProblemException exception =
                assertThrows(
                        HttpProblemException.class,
                        () ->
                                client.isAllowed(
                                        authentication(USER),
                                        session.request(),
                                        RequiredPermissions.of(
                                                RequiredPermissions.require(
                                                        "resource-a", "enter"))));
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, exception.getStatus());
        server.verify();
    }

    @Test
    void failsClosedWhenTheSessionHasNoAuthorizedClient() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        Session session = new Session(new HttpSessionOAuth2AuthorizedClientRepository());
        KeycloakDecisionClient client = client(builder, session.repository());

        HttpProblemException exception =
                assertThrows(
                        HttpProblemException.class,
                        () ->
                                client.isAllowed(
                                        authentication(USER),
                                        session.request(),
                                        RequiredPermissions.of(
                                                RequiredPermissions.require(
                                                        "resource-a", "enter"))));
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, exception.getStatus());
        server.verify();
    }

    @Test
    void failsClosedWhenTheSessionTokenBelongsToAnotherUser() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        Session session = sessionWithToken("another-user", tokenExpiringIn(300));
        KeycloakDecisionClient client = client(builder, session.repository());

        HttpProblemException exception =
                assertThrows(
                        HttpProblemException.class,
                        () ->
                                client.isAllowed(
                                        authentication(USER),
                                        session.request(),
                                        RequiredPermissions.of(
                                                RequiredPermissions.require(
                                                        "resource-a", "enter"))));
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, exception.getStatus());
        server.verify();
    }

    @Test
    void failsClosedWhenTheSessionTokenHasExpired() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        Session session = sessionWithToken(USER, tokenExpiringIn(-60));
        KeycloakDecisionClient client = client(builder, session.repository());

        HttpProblemException exception =
                assertThrows(
                        HttpProblemException.class,
                        () ->
                                client.isAllowed(
                                        authentication(USER),
                                        session.request(),
                                        RequiredPermissions.of(
                                                RequiredPermissions.require(
                                                        "resource-a", "enter"))));
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, exception.getStatus());
        server.verify();
    }

    private ResponseActions expectDecision(
            MockRestServiceServer server, String encodedPair, String otherResource) {
        return server.expect(requestTo(TOKEN_URL))
                .andExpect(method(HttpMethod.POST))
                .andExpect(header("Authorization", "Bearer " + USER_TOKEN))
                .andExpect(content().contentType(MediaType.APPLICATION_FORM_URLENCODED))
                .andExpect(
                        content()
                                .string(
                                        allOf(
                                                containsString("grant_type="),
                                                containsString("uma-ticket"),
                                                containsString("audience=" + AUDIENCE),
                                                containsString("permission=" + encodedPair),
                                                containsString("response_mode=decision"),
                                                not(containsString(otherResource)),
                                                not(containsString("claim_token")))));
    }

    private ResponseCreator allowed() {
        return withSuccess("{\"result\":true}", MediaType.APPLICATION_JSON);
    }

    private KeycloakDecisionClient client(
            RestClient.Builder builder, OAuth2AuthorizedClientRepository repository) {
        return new KeycloakDecisionClient(builder, repository, TOKEN_URL, AUDIENCE);
    }

    private Authentication authentication(String name) {
        return UsernamePasswordAuthenticationToken.authenticated(name, null, List.of());
    }

    private OAuth2AccessToken tokenExpiringIn(long seconds) {
        Instant now = Instant.now();
        return new OAuth2AccessToken(
                OAuth2AccessToken.TokenType.BEARER,
                USER_TOKEN,
                now.minusSeconds(3600),
                now.plusSeconds(seconds));
    }

    private Session sessionWithToken(String principalName, OAuth2AccessToken token) {
        Session session = new Session(new HttpSessionOAuth2AuthorizedClientRepository());
        ClientRegistration registration =
                ClientRegistration.withRegistrationId("keycloak")
                        .clientId("giaokhoa-web")
                        .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                        .authorizationUri(HOST + "/realms/giaokhoa/protocol/openid-connect/auth")
                        .redirectUri("{baseUrl}/login/oauth2/code/keycloak")
                        .tokenUri(TOKEN_URL)
                        .build();
        OAuth2AuthorizedClient authorized =
                new OAuth2AuthorizedClient(registration, principalName, token);
        session.repository()
                .saveAuthorizedClient(
                        authorized,
                        authentication(principalName),
                        session.request(),
                        new MockHttpServletResponse());
        return session;
    }

    private static final class Session {
        private final OAuth2AuthorizedClientRepository clientRepository;
        private final MockHttpServletRequest servletRequest = new MockHttpServletRequest();

        private Session(OAuth2AuthorizedClientRepository clientRepository) {
            this.clientRepository = clientRepository;
            this.servletRequest.setSession(new MockHttpSession());
        }

        private OAuth2AuthorizedClientRepository repository() {
            return clientRepository;
        }

        private HttpServletRequest request() {
            return servletRequest;
        }
    }
}
