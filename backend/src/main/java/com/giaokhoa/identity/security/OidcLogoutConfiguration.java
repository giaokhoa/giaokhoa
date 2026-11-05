package com.giaokhoa.identity.security;

import java.net.URI;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.configurers.oauth2.client.OidcBackChannelLogoutHandler;
import org.springframework.security.oauth2.client.oidc.session.OidcSessionRegistry;
import org.springframework.session.web.http.CookieSerializer;
import org.springframework.session.web.http.DefaultCookieSerializer;

@Configuration(proxyBeanMethods = false)
public class OidcLogoutConfiguration {

    @Bean
    CookieSerializer sessionCookieSerializer(@Value("${giaokhoa.app-origin}") String appOrigin) {
        var serializer = new DefaultCookieSerializer();
        serializer.setCookieName("SESSION");
        serializer.setUseHttpOnlyCookie(true);
        serializer.setUseSecureCookie("https".equalsIgnoreCase(URI.create(appOrigin).getScheme()));
        serializer.setSameSite("Lax");
        // Spring's back-channel handler sends the raw session ID in the SESSION cookie.
        serializer.setUseBase64Encoding(false);
        return serializer;
    }

    @Bean
    OidcBackChannelLogoutHandler backChannelLogoutHandler(
            OidcSessionRegistry registry, @Value("${server.port:8080}") int serverPort) {
        var handler = new OidcBackChannelLogoutHandler(registry);
        handler.setSessionCookieName("SESSION");
        // The incoming gateway port can differ from Spring's local HTTP listener.
        handler.setLogoutUri(
                "http://127.0.0.1:" + serverPort + "/logout/connect/back-channel/{registrationId}");
        return handler;
    }
}
