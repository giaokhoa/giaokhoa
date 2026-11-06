package com.giaokhoa.authorization.projection;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Duration;
import org.junit.jupiter.api.Test;

class ProjectionWorkerTest {
    @Test
    void backoffGrowsWithAttemptsAndIsCapped() {
        assertEquals(Duration.ofSeconds(5), ProjectionWorker.backoffFor(1));
        assertEquals(Duration.ofSeconds(10), ProjectionWorker.backoffFor(2));
        assertTrue(ProjectionWorker.backoffFor(3).compareTo(ProjectionWorker.backoffFor(2)) > 0);
        assertEquals(Duration.ofSeconds(60), ProjectionWorker.backoffFor(100));
        assertEquals(Duration.ofSeconds(5), ProjectionWorker.backoffFor(0));
    }
}
