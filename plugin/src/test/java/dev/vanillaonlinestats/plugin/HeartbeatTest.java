// SPDX-License-Identifier: AGPL-3.0-only
package dev.vanillaonlinestats.plugin;

import java.nio.file.Path;
import java.nio.file.Files;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.CountDownLatch;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class HeartbeatTest {
    @TempDir Path directory;
    Heartbeat sample() { return Heartbeat.sample(UUID.randomUUID(), "0.2.0-SNAPSHOT", "26.3", "26.3-227", "6.0.1-b2770", 1, 0); }

    @Test void exportRealJavaEnvelopeForApiContractTest() throws Exception {
        Files.writeString(Path.of("build/heartbeat-java.json"), sample().json());
    }

    @Test void identitySurvivesRestartAndCorruptionFailsClosed() throws Exception {
        UUID id = InstallationIdentity.load(directory);
        assertEquals(id, InstallationIdentity.load(directory));
        Files.writeString(directory.resolve("server-id.txt"), "corrupt");
        assertThrows(IllegalArgumentException.class, () -> InstallationIdentity.load(directory));
        assertEquals("corrupt", Files.readString(directory.resolve("server-id.txt")));
    }

    @Test void endpointRequiresTlsExceptExplicitLiteralLoopback() {
        assertDoesNotThrow(() -> HeartbeatTransport.endpoint("https://example.com/api/v1/agents/heartbeat", false));
        assertDoesNotThrow(() -> HeartbeatTransport.endpoint("http://127.0.0.1:3000/api/v1/agents/heartbeat", true));
        for (String endpoint : new String[] {"http://example.com/api/v1/agents/heartbeat",
                "http://localhost/api/v1/agents/heartbeat", "https://token@example.com/api/v1/agents/heartbeat",
                "https://example.com/api/v1/agents/heartbeat?token=secret", "https://example.com/other"}) {
            assertThrows(IllegalArgumentException.class, () -> HeartbeatTransport.endpoint(endpoint, true));
        }
        assertThrows(IllegalArgumentException.class, () -> HeartbeatTransport.endpoint("http://127.0.0.1/api/v1/agents/heartbeat", false));
    }

    @Test void boundedLatestSnapshotRetryBudgetBackoffAndRecovery() {
        AtomicInteger calls = new AtomicInteger();
        try (var transport = new HeartbeatTransport(json -> { calls.incrementAndGet(); return 503; })) {
            transport.offer(sample());
            transport.offer(sample());
            assertTrue(transport.status().contains("descartados=1"));
            transport.tick(0);
            transport.tick(0); // Backoff prevents busy retry.
            assertEquals(1, calls.get());
            transport.tick(TimeUnit.SECONDS.toNanos(100));
            transport.tick(TimeUnit.SECONDS.toNanos(200));
            transport.tick(TimeUnit.SECONDS.toNanos(300));
            assertEquals(3, calls.get());
            assertTrue(transport.status().contains("pendentes=0"));
        }
        try (var transport = new HeartbeatTransport(json -> 202)) {
            transport.offer(sample());
            transport.tick(0);
            assertTrue(transport.status().contains("enviados=1"));
            assertTrue(transport.status().contains("conectado"));
        }
    }

    @Test void authRejectionNotRetriedAndShutdownStopsSending() {
        AtomicInteger calls = new AtomicInteger();
        var transport = new HeartbeatTransport(json -> { calls.incrementAndGet(); return 401; });
        transport.offer(sample());
        transport.tick(0);
        transport.tick(TimeUnit.SECONDS.toNanos(100));
        assertEquals(1, calls.get());
        assertTrue(transport.status().contains("rejeitado pela API"));
        transport.close();
        transport.offer(sample());
        transport.tick(TimeUnit.SECONDS.toNanos(200));
        assertEquals(1, calls.get());
    }

    @Test void slowNetworkNeverBlocksTheCollectorAndShutdownInterruptsWorker() throws Exception {
        CountDownLatch entered = new CountDownLatch(1), interrupted = new CountDownLatch(1);
        var transport = new HeartbeatTransport(json -> {
            entered.countDown();
            try { new CountDownLatch(1).await(); }
            catch (InterruptedException exception) { interrupted.countDown(); throw exception; }
            return 202;
        });
        transport.offer(sample());
        transport.start();
        try {
            assertTrue(entered.await(3, TimeUnit.SECONDS));
            assertTimeout(Duration.ofMillis(100), () -> {
                for (int i = 0; i < 100; i++) transport.offer(sample());
            });
        } finally { transport.close(); }
        assertTrue(interrupted.await(3, TimeUnit.SECONDS));
    }

    @Test void acknowledgesOnlyTheActualMessageAndValidReceipt() {
        Heartbeat message = sample();
        String ack = "{\"messageId\":\"" + message.messageId()
                + "\",\"receivedAt\":\"2026-10-28T22:00:00Z\",\"duplicate\":false}";
        assertEquals(202, HeartbeatTransport.acknowledgement(202, message.json(), ack));
        assertEquals(502, HeartbeatTransport.acknowledgement(200, message.json(), "OK"));
        assertEquals(502, HeartbeatTransport.acknowledgement(202, message.json(), "{}"));
        assertEquals(502, HeartbeatTransport.acknowledgement(202, message.json(), ack.replace(message.messageId(), UUID.randomUUID().toString())));
        assertEquals(401, HeartbeatTransport.acknowledgement(401, message.json(), ""));
    }
}
