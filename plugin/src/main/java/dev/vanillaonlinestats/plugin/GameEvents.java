// SPDX-License-Identifier: AGPL-3.0-only
package dev.vanillaonlinestats.plugin;

import static dev.vanillaonlinestats.plugin.Telemetry.object;

import com.google.gson.*;
import java.util.*;
import java.util.function.Consumer;
import org.bukkit.*;
import org.bukkit.block.Block;
import org.bukkit.entity.*;
import org.bukkit.event.*;
import org.bukkit.event.player.*;
import org.bukkit.plugin.java.JavaPlugin;

/** Metadata only for commands. Never observes authentication command arguments. */
final class GameEvents implements Listener {
  private final JavaPlugin plugin;
  private final Settings settings;
  private final Telemetry bus;
  private final AuthMeBridge auth;
  private final Map<UUID, Long> sessions = new HashMap<>();
  private final Map<String, Long> counts = new LinkedHashMap<>();
  private final Consumer<UUID> revoke;
  private long window = System.nanoTime();
  private int events;
  private final java.util.concurrent.atomic.AtomicInteger pendingChat =
      new java.util.concurrent.atomic.AtomicInteger();

  GameEvents(
      JavaPlugin plugin,
      Settings settings,
      Telemetry bus,
      AuthMeBridge auth,
      Consumer<UUID> revoke) {
    this.plugin = plugin;
    this.settings = settings;
    this.bus = bus;
    this.auth = auth;
    this.revoke = revoke;
    plugin.getServer().getPluginManager().registerEvents(this, plugin);
    String[] playerEvents = {
      "PlayerJoinEvent",
      "PlayerQuitEvent",
      "PlayerKickEvent",
      "PlayerChangedWorldEvent",
      "PlayerTeleportEvent",
      "PlayerAdvancementDoneEvent",
      "PlayerExpChangeEvent",
      "PlayerLevelChangeEvent",
      "PlayerItemConsumeEvent",
      "PlayerStatisticIncrementEvent",
      "PlayerGameModeChangeEvent",
      "PlayerDropItemEvent",
      "PlayerAttemptPickupItemEvent"
    };
    for (String name : playerEvents) watch("org.bukkit.event.player." + name, "player." + name);
    for (String name :
        new String[] {
          "PlayerDeathEvent",
          "EntityDeathEvent",
          "EntityDamageEvent",
          "EntityDamageByEntityEvent",
          "EntityBreedEvent",
          "EntityTameEvent",
          "EntityTransformEvent",
          "ProjectileLaunchEvent",
          "ProjectileHitEvent"
        }) watch("org.bukkit.event.entity." + name, "entity." + name);
    for (String name :
        new String[] {
          "WorldLoadEvent",
          "WorldUnloadEvent",
          "WorldSaveEvent",
          "ChunkLoadEvent",
          "ChunkUnloadEvent"
        }) watch("org.bukkit.event.world." + name, "world." + name);
    for (String name : new String[] {"WeatherChangeEvent", "ThunderChangeEvent"})
      watch("org.bukkit.event.weather." + name, "weather." + name);
    for (String name : new String[] {"CraftItemEvent", "FurnaceSmeltEvent", "EnchantItemEvent"})
      watch(
          "org.bukkit.event."
              + (name.equals("EnchantItemEvent") ? "enchantment." : "inventory.")
              + name,
          "progress." + name);
    for (String name : new String[] {"VehicleEnterEvent", "VehicleExitEvent"})
      watch("org.bukkit.event.vehicle." + name, "vehicle." + name);
    if (settings.blocks())
      for (String name :
          new String[] {
            "BlockBreakEvent",
            "BlockPlaceEvent",
            "BlockBurnEvent",
            "BlockIgniteEvent",
            "BlockExplodeEvent",
            "BlockFromToEvent",
            "BlockRedstoneEvent",
            "BlockPhysicsEvent"
          }) watch("org.bukkit.event.block." + name, "block." + name);
    if (settings.entities())
      for (String name :
          new String[] {
            "CreatureSpawnEvent", "ItemSpawnEvent", "ItemDespawnEvent", "EntityExplodeEvent"
          }) watch("org.bukkit.event.entity." + name, "entity." + name);
    plugin
        .getServer()
        .getScheduler()
        .runTaskTimer(
            plugin,
            () -> {
              bus.emit(
                  "events.counters",
                  object(
                      "cumulativeSinceStart",
                      new LinkedHashMap<>(counts),
                      "openSessions",
                      sessions.size()),
                  false);
            },
            200,
            200);
    for (Player player : plugin.getServer().getOnlinePlayers())
      if (auth.authenticated(player)) sessions.put(player.getUniqueId(), System.nanoTime());
  }

