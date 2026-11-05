package com.giaokhoa.identity.security;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.client.oidc.session.OidcSessionRegistry;
import org.springframework.security.oauth2.client.web.HttpSessionOAuth2AuthorizedClientRepository;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizedClientRepository;

@Configuration(proxyBeanMethods = false)
public class OidcSessionConfiguration {

    @Bean
    OAuth2AuthorizedClientRepository authorizedClientRepository() {
        // Spring Session JDBC persists the HttpSession, including authorized access/refresh tokens.
        return new HttpSessionOAuth2AuthorizedClientRepository();
    }

    @Bean
    OidcSessionRegistry oidcSessionRegistry(
            JdbcTemplate jdbc, @Value("${spring.security.oauth2.client.registration.keycloak.client-id}") String clientId) {
        return new JdbcOidcSessionRegistry(jdbc, clientId);
    }
}
