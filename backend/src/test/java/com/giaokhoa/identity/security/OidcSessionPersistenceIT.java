package com.giaokhoa.identity.security;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

import com.giaokhoa.support.IntegrationEnvironment;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClient;
import org.springframework.security.oauth2.client.oidc.authentication.logout.OidcLogoutToken;
import org.springframework.security.oauth2.client.oidc.session.OidcSessionInformation;
import org.springframework.security.oauth2.client.oidc.session.OidcSessionRegistry;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.web.HttpSessionOAuth2AuthorizedClientRepository;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizedClientRepository;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.OAuth2AccessToken;
import org.springframework.security.oauth2.core.OAuth2RefreshToken;
import org.springframework.security.oauth2.core.oidc.OidcIdToken;
import org.springframework.security.oauth2.core.oidc.user.DefaultOidcUser;
import org.springframework.session.Session;
import org.springframework.session.SessionRepository;
import org.springframework.session.web.http.SessionRepositoryFilter;

@SpringBootTest
class OidcSessionPersistenceIT extends IntegrationEnvironment {

    private static final String ISSUER = "http://127.0.0.1:18081/realms/giaokhoa-it";
    private static final String CLIENT = "giaokhoa-it-web";

    @Autowired JdbcTemplate jdbc;

    @Autowired SessionRepository<?> sessions;

    @Autowired OidcSessionRegistry registry;

    @Autowired OAuth2AuthorizedClientRepository authorizedClients;

    @Test
    void sessionAndCorrelationSurviveNewRegistryAndMatchOnlyCorrectSid() {
        assertInstanceOf(HttpSessionOAuth2AuthorizedClientRepository.class, authorizedClients);
        var session =
                persistedSession(
                        sessions,
                        created -> created.setAttribute("spring-session-persistence", "persisted"));
        try {
            Session reloaded = sessions.findById(session.getId());
            assertNotNull(reloaded);
            assertEquals("persisted", reloaded.getAttribute("spring-session-persistence"));
            registry.saveSessionInformation(info(session.getId(), "user-1", "sid-1", "csrf-1"));

            // New object: no in-memory registry shared with the original instance.
            var restarted = new JdbcOidcSessionRegistry(jdbc, CLIENT);
            assertFalse(
                    restarted
                            .removeSessionInformation(
                                    token(ISSUER, "other-client", "user-1", "sid-1"))
                            .iterator()
                            .hasNext());
            assertFalse(
                    restarted
                            .removeSessionInformation(
                                    token("http://another-issuer", CLIENT, "user-1", "sid-1"))
                            .iterator()
                            .hasNext());
            assertFalse(
                    restarted
                            .removeSessionInformation(
                                    token(ISSUER, CLIENT, "user-1", "sid-elsewhere"))
                            .iterator()
                            .hasNext());
            var removed =
                    restarted
                            .removeSessionInformation(
                                    token(ISSUER, CLIENT, "different-user", "sid-1"))
                            .iterator();
            assertNotNull(removed);
            var correlation = removed.next();
            assertEquals(session.getId(), correlation.getSessionId());
            assertEquals("user-1", correlation.getPrincipal().getSubject());
            assertEquals("sid-1", correlation.getPrincipal().getClaimAsString("sid"));
            assertEquals(Map.of("X-CSRF-TOKEN", "csrf-1"), correlation.getAuthorities());
            assertFalse(removed.hasNext());
            assertNull(restarted.removeSessionInformation(session.getId()));
        } finally {
            registry.removeSessionInformation(session.getId());
            sessions.deleteById(session.getId());
        }
    }

