package com.giaokhoa.identity.keycloak;

import java.net.URI;
import org.jspecify.annotations.Nullable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
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
import org.springframework.web.util.UriComponentsBuilder;

/**
 * Đọc profile danh tính hiện hành của một user từ Admin API của Keycloak bằng credential
 * provisioner nội bộ. Đây là input danh tính đáng tin cậy duy nhất của eligibility gate: không bao
 * giờ nhận email, trạng thái verified hay origin từ request của browser hoặc từ claim của token cũ.
 * Token quản trị chỉ đọc input danh tính, không evaluate quyền thay user. Lỗi đọc được truyền lên
 * trên để caller fail-closed.
 */
@Component
public class CurrentIdentityClient {
    private final RestClient http;
    private final String baseUrl;
    private final String realm;
    private final OAuth2AuthorizedClientManager manager;

    @Autowired
    public CurrentIdentityClient(
            @Value("${giaokhoa.keycloak.admin-base-url}") String baseUrl,
            @Value("${spring.security.oauth2.client.provider.keycloak.issuer-uri}")
                    String issuerUri,
            @Value("${giaokhoa.keycloak.provisioner.client-id}") String clientId,
            @Value("${giaokhoa.keycloak.provisioner.client-secret}") String clientSecret) {
        this(
                RestClient.builder(),
                baseUrl,
                realmOf(issuerUri),
                clientManager(
                        baseUrl.replaceAll("/+$", ""), realmOf(issuerUri), clientId, clientSecret));
    }

    CurrentIdentityClient(
            RestClient.Builder builder,
            String baseUrl,
            String realm,
            OAuth2AuthorizedClientManager manager) {
        this.http = builder.build();
        this.baseUrl = baseUrl.replaceAll("/+$", "");
        this.realm = realm;
        this.manager = manager;
    }

    /** Profile Keycloak hiện hành của một user; Keycloak ID giữ nguyên dạng opaque. */
    public record CurrentIdentity(
            String id,
            String username,
            @Nullable String email,
            boolean emailVerified,
            boolean enabled) {}

    /** Đọc profile của đúng Keycloak user ID này; mọi lỗi đọc đều truyền lên trên. */
    public CurrentIdentity readCurrentIdentity(String keycloakUserId) {
        if (keycloakUserId == null || keycloakUserId.isBlank()) {
            throw new IllegalArgumentException("Keycloak user ID is required");
        }
        URI uri =
                UriComponentsBuilder.fromUriString(baseUrl)
                        .pathSegment("admin", "realms", realm, "users", keycloakUserId)
                        .build()
                        .encode()
                        .toUri();
        CurrentIdentity identity =
                http.get()
                        .uri(uri)
                        .headers(headers -> headers.setBearerAuth(accessToken()))
                        .retrieve()
                        .body(CurrentIdentity.class);
        if (identity == null) {
            throw new IllegalStateException("Empty Keycloak identity response");
        }
        return identity;
    }

    /**
     * Realm là segment cuối của issuer URI OIDC đã cấu hình — nguồn duy nhất app tin cho cả tên
     * realm production lẫn realm TEST.
     */
    private static String realmOf(@Nullable String issuerUri) {
        String marker = "/realms/";
        int start = issuerUri == null ? -1 : issuerUri.lastIndexOf(marker);
        String realm =
                start < 0 ? "" : issuerUri.substring(start + marker.length()).replaceAll("/+$", "");
        if (realm.isBlank() || realm.contains("/")) {
            throw new IllegalStateException("Keycloak issuer URI has no realm: " + issuerUri);
        }
        return realm;
    }

    private static OAuth2AuthorizedClientManager clientManager(
            String baseUrl, String realm, String clientId, String secret) {
        ClientRegistration registration =
                ClientRegistration.withRegistrationId("giaokhoa-provisioner")
                        .clientId(clientId)
                        .clientSecret(secret)
                        .clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_POST)
                        .authorizationGrantType(AuthorizationGrantType.CLIENT_CREDENTIALS)
                        .tokenUri(baseUrl + "/realms/" + realm + "/protocol/openid-connect/token")
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
}
