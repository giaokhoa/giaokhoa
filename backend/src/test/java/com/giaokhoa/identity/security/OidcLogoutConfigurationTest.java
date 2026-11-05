package com.giaokhoa.identity.security;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import jakarta.servlet.http.Cookie;
import java.util.List;
import org.junit.jupiter.api.Test;
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
