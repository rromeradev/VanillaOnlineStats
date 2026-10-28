// SPDX-License-Identifier: AGPL-3.0-only
package dev.vanillaonlinestats.plugin;

import static dev.vanillaonlinestats.plugin.Telemetry.object;

import com.google.gson.*;
import java.util.*;
import org.bukkit.plugin.java.JavaPlugin;

final class CollectorRegistry {
  private record Collector(String id, int every, Runnable task) {}

  private final List<Collector> collectors = new ArrayList<>();
  private final Map<String, Long> failures = new LinkedHashMap<>(),
      durations = new LinkedHashMap<>(),
      runs = new LinkedHashMap<>();
  private final Settings settings;
  private int cycle, playerCursor, worldCursor, nextCollector;
  private long budgetExceeded;
  private final Map<String, Integer> due = new HashMap<>();

  CollectorRegistry(
      JavaPlugin plugin, Settings settings, Snapshots snapshots, Telemetry bus, AuthMeBridge auth) {
    this.settings = settings;
    collectors.add(
        new Collector(
            "performance",
            1,
            () -> bus.emit("server.performance.snapshot", snapshots.performance(), false)));
    collectors.add(
        new Collector(
            "server", 6, () -> bus.emit("server.metadata.snapshot", snapshots.server(), false)));
    collectors.add(
        new Collector(
            "worlds",
            3,
            () -> {
              var worlds = plugin.getServer().getWorlds();
              JsonArray values = new JsonArray();
              for (int i = 0; i < Math.min(settings.maxWorlds(), worlds.size()); i++)
                values.add(snapshots.world(worlds.get((worldCursor + i) % worlds.size())));
              worldCursor = worlds.isEmpty() ? 0 : (worldCursor + values.size()) % worlds.size();
              bus.emit(
                  "worlds.snapshot",
                  object(
                      "items",
                      values,
                      "sampled",
                      values.size(),
                      "total",
                      worlds.size(),
                      "partial",
                      values.size() < worlds.size()),
                  false);
            }));
    if (settings.players())
      collectors.add(
          new Collector(
              "players",
              1,
              () -> {
                var players =
                    plugin.getServer().getOnlinePlayers().toArray(org.bukkit.entity.Player[]::new);
                JsonArray values = new JsonArray();
                for (int i = 0; i < Math.min(settings.maxPlayers(), players.length); i++) {
                  var player = players[(playerCursor + i) % players.length];
                  if (auth.authenticated(player)) values.add(snapshots.player(player, false));
                }
                playerCursor =
                    players.length == 0
                        ? 0
                        : (playerCursor + Math.min(settings.maxPlayers(), players.length))
                            % players.length;
                bus.emit(
                    "players.snapshot",
                    object(
                        "items",
                        values,
                        "online",
                        players.length,
                        "partial",
                        players.length > settings.maxPlayers()),
                    false);
              }));
    if (plugin.getConfig().getBoolean("collectors.chunks", false))
      collectors.add(
          new Collector(
              "chunks",
              6,
              () -> {
                JsonArray values = new JsonArray();
                long deadline = System.nanoTime() + settings.budgetNanos();
                int sampled = 0;
                boolean partial = false;
                for (var world : plugin.getServer().getWorlds()) {
                  if (sampled >= settings.maxChunks() || System.nanoTime() > deadline) {
                    partial = true;
                    break;
                  }
                  var chunks = world.getLoadedChunks();
                  for (int i = 0; i < chunks.length; i++) {
                    if (sampled >= settings.maxChunks() || System.nanoTime() > deadline) {
                      partial = true;
                      break;
                    }
                    var chunk = chunks[(cycle + i) % chunks.length];
                    values.add(snapshots.chunk(world, chunk.getX(), chunk.getZ()));
                    sampled++;
                  }
                }
                bus.emit(
                    "chunks.sample",
                    object("items", values, "partial", partial, "sampled", sampled),
                    false);
              }));
    plugin.getServer().getScheduler().runTaskTimer(plugin, this::tick, 20, settings.periodTicks());
  }

  void tick() {
    cycle++;
    long start = System.nanoTime();
    for (int i = 0; i < collectors.size(); i++) {
      Collector collector = collectors.get(nextCollector);
      nextCollector = (nextCollector + 1) % collectors.size();
      if (cycle < due.getOrDefault(collector.id, 0)) continue;
      if (System.nanoTime() - start > settings.budgetNanos()) {
        budgetExceeded++;
        break;
      }
      long before = System.nanoTime();
      try {
        collector.task.run();
        runs.merge(collector.id, 1L, Long::sum);
      } catch (RuntimeException failure) {
        failures.merge(collector.id, 1L, Long::sum);
      }
      durations.put(collector.id, System.nanoTime() - before);
      due.put(collector.id, cycle + collector.every);
    }
  }

  JsonObject status() {
    return object(
        "runs",
        runs,
        "failures",
        failures,
        "lastDurationNanos",
        durations,
        "budgetExceeded",
        budgetExceeded,
        "budgetNanos",
        settings.budgetNanos());
  }

  JsonObject capabilities() {
    return object(
        "schemaVersion",
        1,
        "collectors",
        collectors.stream().map(Collector::id).toList(),
        "privacy",
        object(
            "players",
            settings.players(),
            "positions",
            settings.positions(),
            "inventories",
            settings.inventories(),
            "addresses",
            settings.addresses(),
            "seeds",
            settings.seeds()),
        "queries",
        List.of(
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
            "integration.placeholder"),
        "unsupported",
        List.of(
            "folia",
            "host.files",
            "host.restart",
            "world.rollback",
            "password-login-without-game-proof",
            "coreprotect-adapter",
            "worldguard-adapter",
            "essentials-adapter",
            "spark-profiler",
            "external-map-rendering"));
  }
}
