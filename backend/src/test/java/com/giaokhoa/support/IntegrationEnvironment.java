package com.giaokhoa.support;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Duration;
import org.springframework.context.ApplicationContext;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Lớp base cho các integration test opt-in chạy trên Compose TEST stack cục bộ tách biệt. Không bao
 * giờ chạy chúng trên cơ sở dữ liệu hay realm DEV.
 */
@ActiveProfiles("integration")
public abstract class IntegrationEnvironment { // NOPMD - Lớp base TEST để kế thừa.
    // shortcut: Fixture này chỉ nhắm Compose TEST cục bộ; TEST bên ngoài cần một allowlist
    // được kiểm chứng riêng.
    private static final String TEST_DB = "jdbc:postgresql://127.0.0.1:15432/giaokhoa_test";
    private static final String TEST_ISSUER = "http://127.0.0.1:18081/realms/giaokhoa-it";
    // Làn 2: stack TEST chuyên dụng thứ hai đã kiểm chứng (cùng realm/credential như làn 1,
    // chỉ khác cổng). DB và issuer phải đi cùng làn — cặp chéo vẫn bị từ chối.
    private static final String TEST_DB_LANE_2 = "jdbc:postgresql://127.0.0.1:15433/giaokhoa_test";
    private static final String TEST_ISSUER_LANE_2 = "http://127.0.0.1:18082/realms/giaokhoa-it";

    @DynamicPropertySource
    static void testServices(DynamicPropertyRegistry registry) {
        String database = required("TEST_DATABASE_URL");
        String issuer =
                required("TEST_KEYCLOAK_BASE_URL").replaceAll("/+$", "")
                        + "/realms/"
                        + required("TEST_KEYCLOAK_REALM");
        validateTargets(database, issuer);

        registry.add("spring.datasource.url", () -> database);
        registry.add("spring.datasource.username", () -> required("TEST_DATABASE_USERNAME"));
        registry.add("spring.datasource.password", () -> required("TEST_DATABASE_PASSWORD"));
        registry.add("spring.flyway.user", () -> required("TEST_DATABASE_MIGRATOR_USERNAME"));
        registry.add("spring.flyway.password", () -> required("TEST_DATABASE_MIGRATOR_PASSWORD"));
        registry.add("spring.security.oauth2.client.provider.keycloak.issuer-uri", () -> issuer);
        registry.add(
                "spring.security.oauth2.client.registration.keycloak.client-id",
                () -> required("TEST_OIDC_CLIENT_ID"));
        registry.add(
                "spring.security.oauth2.client.registration.keycloak.client-secret",
                () -> required("TEST_OIDC_CLIENT_SECRET"));
    }

    /**
     * Teardown cho class cần worker thật (không mock được): đóng context để scheduler dừng hẳn, chờ
     * khóa của lượt poll đang chạy dở trên schema tan hết, rồi DROP bằng connection độc lập vì pool
     * đã đóng theo context. Class dùng cách này phải kèm {@code @DirtiesContext} để context đã đóng
     * bị loại khỏi cache của Spring Test thay vì được trao lại cho class sau.
     */
    protected static void closeContextAndDropSchema(ApplicationContext context, String schema) {
        ((ConfigurableApplicationContext) context).close();
        try (Connection connection =
                        DriverManager.getConnection(
                                required("TEST_DATABASE_URL"),
                                required("TEST_DATABASE_USERNAME"),
                                required("TEST_DATABASE_PASSWORD"));
                Statement statement = connection.createStatement()) {
            awaitSchemaLocksReleased(connection, schema);
            statement.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        } catch (SQLException ex) {
            throw new IllegalStateException("Không DROP được schema " + schema, ex);
        }
    }

    private static void awaitSchemaLocksReleased(Connection connection, String schema)
            throws SQLException {
        long deadline = System.nanoTime() + Duration.ofSeconds(60).toNanos();
        while (System.nanoTime() < deadline) {
            try (PreparedStatement locks =
                    connection.prepareStatement(
                            "SELECT count(*) FROM pg_locks l"
                                    + " JOIN pg_class c ON c.oid = l.relation"
                                    + " JOIN pg_namespace n ON n.oid = c.relnamespace"
                                    + " WHERE n.nspname = ? AND l.pid <> pg_backend_pid()")) {
                locks.setString(1, schema);
                try (ResultSet result = locks.executeQuery()) {
                    if (result.next() && result.getLong(1) == 0) {
                        return;
                    }
                }
            }
            try {
                Thread.sleep(250);
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }

    static void validateTargets(String database, String issuer) {
        boolean lane1 = TEST_DB.equals(database) && TEST_ISSUER.equals(issuer);
        boolean lane2 = TEST_DB_LANE_2.equals(database) && TEST_ISSUER_LANE_2.equals(issuer);
        if (!lane1 && !lane2) {
            throw new IllegalArgumentException(
                    "Integration tests require the dedicated local TEST database and issuer");
        }
    }

    static String required(String key) {
        String value = System.getenv(key);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("Missing integration environment variable: " + key);
        }
        return value;
    }
}
