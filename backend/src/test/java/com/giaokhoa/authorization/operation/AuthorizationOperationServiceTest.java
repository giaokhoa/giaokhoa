package com.giaokhoa.authorization.operation;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;

import com.giaokhoa.authorization.operation.AuthorizationOperationService.DesiredProjection;
import com.giaokhoa.authorization.operation.AuthorizationOperationService.PartitionChange;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class AuthorizationOperationServiceTest {
    private static final UUID PARTITION = UUID.fromString("33333333-3333-3333-3333-333333333333");
    private static final String TARGET = "workspace:44444444-4444-4444-4444-444444444444";

    private final AuthorizationOperationService service =
            new AuthorizationOperationService(
                    mock(JdbcTemplate.class), mock(IdempotencyService.class));

    private void apply(List<PartitionChange> changes) {
        service.applyDesiredState(UUID.randomUUID(), null, "key-1", "a".repeat(64), changes);
    }

    @Test
    void emptyChangesAreRejected() {
        assertThrows(IllegalArgumentException.class, () -> apply(List.of()));
    }

    @Test
    void duplicatePartitionsAreRejected() {
        PartitionChange change = new PartitionChange(PARTITION, List.of());
        assertThrows(IllegalArgumentException.class, () -> apply(List.of(change, change)));
    }

    @Test
    void unknownTargetKeysAreRejected() {
        PartitionChange change =
                new PartitionChange(
                        PARTITION,
                        List.of(new DesiredProjection("nowhere:1", "enter", List.of(), List.of())));
        assertThrows(IllegalArgumentException.class, () -> apply(List.of(change)));
    }

    @Test
    void scopesOutsideTheFixedSetAreRejected() {
        PartitionChange change =
                new PartitionChange(
                        PARTITION,
                        List.of(new DesiredProjection(TARGET, "fly", List.of(), List.of())));
        assertThrows(IllegalArgumentException.class, () -> apply(List.of(change)));
    }

    @Test
    void aProjectionCannotDependOnItsOwnPartition() {
        PartitionChange change =
                new PartitionChange(
                        PARTITION,
                        List.of(
                                new DesiredProjection(
                                        TARGET, "enter", List.of("source"), List.of(PARTITION))));
        assertThrows(IllegalArgumentException.class, () -> apply(List.of(change)));
    }
}
