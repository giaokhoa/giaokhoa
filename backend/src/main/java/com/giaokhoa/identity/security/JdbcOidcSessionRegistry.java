package com.giaokhoa.identity.security;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.client.oidc.authentication.logout.OidcLogoutToken;
import org.springframework.security.oauth2.client.oidc.session.OidcSessionInformation;
import org.springframework.security.oauth2.client.oidc.session.OidcSessionRegistry;
import org.springframework.security.oauth2.core.oidc.OidcIdToken;
import org.springframework.security.oauth2.core.oidc.user.DefaultOidcUser;
import org.springframework.util.Assert;

/** Persistent correlation for Spring Security's native OIDC back-channel logout. */
public final class JdbcOidcSessionRegistry implements OidcSessionRegistry {

    private static final String RETURNING = " RETURNING session_id, issuer, client_id, sub, sid,"
            + " csrf_header_name, csrf_token";

    private final JdbcTemplate jdbc;
    private final String clientId;

    public JdbcOidcSessionRegistry(JdbcTemplate jdbc, String clientId) {
        Assert.notNull(jdbc, "jdbc is required");
        Assert.hasText(clientId, "clientId is required");
        this.jdbc = jdbc;
        this.clientId = clientId;
    }

    @Override
    public void saveSessionInformation(OidcSessionInformation information) {
        Assert.notNull(information, "information is required");
        var principal = information.getPrincipal();
        Assert.notNull(principal.getIssuer(), "OIDC issuer is required");
        Assert.hasText(principal.getSubject(), "OIDC subject is required");
        Assert.isTrue(principal.getAudience() != null && principal.getAudience().contains(clientId),
                "OIDC audience must contain configured clientId");

        Map<String, String> authorities = information.getAuthorities();
        Assert.isTrue(authorities.size() <= 1, "Only the Spring CSRF header is supported");
        var csrf = authorities.entrySet().stream().findFirst().orElse(null);

        jdbc.update("INSERT INTO oidc_session_correlation"
                        + " (session_id, issuer, client_id, sub, sid, csrf_header_name, csrf_token)"
                        + " VALUES (?, ?, ?, ?, ?, ?, ?)"
                        + " ON CONFLICT (session_id) DO UPDATE SET"
                        + " issuer = EXCLUDED.issuer, client_id = EXCLUDED.client_id,"
                        + " sub = EXCLUDED.sub, sid = EXCLUDED.sid,"
                        + " csrf_header_name = EXCLUDED.csrf_header_name, csrf_token = EXCLUDED.csrf_token",
                information.getSessionId(), principal.getIssuer().toString(), clientId, principal.getSubject(),
                principal.getClaimAsString("sid"), csrf == null ? null : csrf.getKey(),
                csrf == null ? null : csrf.getValue());
    }

    @Override
    public OidcSessionInformation removeSessionInformation(String sessionId) {
        var removed = jdbc.query(
                "DELETE FROM oidc_session_correlation WHERE session_id = ?" + RETURNING,
                (rs, row) -> sessionInformation(rs), sessionId);
        return removed.isEmpty() ? null : removed.getFirst();
    }

    @Override
    public Iterable<OidcSessionInformation> removeSessionInformation(OidcLogoutToken logoutToken) {
        Assert.notNull(logoutToken, "logoutToken is required");
        // Require BOTH issuer and configured audience; never match another OIDC client.
        if (logoutToken.getIssuer() == null || logoutToken.getAudience() == null
                || !logoutToken.getAudience().contains(clientId)) {
            return List.of();
        }

        String sid = logoutToken.getSessionId();
        String subject = logoutToken.getSubject();
        if (sid == null && subject == null) {
            return List.of();
        }

        // Spring Session has already flushed by the time a provider logs out a browser.
        // Stale correlation must not select an expired/deleted session after a restart.
        String predicate = sid != null ? "c.sid = ?" : "c.sub = ?";
        return jdbc.query("DELETE FROM oidc_session_correlation c"
                        + " WHERE c.issuer = ? AND c.client_id = ? AND " + predicate
                        + " AND EXISTS (SELECT 1 FROM spring_session s WHERE s.session_id = c.session_id"
                        + " AND s.expiry_time > (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT)"
                        + RETURNING,
                (rs, row) -> sessionInformation(rs),
                logoutToken.getIssuer().toString(), clientId, sid != null ? sid : subject);
    }

    private static OidcSessionInformation sessionInformation(ResultSet rs) throws SQLException {
        // Spring's logout handler needs only sessionId and CSRF header, not an actual ID token.
        // Reconstruct a minimal principal so SessionIdChangedEvent can call withSessionId().
        Map<String, Object> claims = new HashMap<>();
        claims.put("iss", rs.getString("issuer"));
        claims.put("aud", List.of(rs.getString("client_id")));
        claims.put("sub", rs.getString("sub"));
        if (rs.getString("sid") != null) {
            claims.put("sid", rs.getString("sid"));
        }
        var idToken = new OidcIdToken("correlation-only", Instant.EPOCH,
                Instant.EPOCH.plusSeconds(1), claims);
        var principal = new DefaultOidcUser(List.of(), idToken, "sub");
        String header = rs.getString("csrf_header_name");
        Map<String, String> authorities = header == null ? Map.of()
                : Map.of(header, rs.getString("csrf_token"));
        return new OidcSessionInformation(rs.getString("session_id").trim(), authorities, principal);
    }
}
