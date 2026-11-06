package com.giaokhoa.authorization.projection;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockingDetails;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.giaokhoa.authorization.model.AuthorizationPartition;
import java.sql.Array;
import java.sql.ResultSet;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentMatchers;
import org.mockito.invocation.Invocation;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.SimpleTransactionStatus;

class ProjectionWorkerTest {
    private static final UUID OPERATION = UUID.fromString("55555555-5555-5555-5555-555555555555");
    private static final UUID PARTITION = UUID.fromString("66666666-6666-6666-6666-666666666666");

    @Test
    void backoffGrowsWithAttemptsAndIsCapped() {
        assertEquals(Duration.ofSeconds(5), ProjectionWorker.backoffFor(1));
        assertEquals(Duration.ofSeconds(10), ProjectionWorker.backoffFor(2));
        assertTrue(ProjectionWorker.backoffFor(3).compareTo(ProjectionWorker.backoffFor(2)) > 0);
        assertEquals(Duration.ofSeconds(60), ProjectionWorker.backoffFor(100));
        assertEquals(Duration.ofSeconds(5), ProjectionWorker.backoffFor(0));
    }

    @Test
    void anOperationWhoseClaimUpdateLosesTheRaceIsNotProcessed() throws Exception {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ProjectionReconciler reconciler = mock(ProjectionReconciler.class);
        stubQueue(jdbc);
        when(reconciler.partition(PARTITION))
                .thenReturn(
                        new ProjectionReconciler.PartitionRow(
                                PARTITION, 1L, 0L, AuthorizationPartition.State.PENDING));
        // Một instance khác thắng claim: update có điều kiện không khớp dòng nào.
        when(jdbc.update(contains("SET state = 'APPLYING'"), any(UUID.class))).thenReturn(0);

        new ProjectionWorker(jdbc, reconciler, stubTransactions()).poll();

        verify(reconciler, never()).partition(any());
    }

    @Test
    void aRevisionBumpedDuringReconcileEndsSupersededNotSucceeded() throws Exception {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ProjectionReconciler reconciler = mock(ProjectionReconciler.class);
        stubQueue(jdbc);
        when(jdbc.update(contains("SET state = 'APPLYING'"), any(UUID.class))).thenReturn(1);
        when(reconciler.partition(PARTITION))
                .thenReturn(
                        new ProjectionReconciler.PartitionRow(
                                PARTITION, 1L, 0L, AuthorizationPartition.State.PENDING));
        // Một mutation mới hơn đã bump desired revision sau kiểm tra trong vòng lặp.
        when(jdbc.queryForList(contains("desired_revision"), eq(Long.class), any()))
                .thenReturn(List.of(2L));

        new ProjectionWorker(jdbc, reconciler, stubTransactions()).poll();

        List<Invocation> updates =
                mockingDetails(jdbc).getInvocations().stream()
                        .filter(invocation -> "update".equals(invocation.getMethod().getName()))
                        .toList();
        assertFalse(
                updates.stream()
                        .anyMatch(invocation ->
                                String.valueOf(invocation.getArgument(0, Object.class))
                                        .contains("'SUCCEEDED'")),
                "The operation must not be marked SUCCEEDED at a stale revision");
        assertTrue(
                updates.stream()
                        .anyMatch(invocation -> {
                            List<Object> arguments = flattened(invocation);
                            return arguments.contains("FAILED")
                                    && arguments.contains(ProjectionWorker.ERROR_SUPERSEDED);
                        }),
                "The operation must end FAILED with SUPERSEDED_BY_NEWER_REVISION");
        assertFalse(
                updates.stream()
                        .anyMatch(invocation ->
                                String.valueOf(invocation.getArgument(0, Object.class))
                                        .contains("authz_partition SET state = 'FAILED'")),
                "A superseded operation must not fence partitions of the newer operation");
    }