    @Test
    void subjectLogoutInvalidatesAllMatchingSessionsButNotAnotherSubject() {
        var a = persistedSession(sessions);
        var b = persistedSession(sessions);
        var other = persistedSession(sessions);
        try {
            registry.saveSessionInformation(info(a.getId(), "user-2", "sid-a", null));
            registry.saveSessionInformation(info(b.getId(), "user-2", "sid-b", null));
            registry.saveSessionInformation(info(other.getId(), "user-3", "sid-c", null));

            var restarted = new JdbcOidcSessionRegistry(jdbc, CLIENT);
            var removed = restarted.removeSessionInformation(token(ISSUER, CLIENT, "user-2", null));
            var ids = new java.util.HashSet<String>();
            removed.forEach(value -> ids.add(value.getSessionId()));
            assertEquals(java.util.Set.of(a.getId(), b.getId()), ids);
            assertNotNull(restarted.removeSessionInformation(other.getId()));
        } finally {
            registry.removeSessionInformation(a.getId());
            registry.removeSessionInformation(b.getId());
            registry.removeSessionInformation(other.getId());
            sessions.deleteById(a.getId());
            sessions.deleteById(b.getId());
            sessions.deleteById(other.getId());
        }
    }

    @Test
    void jdbcSessionDeletionAndIdRotationKeepCorrelationInSync() {
        var session = persistedSession(sessions);
        String newId = java.util.UUID.randomUUID().toString();
        try {
            registry.saveSessionInformation(info(session.getId(), "user-4", "sid-4", null));
            assertEquals(
                    1,
                    jdbc.update(
                            "UPDATE spring_session SET session_id = ? WHERE session_id = ?",
                            newId,
                            session.getId()));
            assertNull(registry.removeSessionInformation(session.getId()));
            assertEquals(newId, registry.removeSessionInformation(newId).getSessionId());

            registry.saveSessionInformation(info(newId, "user-4", "sid-4", null));
            sessions.deleteById(newId);
            assertNull(registry.removeSessionInformation(newId));
        } finally {
            registry.removeSessionInformation(session.getId());
            registry.removeSessionInformation(newId);
            sessions.deleteById(session.getId());
            sessions.deleteById(newId);
        }
    }

    @Test
    void expiredSessionCannotBeSelectedForBackChannelLogout() {
        var session = persistedSession(sessions);
        try {
            registry.saveSessionInformation(info(session.getId(), "user-5", "sid-5", null));
            jdbc.update(
                    "UPDATE spring_session SET expiry_time = 0 WHERE session_id = ?",
                    session.getId());
            assertFalse(
                    registry.removeSessionInformation(token(ISSUER, CLIENT, "user-5", "sid-5"))
                            .iterator()
                            .hasNext());
        } finally {
            registry.removeSessionInformation(session.getId());
            sessions.deleteById(session.getId());
        }
    }

    @Test
    void authorizedAccessAndRefreshTokensSurviveJdbcSessionReload() throws Exception {
        var registration =
                ClientRegistration.withRegistrationId("keycloak")
                        .clientId(CLIENT)
                        .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                        .redirectUri("{baseUrl}/login/oauth2/code/{registrationId}")
                        .authorizationUri(ISSUER + "/protocol/openid-connect/auth")
                        .tokenUri(ISSUER + "/protocol/openid-connect/token")
                        .build();
        var accessToken =
                new OAuth2AccessToken(
                        OAuth2AccessToken.TokenType.BEARER,
                        "test-access-secret",
                        Instant.now(),
                        Instant.now().plusSeconds(600),
                        Set.of("openid"));
        var refreshToken = new OAuth2RefreshToken("test-refresh-secret", Instant.now());
        var client =
                new OAuth2AuthorizedClient(registration, "test-subject", accessToken, refreshToken);
        var auth = new TestingAuthenticationToken("test-subject", "unused", "ROLE_USER");
        var first = new MockHttpServletRequest("GET", "/");
        var response = new MockHttpServletResponse();
        var firstFilter = new SessionRepositoryFilter<>(sessions);
        firstFilter.doFilter(
                first,
                response,
                (request, reply) ->
                        authorizedClients.saveAuthorizedClient(
                                client,
                                auth,
                                (jakarta.servlet.http.HttpServletRequest) request,
                                (jakarta.servlet.http.HttpServletResponse) reply));

        var cookie = response.getCookie("SESSION");
        assertNotNull(cookie);
        try {
            // Fresh request and filter: the client must be read from a JDBC-backed session.
            var second = new MockHttpServletRequest("GET", "/");
            second.setCookies(cookie);
            var loaded = new AtomicReference<OAuth2AuthorizedClient>();
            var sessionId = new AtomicReference<String>();
            var secondFilter = new SessionRepositoryFilter<>(sessions);
            secondFilter.doFilter(
                    second,
                    new MockHttpServletResponse(),
                    (request, reply) -> {
                        var httpRequest = (jakarta.servlet.http.HttpServletRequest) request;
                        loaded.set(
                                new HttpSessionOAuth2AuthorizedClientRepository()
                                        .loadAuthorizedClient("keycloak", auth, httpRequest));
                        sessionId.set(httpRequest.getSession(false).getId());
                    });

            assertNotNull(loaded.get());
            assertEquals("test-subject", loaded.get().getPrincipalName());
            assertEquals(
                    accessToken.getTokenValue(), loaded.get().getAccessToken().getTokenValue());
            assertEquals(accessToken.getExpiresAt(), loaded.get().getAccessToken().getExpiresAt());
            assertEquals(
                    refreshToken.getTokenValue(), loaded.get().getRefreshToken().getTokenValue());
            assertNotNull(sessions.findById(sessionId.get()));
        } finally {
            // The SESSION cookie contains an encoded ID, not the database session ID.
            var raw =
                    new String(
                            java.util.Base64.getDecoder().decode(cookie.getValue()),
                            java.nio.charset.StandardCharsets.UTF_8);
            sessions.deleteById(raw);
        }
    }