  void authEvent(Player player, String event) {
    if (event.equals("RegisterEvent")) revoke.accept(player.getUniqueId());
    if (event.equals("LoginEvent") || event.equals("RestoreSessionEvent")) {
      if (auth.authenticated(player)) {
        sessions.putIfAbsent(player.getUniqueId(), System.nanoTime());
        emit("auth.session.started", identity(player));
      }
    } else if (event.equals("LogoutEvent") || event.startsWith("Unregister"))
      endSession(player, event);
    else emit("auth." + event, identity(player));
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void quit(PlayerQuitEvent event) {
    endSession(event.getPlayer(), "disconnect");
  }

  private void endSession(Player player, String reason) {
    Long started = sessions.remove(player.getUniqueId());
    revoke.accept(player.getUniqueId());
    if (started != null) {
      JsonObject payload = identity(player);
      payload.addProperty(
          "durationSeconds", Math.max(0, (System.nanoTime() - started) / 1_000_000_000));
      payload.addProperty("reason", reason);
      emit("auth.session.ended", payload);
    }
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  public void command(PlayerCommandPreprocessEvent event) {
    String raw = event.getMessage();
    int separator = raw.indexOf(' ');
    String root =
        raw.substring(raw.startsWith("/") ? 1 : 0, separator < 0 ? raw.length() : separator)
            .toLowerCase(Locale.ROOT);
    // Namespaced commands and all authentication roots are always denied.
    if (root.contains(":")
        || Set.of(
                "login",
                "l",
                "register",
                "reg",
                "changepassword",
                "changepass",
                "cp",
                "unregister",
                "email",
                "authme",
                "2fa",
                "totp",
                "vos")
            .contains(root)) return;
    if (settings.safeCommands().contains(root) && auth.authenticated(event.getPlayer())) {
      JsonObject payload = identity(event.getPlayer());
      payload.addProperty("root", root);
      emit("player.command.metadata", payload);
    }
  }

  private JsonObject identity(Player player) {
    if (!settings.players()) return object("identityCollected", false);
    return object(
        "uuid",
        player.getUniqueId().toString(),
        "name",
        player.getName(),
        "uuidSource",
        "paper-server");
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  public void chat(io.papermc.paper.event.player.AsyncChatEvent event) {
    if (!settings.chat() || !settings.players()) return;
    if (pendingChat.incrementAndGet() > 32) {
      pendingChat.decrementAndGet();
      return;
    }
    String content =
        net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer.plainText()
            .serialize(event.message());
    if (content.length() > 512) content = content.substring(0, 512);
    String text = content;
    plugin
        .getServer()
        .getScheduler()
        .runTask(
            plugin,
            () -> {
              try {
                if (auth.authenticated(event.getPlayer()) && !text.startsWith("/")) {
                  JsonObject payload = identity(event.getPlayer());
                  payload.addProperty("text", text);
                  emit("player.chat", payload);
                }
              } finally {
                pendingChat.decrementAndGet();
              }
            });
  }

  @SuppressWarnings("unchecked")
  private void watch(String className, String type) {
    try {
      Class<? extends Event> eventType = (Class<? extends Event>) Class.forName(className);
      if (eventType.getMethod("getHandlerList") == null) return;
      plugin
          .getServer()
          .getPluginManager()
          .registerEvent(
              eventType,
              this,
              EventPriority.MONITOR,
              (listener, event) -> {
                if (event.isAsynchronous()) return;
                JsonObject data = new JsonObject();
                Object player = read(event, "getPlayer");
                if (player instanceof Player p) {
                  if (!auth.authenticated(p)) {
                    if (!type.endsWith("PlayerJoinEvent") && !type.endsWith("PlayerQuitEvent"))
                      return;
                    data = object("identityCollected", false);
                  } else data = identity(p);
                }
                Object entity = read(event, "getEntity");
                if (entity instanceof Player p) {
                  if (!auth.authenticated(p)) return;
                  data = identity(p);
                } else if (entity instanceof Entity e) {
                  data.addProperty("entityType", e.getType().getKey().toString());
                  if (settings.positions())
                    data.add("location", Snapshots.location(e.getLocation()));
                }
                Object block = read(event, "getBlock");
                if (block instanceof Block b) {
                  data.addProperty("blockType", b.getType().getKey().toString());
                  if (settings.positions())
                    data.add("location", Snapshots.location(b.getLocation()));
                }
                Object world = read(event, "getWorld");
                if (world instanceof World w) data.addProperty("worldId", w.getUID().toString());
                Object chunk = read(event, "getChunk");
                if (chunk instanceof Chunk c) {
                  data.addProperty("worldId", c.getWorld().getUID().toString());
                  if (settings.positions()) {
                    data.addProperty("chunkX", c.getX());
                    data.addProperty("chunkZ", c.getZ());
                  }
                }
                for (String field :
                    new String[] {
                      "getCause",
                      "getReason",
                      "getAmount",
                      "getDamage",
                      "getFinalDamage",
                      "getExpToDrop",
                      "getNewLevel",
                      "getOldLevel",
                      "getPreviousValue",
                      "getNewValue",
                      "getStatistic"
                    }) {
                  Object value = read(event, field);
                  if (value instanceof Enum<?> e) data.addProperty(field.substring(3), e.name());
                  else if (value instanceof Number n) data.addProperty(field.substring(3), n);
                }
                Object advancement = read(event, "getAdvancement");
                if (advancement instanceof org.bukkit.advancement.Advancement a)
                  data.addProperty("advancement", a.getKey().toString());
                emit(type, data);
              },
              plugin,
              true);
    } catch (ReflectiveOperationException unavailable) {
      counts.put("unsupported." + className.substring(className.lastIndexOf('.') + 1), 1L);
    }
  }

  private Object read(Object event, String method) {
    try {
      return event.getClass().getMethod(method).invoke(event);
    } catch (ReflectiveOperationException ignored) {
      return null;
    }
  }

  private void emit(String type, JsonObject payload) {
    counts.merge(type, 1L, Long::sum);
    long now = System.nanoTime();
    if (now - window >= 1_000_000_000L) {
      window = now;
      events = 0;
    }
    if (events++ < 100) bus.emit(type, payload, true);
    else counts.merge("rateDropped", 1L, Long::sum);
  }
}
