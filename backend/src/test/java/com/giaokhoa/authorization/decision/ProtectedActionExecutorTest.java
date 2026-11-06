package com.giaokhoa.authorization.decision;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.giaokhoa.authorization.fence.AuthorizationFence;
import com.giaokhoa.authorization.fence.DependencyManifestResolver;
import com.giaokhoa.authorization.fence.DependencyManifestResolver.Manifest;
import com.giaokhoa.authorization.policy.PolicyGraphWriter;
import com.giaokhoa.shared.http.HttpProblemException;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.invocation.InvocationOnMock;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.core.Authentication;

class ProtectedActionExecutorTest {
    private static final UUID ACTOR = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID WORKSPACE = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final String KEY = "workspace:" + WORKSPACE;
    private static final ProtectedActionExecutor.Target TARGET =
            new ProtectedActionExecutor.Target(KEY, List.of("enter"));

    @Test
    void evaluateUsesTheRecordedResourceIdAndReturnsEveryPair() {
        Fixture fixture = new Fixture(Map.of(KEY, "recorded-resource"));
        when(fixture.decisions.isAllowed(any(), any(), any())).thenReturn(true);

        var result =
                fixture.executor.evaluate(
                        fixture.authentication,
                        new MockHttpServletRequest(),
                        WORKSPACE,
                        List.of(TARGET));

        assertTrue(result.allowed(KEY, "enter"));
        verify(fixture.writer, never()).findResourceId(any());
    }

    @Test
    void evaluateDecidesOnTheSnapshotManifestWhenTheFenceReResolvedTheClosure() {
        Fixture fixture = new Fixture(Map.of(KEY, "stale-resource"));
        Manifest snapshotManifest =
                new Manifest(
                        ACTOR,
                        WORKSPACE,
                        List.of(KEY),
                        Map.of(KEY, "snapshot-resource"),
                        List.of());
        when(fixture.fence.acquire(any()))
                .thenReturn(new AuthorizationFence.Snapshot(snapshotManifest, Map.of()));
        when(fixture.decisions.isAllowed(any(), any(), any())).thenReturn(true);

        var result =
                fixture.executor.evaluate(
                        fixture.authentication,
                        new MockHttpServletRequest(),
                        WORKSPACE,
                        List.of(TARGET));

        assertTrue(result.allowed(KEY, "enter"));
        ArgumentCaptor<RequiredPermissions> asked =
                ArgumentCaptor.forClass(RequiredPermissions.class);
        verify(fixture.decisions).isAllowed(any(), any(), asked.capture());
        assertEquals("snapshot-resource", asked.getValue().permissions().getFirst().resourceId());
        verify(fixture.writer, never()).findResourceId(any());
    }

    @Test
    void evaluateFallsBackToTheNativeResourceNameAndDeniesWhenNoResourceExists() {
        Fixture fixture = new Fixture(Map.of());
        when(fixture.writer.findResourceId(KEY)).thenReturn(Optional.empty());

        var result =
                fixture.executor.evaluate(
                        fixture.authentication,
                        new MockHttpServletRequest(),
                        WORKSPACE,
                        List.of(TARGET));

        assertFalse(result.allowed(KEY, "enter"));
        verify(fixture.decisions, never()).isAllowed(any(), any(), any());
    }

    @Test
    void executeAbortsWith403BeforeTheActionWhenAnyPairIsDenied() {
        Fixture fixture = new Fixture(Map.of(KEY, "recorded-resource"));
        when(fixture.decisions.isAllowed(any(), any(), any())).thenReturn(false);
        AtomicBoolean ran = new AtomicBoolean();

        HttpProblemException problem =
                assertThrows(
                        HttpProblemException.class,
                        () ->
                                fixture.executor.execute(
                                        fixture.authentication,
                                        new MockHttpServletRequest(),
                                        WORKSPACE,
                                        List.of(TARGET),
                                        () -> {
                                            ran.set(true);
                                            return "done";
                                        }));

        assertEquals(HttpStatus.FORBIDDEN, problem.getStatus());
        assertFalse(ran.get(), "A denied action must never run");
    }

    @Test
    void executeRunsTheActionWhenEveryPairIsAllowed() {
        Fixture fixture = new Fixture(Map.of(KEY, "recorded-resource"));
        when(fixture.decisions.isAllowed(any(), any(), any())).thenReturn(true);

        String result =
                fixture.executor.execute(
                        fixture.authentication,
                        new MockHttpServletRequest(),
                        WORKSPACE,
                        List.of(TARGET),
                        () -> "done");

        assertEquals("done", result);
    }

    @Test
    void aRevisionChangeRestartsThePipelineWithAFreshManifest() {
        Fixture fixture = new Fixture(Map.of(KEY, "recorded-resource"));
        when(fixture.decisions.isAllowed(any(), any(), any())).thenReturn(true);
        fixture.confirmationsToSkip.set(1);

        var result =
                fixture.executor.evaluate(
                        fixture.authentication,
                        new MockHttpServletRequest(),
                        WORKSPACE,
                        List.of(TARGET));

        assertTrue(result.allowed(KEY, "enter"));
        verify(fixture.resolver, times(2)).resolve(ACTOR, WORKSPACE, List.of(KEY));
    }

    // Mockito hands back the executor's own supplier untyped; the cast is safe by construction.
    @SuppressWarnings("unchecked")
    private static Object runSupplier(InvocationOnMock invocation) {
        return ((Supplier<Object>) invocation.getArgument(1)).get();
    }

    private static final class Fixture {
        final DependencyManifestResolver resolver = mock(DependencyManifestResolver.class);
        final AuthorizationFence fence = mock(AuthorizationFence.class);
        final KeycloakDecisionClient decisions = mock(KeycloakDecisionClient.class);
        final PolicyGraphWriter writer = mock(PolicyGraphWriter.class);
        final JdbcTemplate jdbc = mock(JdbcTemplate.class);
        final Authentication authentication = mock(Authentication.class);
        final AtomicInteger confirmationsToSkip = new AtomicInteger();
        final ProtectedActionExecutor executor;

        Fixture(Map<String, String> recordedResourceIds) {
            Manifest manifest =
                    new Manifest(ACTOR, WORKSPACE, List.of(KEY), recordedResourceIds, List.of());
            when(resolver.resolve(ACTOR, WORKSPACE, List.of(KEY))).thenReturn(manifest);
            when(fence.acquire(manifest))
                    .thenReturn(new AuthorizationFence.Snapshot(manifest, Map.of()));
            when(fence.atSnapshot(any(), any()))
                    .thenAnswer(invocation -> {
                        if (confirmationsToSkip.getAndDecrement() > 0) {
                            throw new AuthorizationFence.ClosureChangedException();
                        }
                        return runSupplier(invocation);
                    });
            when(jdbc.queryForList(contains("FROM user_account"), eq(UUID.class), any()))
                    .thenReturn(List.of(ACTOR));
            when(authentication.getName()).thenReturn("keycloak-subject");
            executor = new ProtectedActionExecutor(resolver, fence, decisions, writer, jdbc);
        }
    }
}
