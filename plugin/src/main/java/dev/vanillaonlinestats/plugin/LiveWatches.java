// SPDX-License-Identifier: AGPL-3.0-only
package dev.vanillaonlinestats.plugin;

import com.google.gson.*;
import java.time.Instant;
import java.util.*;
import java.util.function.*;

/** Main-thread, bounded sampling of signed read-only subscriptions; sends changes only. */
final class LiveWatches {
  static final Set<String> QUERIES =
      Set.of(
          "server.snapshot",
          "server.performance",
          "worlds.list",
          "world.snapshot",
          "chunk.snapshot",
          "block.snapshot",
          "entity.snapshot",
          "player.snapshot",
          "player.inventory",
          "player.statistics",
          "player.advancements",
          "statistics.catalog",
          "host.filesystem",
          "integrations.status",
          "integration.luckperms",
          "integration.vault",
          "integration.placeholder",
          "server.bans",
          "server.operators",
          "server.whitelist");

  private static final class Entry {
    final ControlSecurity.Request request;
    Instant until;
    long due, sequence;
    final String epoch = UUID.randomUUID().toString();
    JsonObject last;

    Entry(ControlSecurity.Request request) {
      this.request = request;
      renew();
    }

    void renew() {
      until = Instant.now().plusSeconds(75);
    }
  }

  private final Map<UUID, Entry> entries = new LinkedHashMap<>();
  private final long budget;
  private final Function<ControlSecurity.Request, JsonObject> read;
  private final BiConsumer<UUID, JsonObject> send;
  private int cursor;

  LiveWatches(
      long budget,
      Function<ControlSecurity.Request, JsonObject> read,
      BiConsumer<UUID, JsonObject> send) {
    this.budget = budget;
    this.read = read;
    this.send = send;
  }

  synchronized void accept(ControlSecurity.Request request) {
    var args = request.arguments();
    if (!request.kind().equals("watch")
        || !QUERIES.contains(request.operation())
        || !args.keySet().equals(Set.of("watchId", "query", "stop"))
        || !args.get("query").isJsonObject()
        || !args.get("stop").isJsonPrimitive()
        || !args.get("stop").getAsJsonPrimitive().isBoolean())
      throw new IllegalArgumentException("watch");
    UUID id = UUID.fromString(args.get("watchId").getAsString());
    var existing = entries.get(id);
    if (existing != null
        && (!existing.request.actorId().equals(request.actorId())
            || !existing.request.operation().equals(request.operation())
            || !existing.request.arguments().get("query").equals(args.get("query"))))
      throw new IllegalArgumentException("watch scope");
    if (args.get("stop").getAsBoolean()) {
      entries.remove(id);
      return;
    }
    if (existing != null) {
      existing.renew();
      return;
    }
    if (entries.size() >= 64) throw new ControlFailure("SUBSCRIPTION_LIMIT");
    entries.put(id, new Entry(request));
  }

  synchronized void tick() {
    var now = Instant.now();
    entries.values().removeIf(e -> !e.until.isAfter(now));
    var values = new ArrayList<>(entries.entrySet());
    if (values.isEmpty()) return;
    long start = System.nanoTime();
    int sampled = 0;
    for (int checked = 0; checked < values.size() && sampled < 4; checked++) {
      var item = values.get(Math.floorMod(cursor++, values.size()));
      var entry = item.getValue();
      if (System.nanoTime() < entry.due) continue;
      entry.due = System.nanoTime() + 200_000_000L;
      sampled++;
      var original = entry.request;
      var query =
          new ControlSecurity.Request(
              original.actionId(),
              original.actorId(),
              original.role(),
              original.operation(),
              "query",
              original.arguments().getAsJsonObject("query"),
              Instant.now().plusSeconds(5),
              "LOW",
              false,
              original.nonce(),
              original.auditId());
      JsonObject result;
      try {
        result = Telemetry.object("state", "SUCCEEDED", "payload", read.apply(query));
      } catch (Exception error) {
        result =
            Telemetry.object(
                "state",
                "FAILED",
                "payload",
                Telemetry.object(
                    "reasonCode",
                    error instanceof ControlFailure failure ? failure.code : "INVALID_ARGUMENTS"));
      }
      if (result.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 64000)
        result =
            Telemetry.object(
                "state", "FAILED", "payload", Telemetry.object("reasonCode", "PAYLOAD_LIMIT"));
      if (!result.equals(entry.last)) {
        entry.last = result.deepCopy();
        result.addProperty("sequence", ++entry.sequence);
        result.addProperty("epoch", entry.epoch);
        result.addProperty("observedAt", Instant.now().toString());
        send.accept(item.getKey(), result);
      }
      if (System.nanoTime() - start >= budget) break;
    }
    if (cursor > 1000000) cursor = 0;
  }

  synchronized void clear() {
    entries.clear();
  }

  synchronized int size() {
    return entries.size();
  }
}
