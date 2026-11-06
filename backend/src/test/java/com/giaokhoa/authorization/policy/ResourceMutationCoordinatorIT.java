package com.giaokhoa.authorization.policy;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.giaokhoa.support.IntegrationEnvironment;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * Chứng minh tuần tự hóa xuyên instance trên TEST PostgreSQL chuyên dụng, không phải mutex trong
 * JVM.
 */
@SpringBootTest
class ResourceMutationCoordinatorIT extends IntegrationEnvironment {
    private static final String SCHEMA =
            "policy_resource_lock_it_" + UUID.randomUUID().toString().replace("-", "");

    @DynamicPropertySource
    static void isolatedSchema(DynamicPropertyRegistry registry) {
        registry.add("spring.flyway.schemas", () -> SCHEMA);
        registry.add("spring.flyway.default-schema", () -> SCHEMA);
        registry.add(
                "spring.datasource.hikari.connection-init-sql",
                () -> "SET search_path TO " + SCHEMA + ",public");
    }

    @AfterAll
    static void removeIsolatedSchema(@Autowired JdbcTemplate jdbc) {
        jdbc.execute("DROP SCHEMA IF EXISTS " + SCHEMA + " CASCADE");
    }

    @Autowired JdbcTemplate jdbc;
    @Autowired PlatformTransactionManager transactions;

    @Test
    void twoWorkerInstancesSerializeMutationsForTheSameResource() throws Exception {
        // Các đối tượng coordinator độc lập mô phỏng các application worker riêng biệt.
        ResourceMutationCoordinator firstWorker =
                new ResourceMutationCoordinator(jdbc, transactions);
        ResourceMutationCoordinator secondWorker =
                new ResourceMutationCoordinator(jdbc, transactions);
        String resource = "workspace:concurrent-resource-" + java.util.UUID.randomUUID();
        CountDownLatch firstEntered = new CountDownLatch(1);
        CountDownLatch releaseFirst = new CountDownLatch(1);
        CountDownLatch secondStarted = new CountDownLatch(1);
        CountDownLatch secondEntered = new CountDownLatch(1);

        try (var pool = Executors.newFixedThreadPool(2)) {
            var first =
                    pool.submit(() ->
                            firstWorker.withResourceLock(
                                    resource,
                                    () -> {
                                        firstEntered.countDown();
                                        await(releaseFirst);
                                        return null;
                                    }));
            assertTrue(firstEntered.await(10, TimeUnit.SECONDS));
            var second =
                    pool.submit(() -> {
                        secondStarted.countDown();
                        secondWorker.withResourceLock(
                                resource,
                                () -> {
                                    secondEntered.countDown();
                                    return null;
                                });
                    });
            try {
                assertTrue(secondStarted.await(10, TimeUnit.SECONDS));
                assertFalse(
                        secondEntered.await(250, TimeUnit.MILLISECONDS),
                        "Second worker entered before the first transaction released its lock");
            } finally {
                releaseFirst.countDown();
            }
            first.get(10, TimeUnit.SECONDS);
            second.get(10, TimeUnit.SECONDS);
            assertTrue(secondEntered.await(1, TimeUnit.SECONDS));
        } finally {
            releaseFirst.countDown();
        }
    }

    private static void await(CountDownLatch latch) {
        try {
            if (!latch.await(10, TimeUnit.SECONDS)) {
                throw new IllegalStateException("Timed out waiting for lock release");
            }
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Interrupted while holding resource lock", ex);
        }
    }
}
