// SPDX-License-Identifier: AGPL-3.0-only
package dev.vanillaonlinestats.plugin;

import java.net.URI;
import java.util.Set;
import org.bukkit.configuration.file.FileConfiguration;

record Settings(
    int queueMessages,
    int queueBytes,
    int batchMessages,
    int timeoutSeconds,
    int periodTicks,
    int maxPlayers,
    int maxWorlds,
    int maxChunks,
    int maxEntities,
    int maxStats,
    long budgetNanos,
    boolean players,
    boolean inventories,
    boolean positions,
    boolean addresses,
    boolean seeds,
    boolean blocks,
    boolean entities,
    boolean chat,
    boolean actions,
    boolean console,
    Set<String> allowedActions,
    Set<String> safeCommands,
    URI telemetryEndpoint,
    URI controlEndpoint,
    String tenantId,
    String publicKey) {
  static Settings read(FileConfiguration config) {
    int version = config.getInt("schema-version", 1);
    if (version != 1 && version != 2) throw new IllegalArgumentException("schema-version");
    String base = config.getString("telemetry.endpoint", "");
    URI telemetry =
        base.isBlank()
            ? null
            : endpoint(base, false, config.getBoolean("heartbeat.allow-loopback-http"));
    String control = config.getString("control.endpoint", "");
    URI channel =
        control.isBlank()
            ? null
            : endpoint(control, true, config.getBoolean("heartbeat.allow-loopback-http"));
    return new Settings(
        number(config, "limits.queue-messages", 1024, 16, 8192),
        number(config, "limits.queue-bytes", 2_097_152, 65536, 16_777_216),
        number(config, "limits.batch-messages", 32, 1, 128),
        number(config, "heartbeat.timeout-seconds", 3, 1, 10),
        number(config, "collectors.period-seconds", 10, 5, 300) * 20,
        number(config, "limits.players-per-cycle", 32, 1, 256),
        number(config, "limits.worlds-per-cycle", 8, 1, 64),
        number(config, "limits.chunks-per-cycle", 8, 1, 128),
        number(config, "limits.entities-per-chunk", 64, 1, 256),
        number(config, "limits.statistics-per-query", 64, 1, 256),
        number(config, "limits.collector-budget-micros", 2000, 100, 20000) * 1000L,
        config.getBoolean("privacy.player-state", false),
        config.getBoolean("privacy.inventories", false),
        config.getBoolean("privacy.positions", false),
        config.getBoolean("privacy.addresses", false),
        config.getBoolean("privacy.world-seeds", false),
        config.getBoolean("events.blocks", false),
        config.getBoolean("events.entities", false),
        config.getBoolean("privacy.chat", false),
        config.getBoolean("control.writes-enabled", false),
        config.getBoolean("control.console-enabled", false),
        Set.copyOf(config.getStringList("control.allowed-operations")),
        Set.copyOf(config.getStringList("privacy.safe-command-roots")),
        telemetry,
        channel,
        config.getString("control.tenant-id", ""),
        config.getString("control.public-key", ""));
  }

  private static int number(FileConfiguration c, String key, int fallback, int min, int max) {
    int value = c.getInt(key, fallback);
    if (value < min || value > max) throw new IllegalArgumentException(key);
    return value;
  }

  static URI endpoint(String value, boolean websocket, boolean loopback) {
    URI uri = URI.create(value);
    String secure = websocket ? "wss" : "https", local = websocket ? "ws" : "http";
    boolean isLocal =
        loopback
            && local.equals(uri.getScheme())
            && Set.of("127.0.0.1", "[::1]").contains(uri.getHost());
    if (!(secure.equals(uri.getScheme()) || isLocal)
        || uri.getHost() == null
        || uri.getUserInfo() != null
        || uri.getFragment() != null
        || uri.getQuery() != null
        || uri.getPort() == 0
        || uri.getPort() > 65535
        || !(websocket ? "/api/v1/agents/control" : "/api/v1/agents/telemetry/batches")
            .equals(uri.getPath())) throw new IllegalArgumentException("endpoint");
    return uri;
  }
}
