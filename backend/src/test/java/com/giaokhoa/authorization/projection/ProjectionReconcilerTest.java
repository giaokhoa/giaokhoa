package com.giaokhoa.authorization.projection;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.giaokhoa.authorization.policy.PolicyGraph;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class ProjectionReconcilerTest {
    private static final UUID WORKSPACE = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID USER = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final String TARGET = "workspace:" + WORKSPACE;

    @Test
    void personalOwnerDescriptorMatchesTheContractFormat() {
        String descriptor =
                ProjectionReconciler.personalOwnerDescriptor(
                        WORKSPACE, USER, "keycloak-subject", TARGET, "enter");
        assertEquals(
                "PERSONAL_OWNER|workspace="
                        + WORKSPACE
                        + "|user="
                        + USER
                        + "|subject=keycloak-subject|target="
                        + TARGET
                        + "|scope=enter",
                descriptor);
    }

    @Test
    void desiredHashOfOneSourceIsTheHashOfItsDescriptor() throws Exception {
        String descriptor =
                ProjectionReconciler.personalOwnerDescriptor(
                        WORKSPACE, USER, "keycloak-subject", TARGET, "enter");
        assertEquals(
                sha256(descriptor),
                ProjectionReconciler.desiredHash(TARGET, "enter", List.of(descriptor)));
    }

    @Test
    void desiredHashIgnoresSourceOrderAndDuplicates() {
        String first =
                ProjectionReconciler.personalOwnerDescriptor(
                        WORKSPACE, USER, "sub-a", TARGET, "read");
        String second =
                ProjectionReconciler.personalOwnerDescriptor(
                        WORKSPACE, USER, "sub-b", TARGET, "read");
        assertEquals(
                ProjectionReconciler.desiredHash(TARGET, "read", List.of(first, second)),
                ProjectionReconciler.desiredHash(TARGET, "read", List.of(second, first, first)));
    }

    @Test
    void emptySourcesHashTheRetractDescriptor() throws Exception {
        assertEquals(
                sha256(ProjectionReconciler.retractDescriptor(TARGET, "enter")),
                ProjectionReconciler.desiredHash(TARGET, "enter", List.of()));
    }

    @Test
    void graphForBuildsAnActorSourceFromTheDescriptor() {
        String descriptor =
                ProjectionReconciler.personalOwnerDescriptor(
                        WORKSPACE, USER, "keycloak-subject", TARGET, "enter");
        PolicyGraph graph = ProjectionReconciler.graphFor(TARGET, "enter", List.of(descriptor));
        assertEquals(TARGET, graph.targetKey());
        assertEquals("enter", graph.scope());
        assertTrue(graph.commonGates().isEmpty());
        assertEquals(
                List.of(new PolicyGraph.Gate.Actor("keycloak-subject")),
                graph.sources().getFirst().gates());
    }

    @Test
    void graphForRejectsUnknownSourceDescriptors() {
        assertThrows(
                IllegalArgumentException.class,
                () -> ProjectionReconciler.graphFor(TARGET, "enter", List.of("UNKNOWN|x=1")));
    }

    private static String sha256(String value) throws Exception {
        return HexFormat.of()
                .formatHex(
                        MessageDigest.getInstance("SHA-256")
                                .digest(value.getBytes(StandardCharsets.UTF_8)));
    }
}