    @Test
    void cleanupOnlyDeletesOldOrphans() {
        var active = persistedSession(sessions);
        String oldOrphan = UUID.randomUUID().toString();
        String freshOrphan = UUID.randomUUID().toString();
        try {
            registry.saveSessionInformation(info(oldOrphan, "stale", "old", null));
            registry.saveSessionInformation(info(freshOrphan, "recent", "new", null));
            registry.saveSessionInformation(info(active.getId(), "active", "sid-active", null));
            jdbc.update(
                    "UPDATE oidc_session_correlation"
                            + " SET recorded_at = clock_timestamp() - interval '2 hours'"
                            + " WHERE session_id IN (?, ?)",
                    oldOrphan,
                    active.getId());

            ((JdbcOidcSessionRegistry) registry).cleanUpOrphanedCorrelations();
            assertNull(registry.removeSessionInformation(oldOrphan));
            assertNotNull(registry.removeSessionInformation(freshOrphan));
            assertNotNull(registry.removeSessionInformation(active.getId()));
        } finally {
            registry.removeSessionInformation(oldOrphan);
            registry.removeSessionInformation(freshOrphan);
            registry.removeSessionInformation(active.getId());
            sessions.deleteById(active.getId());
        }
    }

    // Capture generic vì kiểu JdbcSession của Spring không public; không dùng raw type/cast.
    private static <S extends Session> S persistedSession(SessionRepository<S> repository) {
        return persistedSession(repository, session -> {});
    }

    private static <S extends Session> S persistedSession(
            SessionRepository<S> repository, Consumer<S> initialize) {
        S session = repository.createSession();
        initialize.accept(session);
        repository.save(session);
        return session;
    }

    private static OidcSessionInformation info(
            String sessionId, String sub, String sid, String csrf) {
        var token =
                new OidcIdToken(
                        "test-id-token",
                        Instant.now(),
                        Instant.now().plusSeconds(600),
                        Map.of("iss", ISSUER, "aud", List.of(CLIENT), "sub", sub, "sid", sid));
        return new OidcSessionInformation(
                sessionId,
                csrf == null ? Map.of() : Map.of("X-CSRF-TOKEN", csrf),
                new DefaultOidcUser(List.of(), token, "sub"));
    }

    private static OidcLogoutToken token(
            String issuer, String audience, String subject, String sid) {
        var builder =
                OidcLogoutToken.withTokenValue("validated-by-spring-handler")
                        .issuer(issuer)
                        .audience(List.of(audience))
                        .subject(subject)
                        .issuedAt(Instant.now())
                        .jti(java.util.UUID.randomUUID().toString())
                        .events(
                                Map.of(
                                        "http://schemas.openid.net/event/backchannel-logout",
                                        Map.of()));
        if (sid != null) {
            builder.sessionId(sid);
        }
        return builder.build();
    }
}
