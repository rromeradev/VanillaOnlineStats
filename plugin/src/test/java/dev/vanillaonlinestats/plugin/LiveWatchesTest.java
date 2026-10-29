// SPDX-License-Identifier: AGPL-3.0-only
package dev.vanillaonlinestats.plugin;

import static org.junit.jupiter.api.Assertions.*;

import com.google.gson.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.atomic.*;
import org.junit.jupiter.api.Test;

class LiveWatchesTest {
  private ControlSecurity.Request request(UUID id, UUID actor, String operation, boolean stop) {
    return new ControlSecurity.Request(
        UUID.randomUUID(),
        actor,
        "PLAYER",
        operation,
        "watch",
        Telemetry.object(
            "watchId",
            id.toString(),
            "query",
            Telemetry.object("playerId", actor.toString()),
            "stop",
            stop),
        Instant.now().plusSeconds(20),
        "LOW",
        false,
        UUID.randomUUID(),
        UUID.randomUUID());
  }

  @Test
  void sendsOnlyChangesAndUnsubscribeStopsReading() throws Exception {
    var value = new AtomicInteger(1);
    var reads = new AtomicInteger();
    var packets = new ArrayList<JsonObject>();
    var id = UUID.randomUUID();
    var actor = UUID.randomUUID();
    var watches =
        new LiveWatches(
            2_000_000,
            q -> {
              reads.incrementAndGet();
              assertEquals("query", q.kind());
              return Telemetry.object("amount", value.get());
            },
            (key, packet) -> {
              assertEquals(id, key);
              packets.add(packet);
            });
    watches.accept(request(id, actor, "player.inventory", false));
    watches.tick();
    assertEquals(1, packets.size());
    Thread.sleep(220);
    watches.tick();
    assertEquals(1, packets.size());
    watches.accept(request(id, actor, "player.inventory", false));
    value.set(2);
    Thread.sleep(220);
    watches.tick();
    assertEquals(2, packets.size());
    assertEquals(2, packets.get(1).get("sequence").getAsInt());
    watches.accept(request(id, actor, "player.inventory", true));
    int before = reads.get();
    watches.tick();
    assertEquals(before, reads.get());
    assertEquals(0, watches.size());
  }

  @Test
  void refusesWritesAndRebindingAnotherActor() {
    var watches = new LiveWatches(2_000_000, q -> new JsonObject(), (key, packet) -> {});
    var id = UUID.randomUUID();
    var actor = UUID.randomUUID();
    assertThrows(
        IllegalArgumentException.class,
        () -> watches.accept(request(id, actor, "server.broadcast", false)));
    watches.accept(request(id, actor, "player.inventory", false));
    assertThrows(
        IllegalArgumentException.class,
        () -> watches.accept(request(id, UUID.randomUUID(), "player.inventory", false)));
    watches.clear();
    assertEquals(0, watches.size());
  }
}
