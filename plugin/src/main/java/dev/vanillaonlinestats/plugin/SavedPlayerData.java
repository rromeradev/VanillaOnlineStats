// SPDX-License-Identifier: AGPL-3.0-only
package dev.vanillaonlinestats.plugin;

import com.google.gson.JsonObject;
import java.util.*;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.java.JavaPlugin;

/** Captures player pages independently of dashboard subscriptions, on the server thread. */
final class SavedPlayerData implements Listener {
  private final Snapshots snapshots;
  private final Telemetry bus;
  private final AuthMeBridge auth;
  private final Settings settings;
  private final Map<UUID, Integer> stages = new HashMap<>();

  private record Saved(JsonObject payload, long at) {}

  private final Map<UUID, Map<String, Saved>> previous = new HashMap<>();
  private int cursor;

  SavedPlayerData(
      JavaPlugin plugin, Snapshots snapshots, Telemetry bus, AuthMeBridge auth, Settings settings) {
    this.snapshots = snapshots;
    this.bus = bus;
    this.auth = auth;
    this.settings = settings;
    plugin.getServer().getPluginManager().registerEvents(this, plugin);
    plugin
        .getServer()
        .getScheduler()
        .runTaskTimer(
            plugin,
            () -> {
              if (!settings.players()) return;
              var players = plugin.getServer().getOnlinePlayers().toArray(Player[]::new);
              stages.keySet().removeIf(id -> plugin.getServer().getPlayer(id) == null);
              previous.keySet().removeIf(id -> plugin.getServer().getPlayer(id) == null);
              if (players.length == 0) return;
              long until = System.nanoTime() + settings.budgetNanos();
              for (int i = 0; i < Math.min(settings.maxPlayers(), players.length); i++) {
                var player = players[Math.floorMod(cursor++, players.length)];
                if (!auth.authenticated(player)) {
                  stages.remove(player.getUniqueId());
                  previous.remove(player.getUniqueId());
                  continue;
                }
                int stage = stages.getOrDefault(player.getUniqueId(), -2);
                if (stage == -2) {
                  if (settings.inventories())
                    save(
                        player,
                        "player.inventory",
                        new JsonObject(),
                        snapshots.inventories(player));
                  stage = -1;
                } else if (stage == -1) {
                  // Untyped statistics fit in bounded pages; collect every page each cycle.
                  int offset = 0;
                  do {
                    var args = Telemetry.object("offset", offset);
                    var data = snapshots.statistics(player, args);
                    save(player, "player.statistics", args, data);
                    offset = data.get("nextOffset").getAsInt();
                  } while (offset >= 0 && offset < 10000);
                  stage = 0;
                } else {
                  var args = Telemetry.object("offset", stage);
                  var data = snapshots.advancements(player, stage);
                  save(player, "player.advancements", args, data);
                  stage = data.get("nextOffset").getAsInt();
                  if (stage < 0 || stage >= 10000) stage = -2;
                }
                stages.put(player.getUniqueId(), stage);
                if (System.nanoTime() >= until) break;
              }
            },
            1,
            5);
  }

  private void save(Player player, String operation, JsonObject args, JsonObject data) {
    var cache = previous.computeIfAbsent(player.getUniqueId(), ignored -> new HashMap<>());
    String key = operation + args;
    var prior = cache.get(key);
    // Recovery checkpoint also repairs a queue expiry/drop during an interrupted connection.
    if (prior != null
        && data.equals(prior.payload())
        && System.nanoTime() - prior.at() < 60_000_000_000L) return;
    // Pages must not coalesce with another player's page while awaiting acknowledgement.
    if (bus.emit(
        "player.saved.snapshot",
        Telemetry.object(
            "uuid",
            player.getUniqueId().toString(),
            "operation",
            operation,
            "arguments",
            args,
            "data",
            data),
        true)) cache.put(key, new Saved(data.deepCopy(), System.nanoTime()));
  }

  @EventHandler(priority = EventPriority.LOWEST)
  public void quit(PlayerQuitEvent event) {
    var player = event.getPlayer();
    if (!settings.players()) return;
    // AuthMe can clear its live flag earlier in the quit event. Snapshots still enforce auth,
    // so retain the last authenticated capture if that happened instead of reading new data.
    if (!auth.authenticated(player)) return;
    previous.remove(player.getUniqueId());
    bus.emit(
        "players.live.snapshot",
        Telemetry.object("items", List.of(snapshots.player(player, false))),
        true);
    if (settings.inventories())
      save(player, "player.inventory", new JsonObject(), snapshots.inventories(player));
    // Capture the final values of every page before Bukkit releases the player.
    for (String operation : List.of("player.statistics", "player.advancements")) {
      int offset = 0;
      do {
        var args = Telemetry.object("offset", offset);
        var data =
            operation.endsWith("statistics")
                ? snapshots.statistics(player, args)
                : snapshots.advancements(player, offset);
        save(player, operation, args, data);
        offset = data.get("nextOffset").getAsInt();
      } while (offset >= 0 && offset < 10000);
    }
    stages.remove(player.getUniqueId());
    previous.remove(player.getUniqueId());
  }
}
