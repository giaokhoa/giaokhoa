package com.giaokhoa.authorization.policy;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.PreparedStatement;
import java.util.function.Supplier;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcOperations;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Serializes Keycloak resource mutations across application instances using the shared PostgreSQL
 * database. A transaction-scoped advisory lock covers the entire read/modify/write/read-back
 * sequence, including all scopes of one target resource; an in-process synchronized block is not
 * sufficient when multiple workers provision the same Keycloak resource.
 */
@Component
public class ResourceMutationCoordinator {
    private final JdbcOperations jdbc;
    private final PlatformTransactionManager transactions;

    public ResourceMutationCoordinator(
            JdbcOperations jdbc, PlatformTransactionManager transactions) {
        this.jdbc = jdbc;
        this.transactions = transactions;
    }

    public <T> T withResourceLock(String targetKey, Supplier<T> action) {
        TransactionTemplate tx = new TransactionTemplate(transactions);
        tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        return tx.execute(status -> {
            long lockId = lockId(targetKey);
            jdbc.execute(
                    (ConnectionCallback<Void>)
                            connection -> {
                                try (PreparedStatement statement =
                                        connection.prepareStatement(
                                                "SELECT pg_advisory_xact_lock(?)")) {
                                    statement.setLong(1, lockId);
                                    statement.execute();
                                }
                                return null;
                            });
            return action.get();
        });
    }

    private static long lockId(String targetKey) {
        try {
            // Stable across JVMs, and namespaced to avoid collisions with unrelated advisory locks.
            byte[] digest =
                    MessageDigest.getInstance("SHA-256")
                            .digest(
                                    ("giaokhoa:policy-resource:" + targetKey)
                                            .getBytes(StandardCharsets.UTF_8));
            return ByteBuffer.wrap(digest).getLong();
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 is required", ex);
        }
    }
}
