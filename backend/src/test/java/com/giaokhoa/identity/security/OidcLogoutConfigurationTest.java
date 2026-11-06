package com.giaokhoa.identity.security;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import jakarta.servlet.http.Cookie;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.session.web.http.CookieSerializer;

class OidcLogoutConfigurationTest {

    @Test
    void httpsSessionCookieIsHostOnlyHttpOnlySecureLaxAndUsesRawSessionId() {
        CookieSerializer serializer =
                new OidcLogoutConfiguration().sessionCookieSerializer("https://app.example.test");
        var request = new MockHttpServletRequest();
        request.setServerName("app.example.test");
        var response = new MockHttpServletResponse();

        serializer.writeCookieValue(new CookieSerializer.CookieValue(request, response, "id-123"));
        String header = response.getHeader("Set-Cookie");
        assertTrue(header.startsWith("SESSION=id-123;"));
        assertTrue(header.contains("HttpOnly"));
        assertTrue(header.contains("Secure"));
        assertTrue(header.contains("SameSite=Lax"));
        assertFalse(header.contains("Domain="));

        var inbound = new MockHttpServletRequest();
        inbound.setCookies(new Cookie("SESSION", "id-123"));
        assertEquals(List.of("id-123"), serializer.readCookieValues(inbound));
    }

    @Test
    void malformedBackChannelClaimsCannotReachSpringNativeHandler() throws Exception {
        var guard =
                java.util.Objects.requireNonNull(
                        new OidcLogoutConfiguration()
                                .malformedBackChannelLogoutGuard()
                                .getFilter());
        var request = new MockHttpServletRequest("POST", "/logout/connect/back-channel/keycloak");
        request.addParameter("logout_token", encodedJwt("{\"iss\":\"https://issuer\"}"));
        var response = new MockHttpServletResponse();
        var downstream = new MockFilterChain();
        guard.doFilter(request, response, downstream);
        assertEquals(400, response.getStatus());
        assertNull(downstream.getRequest());

        var valid = new MockHttpServletRequest("POST", "/logout/connect/back-channel/keycloak");
        valid.addParameter(
                "logout_token",
                encodedJwt(
                        "{\"iss\":\"https://issuer\",\"events\":"
                                + "{\"http://schemas.openid.net/event/backchannel-logout\":{}}}"));
        var passed = new MockFilterChain();
        guard.doFilter(valid, new MockHttpServletResponse(), passed);
        assertSame(valid, passed.getRequest());
    }

    private static String encodedJwt(String claims) {
        return "eyJhbGciOiJSUzI1NiJ9."
                + Base64.getUrlEncoder()
                        .withoutPadding()
                        .encodeToString(claims.getBytes(StandardCharsets.UTF_8))
                + ".signature";
    }

    @Test
    void localHttpSessionCookieDoesNotRequireTls() {
        CookieSerializer serializer =
                new OidcLogoutConfiguration().sessionCookieSerializer("http://localhost:3000");
        var response = new MockHttpServletResponse();
        serializer.writeCookieValue(
                new CookieSerializer.CookieValue(
                        new MockHttpServletRequest(), response, "local-id"));
        String header = response.getHeader("Set-Cookie");
        assertTrue(header.startsWith("SESSION=local-id;"));
        assertTrue(header.contains("HttpOnly"));
        assertFalse(header.contains("Secure"));
        assertFalse(header.contains("Domain="));
    }
}