    @Test
    void driftScanWindowRotatesThroughTheWholeReadySet() {
        List<UUID> ready = List.of(uuid(1), uuid(2), uuid(3), uuid(4), uuid(5), uuid(6), uuid(7));
        assertEquals(ready.subList(0, 5), ProjectionWorker.scanWindow(ready, null, 5));
        // Cửa sổ tiếp tục sau ID quét cuối cùng và vòng lại, nên các partition ngoài
        // trang đầu tiên được chạm tới thay vì mãi kiểm tra lại cùng năm partition cũ nhất.
        assertEquals(
                List.of(uuid(6), uuid(7), uuid(1), uuid(2), uuid(3)),
                ProjectionWorker.scanWindow(ready, uuid(5), 5));
        assertEquals(ready, ProjectionWorker.scanWindow(ready, uuid(7), 7));
        assertEquals(List.of(), ProjectionWorker.scanWindow(List.of(), null, 5));
    }

    @Test
    void aFailingOrphanedPartitionIsNotRetriedOnEveryPoll() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ProjectionReconciler reconciler = mock(ProjectionReconciler.class);
        when(jdbc.queryForList(anyString(), eq(UUID.class), anyInt()))
                .thenReturn(List.of(PARTITION));
        when(jdbc.queryForList(anyString(), eq(UUID.class))).thenReturn(List.of(PARTITION));
        when(reconciler.tryReconcilePartition(PARTITION)).thenReturn(false);
        ProjectionWorker worker = new ProjectionWorker(jdbc, reconciler, stubTransactions());

        worker.reconcileOrphanedPartitions();
        worker.reconcileOrphanedPartitions();

        // Poll thứ hai nằm trong cửa sổ backoff có giới hạn: không có lần thử mạng mới.
        verify(reconciler, times(1)).tryReconcilePartition(PARTITION);
    }

    private static UUID uuid(int suffix) {
        return UUID.fromString(String.format("00000000-0000-0000-0000-%012d", suffix));
    }

    /** Một operation PENDING tới hạn trên {@link #PARTITION} tại revision 1, attempt 0. */
    private static void stubQueue(JdbcTemplate jdbc) throws Exception {
        when(jdbc.query(anyString(), ArgumentMatchers.<RowMapper<Object>>any()))
                .thenAnswer(invocation -> {
                    RowMapper<Object> mapper = invocation.getArgument(1);
                    ResultSet rs = mock(ResultSet.class);
                    Array partitions = mock(Array.class);
                    when(partitions.getArray()).thenReturn(new Object[] {PARTITION});
                    Array revisions = mock(Array.class);
                    when(revisions.getArray()).thenReturn(new Object[] {1L});
                    when(rs.getObject("id", UUID.class)).thenReturn(OPERATION);
                    when(rs.getArray("affected_partitions")).thenReturn(partitions);
                    when(rs.getArray("affected_revisions")).thenReturn(revisions);
                    when(rs.getInt("attempt_count")).thenReturn(0);
                    when(rs.getString("state")).thenReturn("PENDING");
                    when(rs.getBoolean("due")).thenReturn(true);
                    return List.of(mapper.mapRow(rs, 0));
                });
        when(jdbc.queryForList(anyString(), eq(UUID.class), anyInt())).thenReturn(List.of());
        // Tập claimable khóa FOR UPDATE SKIP LOCKED chứa operation đang xếp hàng.
        when(jdbc.queryForList(anyString(), eq(UUID.class))).thenReturn(List.of(OPERATION));
    }

    private static List<Object> flattened(Invocation invocation) {
        List<Object> flat = new ArrayList<>();
        for (Object argument : invocation.getArguments()) {
            if (argument instanceof Object[] array) {
                flat.addAll(Arrays.asList(array));
            } else {
                flat.add(argument);
            }
        }
        return flat;
    }

    private static PlatformTransactionManager stubTransactions() {
        return new PlatformTransactionManager() {
            @Override
            public TransactionStatus getTransaction(TransactionDefinition definition) {
                return new SimpleTransactionStatus();
            }

            @Override
            public void commit(TransactionStatus status) {}

            @Override
            public void rollback(TransactionStatus status) {}
        };
    }
}
