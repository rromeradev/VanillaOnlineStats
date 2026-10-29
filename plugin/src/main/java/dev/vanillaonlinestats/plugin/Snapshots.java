// SPDX-License-Identifier: AGPL-3.0-only
package dev.vanillaonlinestats.plugin;

import static dev.vanillaonlinestats.plugin.Telemetry.object;

import com.google.gson.*;
import java.lang.management.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.entity.*;
import org.bukkit.inventory.*;
import org.bukkit.inventory.meta.Damageable;
import org.bukkit.plugin.java.JavaPlugin;

/** All methods are called on Paper's main thread. Deep queries never load a chunk. */
final class Snapshots {
  private final JavaPlugin plugin;
  private final Settings settings;
  private final AuthMeBridge auth;
  HostMetrics host;

  Snapshots(JavaPlugin plugin, Settings settings, AuthMeBridge auth) {
    this.plugin = plugin;
    this.settings = settings;
    this.auth = auth;
  }

  JsonObject server() {
    JsonArray plugins = new JsonArray();
    for (var item : plugin.getServer().getPluginManager().getPlugins())
      plugins.add(
          object(
              "name",
              item.getName(),
              "version",
              item.getPluginMeta().getVersion(),
              "enabled",
              item.isEnabled()));
    return object(
        "minecraftVersion",
        plugin.getServer().getMinecraftVersion(),
        "paperVersion",
        plugin.getServer().getVersion(),
        "implementation",
        plugin.getServer().getName(),
        "motd",
        plugin.getServer().getMotd(),
        "javaVersion",
        System.getProperty("java.version"),
        "playersOnline",
        plugin.getServer().getOnlinePlayers().size(),
        "maxPlayers",
        plugin.getServer().getMaxPlayers(),
        "onlineMode",
        plugin.getServer().getOnlineMode(),
        "whitelist",
        plugin.getServer().hasWhitelist(),
        "worlds",
        plugin.getServer().getWorlds().size(),
        "plugins",
        plugins);
  }

  JsonObject performance() {
    MemoryUsage heap = ManagementFactory.getMemoryMXBean().getHeapMemoryUsage(),
        nonHeap = ManagementFactory.getMemoryMXBean().getNonHeapMemoryUsage();
    JsonArray gc = new JsonArray();
    for (var bean : ManagementFactory.getGarbageCollectorMXBeans())
      gc.add(
          object(
              "name",
              bean.getName(),
              "count",
              bean.getCollectionCount(),
              "millis",
              bean.getCollectionTime()));
    long[] ticks = plugin.getServer().getTickTimes();
    double[] times = Arrays.stream(ticks).mapToDouble(t -> t / 1_000_000.0).sorted().toArray();
    var os = ManagementFactory.getOperatingSystemMXBean();
    double processCpu = -1, systemCpu = -1;
    long physical = -1;
    if (os instanceof com.sun.management.OperatingSystemMXBean extended) {
      processCpu = extended.getProcessCpuLoad();
      systemCpu = extended.getCpuLoad();
      physical = extended.getTotalMemorySize();
    }
    return object(
        "tps",
        plugin.getServer().getTPS(),
        "playersOnline",
        plugin.getServer().getOnlinePlayers().size(),
        "msptAverage",
        plugin.getServer().getAverageTickTime(),
        "msptP50",
        percentile(times, .5),
        "msptP95",
        percentile(times, .95),
        "msptP99",
        percentile(times, .99),
        "sampledTicks",
        times.length,
        "slowTicks",
        Arrays.stream(times).filter(t -> t > 50).count(),
        "heapUsed",
        heap.getUsed(),
        "heapCommitted",
        heap.getCommitted(),
        "heapMax",
        heap.getMax(),
        "nonHeapUsed",
        nonHeap.getUsed(),
        "uptimeSeconds",
        ManagementFactory.getRuntimeMXBean().getUptime() / 1000,
        "threads",
        ManagementFactory.getThreadMXBean().getThreadCount(),
        "processors",
        os.getAvailableProcessors(),
        "processCpuLoad",
        processCpu,
        "systemCpuLoad",
        systemCpu,
        "visiblePhysicalMemory",
        physical,
        "gc",
        gc,
        "scope",
        "JVM/container; host metrics may be restricted");
  }

  private double percentile(double[] data, double p) {
    return data.length == 0
        ? -1
        : data[Math.min(data.length - 1, (int) Math.ceil(data.length * p) - 1)];
  }

  JsonObject world(World world) {
    JsonObject result =
        object(
            "worldId",
            world.getUID().toString(),
            "name",
            world.getName(),
            "environment",
            world.getEnvironment().name(),
            "difficulty",
            world.getDifficulty().name(),
            "time",
            world.getTime(),
            "fullTime",
            world.getFullTime(),
            "storm",
            world.hasStorm(),
            "thunder",
            world.isThundering(),
            "players",
            world.getPlayers().size(),
            "loadedChunks",
            world.getChunkCount(),
            "entities",
            world.getEntityCount(),
            "autoSave",
            world.isAutoSave(),
            "minHeight",
            world.getMinHeight(),
            "maxHeight",
            world.getMaxHeight(),
            "borderSize",
            world.getWorldBorder().getSize());
    JsonObject rules = new JsonObject();
    JsonArray unavailable = new JsonArray();
    for (var rule : Registry.GAME_RULE) {
      try {
        var value = world.getGameRuleValue(rule);
        if (value != null) rules.addProperty(rule.getKey().toString(), value.toString());
      } catch (IllegalArgumentException unsupported) {
        unavailable.add(rule.getKey().toString());
      }
    }
    result.add("gamerules", rules);
    result.add("unavailableGamerules", unavailable);
    if (settings.seeds()) result.addProperty("seed", world.getSeed());
    if (settings.positions()) {
      result.add("spawn", location(world.getSpawnLocation()));
      result.add("borderCenter", location(world.getWorldBorder().getCenter()));
    }
    return result;
  }

  JsonObject player(Player player, boolean details) {
    if (!settings.players()) throw new ControlFailure("PLAYER_COLLECTION_DISABLED");
    if (!auth.authenticated(player)) throw new ControlFailure("PLAYER_NOT_AUTHENTICATED");
    JsonObject result =
        object(
            "uuid",
            player.getUniqueId().toString(),
            "name",
            player.getName(),
            "uuidSource",
            "paper-server",
            "worldId",
            player.getWorld().getUID().toString(),
            "ping",
            player.getPing(),
            "locale",
            player.getLocale(),
            "gamemode",
            player.getGameMode().name(),
            "health",
            player.getHealth(),
            "food",
            player.getFoodLevel(),
            "saturation",
            player.getSaturation(),
            "level",
            player.getLevel(),
            "exp",
            player.getExp(),
            "totalExperience",
            player.getTotalExperience(),
            "air",
            player.getRemainingAir(),
            "flying",
            player.isFlying(),
            "sprinting",
            player.isSprinting(),
            "sneaking",
            player.isSneaking(),
            "swimming",
            player.isSwimming(),
            "firstPlayed",
            player.getFirstPlayed(),
            "lastPlayed",
            player.getLastPlayed());
    result.add("skin", SkinSnapshot.profile(player.getPlayerProfile().getTextures()));
    JsonArray effects = new JsonArray();
    player
        .getActivePotionEffects()
        .forEach(
            effect ->
                effects.add(
                    object(
                        "type",
                        effect.getType().getKey().toString(),
                        "amplifier",
                        effect.getAmplifier(),
                        "durationTicks",
                        effect.getDuration())));
    result.add("effects", effects);
    if (settings.positions()) result.add("location", location(player.getLocation()));
    if (settings.addresses() && player.getAddress() != null)
      result.addProperty("address", player.getAddress().getAddress().getHostAddress());
    if (details) {
      result.add("tags", new Gson().toJsonTree(player.getScoreboardTags()));
      JsonArray permissions = new JsonArray();
      player.getEffectivePermissions().stream()
          .limit(256)
          .forEach(
              p -> permissions.add(object("permission", p.getPermission(), "value", p.getValue())));
      result.add("permissions", permissions);
    }
    return result;
  }

  JsonObject inventories(Player player) {
    if (!settings.inventories()) throw new ControlFailure("INVENTORY_COLLECTION_DISABLED");
    player(player, false);
    return object(
        "uuid",
        player.getUniqueId().toString(),
        "inventory",
        inventory(player.getInventory()),
        "enderChest",
        inventory(player.getEnderChest()),
        "selectedSlot",
        player.getInventory().getHeldItemSlot());
  }

  private JsonArray inventory(Inventory inventory) {
    JsonArray result = new JsonArray();
    for (int i = 0; i < Math.min(54, inventory.getSize()); i++) {
      ItemStack stack = inventory.getItem(i);
      if (stack != null && !stack.getType().isAir())
        result.add(object("slot", i, "item", item(stack)));
    }
    return result;
  }

  static JsonObject item(ItemStack stack) {
    JsonObject result =
        object("type", stack.getType().getKey().toString(), "amount", stack.getAmount());
    if (stack.hasItemMeta() && stack.getItemMeta() instanceof Damageable damaged)
      result.addProperty("damage", damaged.getDamage());
    JsonObject enchantments = new JsonObject();
    stack
        .getEnchantments()
        .forEach((key, value) -> enchantments.addProperty(key.getKey().toString(), value));
    result.add("enchantments", enchantments);
    return result;
  }

  JsonObject statistics(Player player, JsonObject args) {
    player(player, false);
    if (!args.has("statistic")) {
      JsonArray items = new JsonArray();
      int offset = args.has("offset") ? integer(args, "offset", 0, 10000) : 0, index = 0;
      for (Statistic stat : Statistic.values()) {
        if (stat.getType() != Statistic.Type.UNTYPED) continue;
        if (index++ < offset) continue;
        if (items.size() >= settings.maxStats())
          return object("items", items, "nextOffset", index - 1);
        items.add(object("statistic", stat.name(), "value", player.getStatistic(stat)));
      }
      return object("items", items, "nextOffset", -1);
    }
    String type = args.has("statistic") ? args.get("statistic").getAsString() : "PLAY_ONE_MINUTE";
    Statistic statistic = Statistic.valueOf(type);
    int value;
    switch (statistic.getType()) {
      case UNTYPED -> value = player.getStatistic(statistic);
      case BLOCK, ITEM ->
          value =
              player.getStatistic(statistic, Material.valueOf(args.get("material").getAsString()));
      case ENTITY ->
          value =
              player.getStatistic(
                  statistic, EntityType.valueOf(args.get("entityType").getAsString()));
      default -> throw new IllegalArgumentException("Unsupported statistic");
    }
    return object("uuid", player.getUniqueId().toString(), "statistic", type, "value", value);
  }

  JsonObject advancements(Player player, int offset) {
    player(player, false);
    JsonArray items = new JsonArray();
    var iterator = plugin.getServer().advancementIterator();
    int index = 0;
    while (iterator.hasNext() && index < offset) {
      iterator.next();
      index++;
    }
    int count = 0;
    while (iterator.hasNext() && count++ < settings.maxStats()) {
      var advancement = iterator.next();
      var progress = player.getAdvancementProgress(advancement);
      JsonObject dates = new JsonObject();
      for (String criterion : progress.getAwardedCriteria()) {
        var date = progress.getDateAwarded(criterion);
        if (date != null) dates.addProperty(criterion, date.toInstant().toString());
      }
      items.add(
          object(
              "key",
              advancement.getKey().toString(),
              "icon",
              advancement.getDisplay() == null
                  ? null
                  : advancement.getDisplay().icon().getType().getKey().toString(),
              "complete",
              progress.isDone(),
              "awardedCriteria",
              dates,
              "remaining",
              progress.getRemainingCriteria()));
      index++;
    }
    return object("items", items, "nextOffset", iterator.hasNext() ? index : -1);
  }

  JsonObject chunk(World world, int x, int z) {
    if (!world.isChunkLoaded(x, z)) throw new IllegalArgumentException("Chunk is not loaded");
    Chunk chunk = world.getChunkAt(x, z);
    JsonArray entities = new JsonArray();
    int count = 0;
    for (Entity entity : chunk.getEntities()) {
      if (count++ >= settings.maxEntities()) break;
      if (entity instanceof Player p && (!settings.players() || !auth.authenticated(p))) continue;
      entities.add(entity(entity));
    }
    JsonArray blocks = new JsonArray();
    int tiles = 0;
    for (var tile : chunk.getTileEntities()) {
      if (tiles++ >= settings.maxEntities()) break;
      JsonObject entry = object("type", tile.getType().getKey().toString());
      if (settings.positions()) entry.add("location", location(tile.getLocation()));
      blocks.add(entry);
    }
    JsonObject result =
        object(
            "worldId",
            world.getUID().toString(),
            "inhabitedTicks",
            chunk.getInhabitedTime(),
            "entities",
            entities,
            "entitiesTruncated",
            count > settings.maxEntities(),
            "blockEntities",
            blocks,
            "blockEntitiesTruncated",
            tiles > settings.maxEntities(),
            "forceLoaded",
            chunk.isForceLoaded());
    if (settings.positions()) {
      result.addProperty("x", x);
      result.addProperty("z", z);
    }
    return result;
  }

  JsonObject entity(Entity entity) {
    if (entity instanceof Player player) return player(player, false);
    JsonObject result =
        object(
            "uuid",
            entity.getUniqueId().toString(),
            "type",
            entity.getType().getKey().toString(),
            "ticksLived",
            entity.getTicksLived(),
            "valid",
            entity.isValid());
    if (settings.positions()) result.add("location", location(entity.getLocation()));
    if (entity instanceof LivingEntity living) {
      result.addProperty("health", living.getHealth());
      if (settings.inventories() && living.getEquipment() != null) {
        JsonArray gear = new JsonArray();
        for (var stack : living.getEquipment().getArmorContents())
          if (stack != null) gear.add(item(stack));
        result.add("armor", gear);
      }
    }
    if (entity instanceof Mob mob
        && mob.getTarget() != null
        && !(mob.getTarget() instanceof Player))
      result.addProperty("target", mob.getTarget().getUniqueId().toString());
    if (entity instanceof Villager villager) {
      result.addProperty("profession", villager.getProfession().getKey().toString());
      result.addProperty("level", villager.getVillagerLevel());
      result.addProperty("trades", villager.getRecipeCount());
    }
    if (entity instanceof Item dropped) result.add("item", item(dropped.getItemStack()));
    return result;
  }

  static JsonObject location(Location location) {
    return object(
        "worldId",
        location.getWorld().getUID().toString(),
        "x",
        location.getX(),
        "y",
        location.getY(),
        "z",
        location.getZ(),
        "yaw",
        location.getYaw(),
        "pitch",
        location.getPitch());
  }

  JsonObject query(String operation, JsonObject args) {
    return switch (operation) {
      case "integrations.status" -> new Integrations(plugin).status();
      case "integration.luckperms", "integration.vault", "integration.placeholder" -> {
        Player target = playerArg(args);
        player(target, false);
        try {
          yield new Integrations(plugin).query(operation, target, args);
        } catch (ReflectiveOperationException failure) {
          throw new IllegalArgumentException("Integration API incompatible");
        }
      }
      case "server.snapshot" -> server();
      case "host.filesystem" -> host == null ? object("status", "unavailable") : host.snapshot();
      case "worlds.list" -> {
        JsonArray items = new JsonArray();
        for (World world : plugin.getServer().getWorlds())
          items.add(object("worldId", world.getUID().toString(), "name", world.getName()));
        yield object("items", items);
      }
      case "statistics.catalog" -> {
        JsonArray items = new JsonArray();
        for (Statistic stat : Statistic.values())
          items.add(object("name", stat.name(), "type", stat.getType().name()));
        yield object("items", items);
      }
      case "server.bans", "server.operators", "server.whitelist" -> {
        java.util.Collection<? extends OfflinePlayer> players =
            switch (operation) {
              case "server.bans" -> plugin.getServer().getBannedPlayers();
              case "server.operators" -> plugin.getServer().getOperators();
              default -> plugin.getServer().getWhitelistedPlayers();
            };
        int offset = args.has("offset") ? integer(args, "offset", 0, 10000) : 0, index = 0;
        JsonArray items = new JsonArray();
        for (OfflinePlayer player : players) {
          if (index++ < offset) continue;
          if (items.size() >= settings.maxStats()) break;
          items.add(object("uuid", player.getUniqueId().toString(), "name", player.getName()));
        }
        yield object(
            "items",
            items,
            "total",
            players.size(),
            "nextOffset",
            offset + items.size() < players.size() ? offset + items.size() : -1);
      }
      case "server.performance" -> performance();
      case "world.snapshot" -> world(worldArg(args));
      case "chunk.snapshot" ->
          chunk(
              worldArg(args),
              integer(args, "x", -1_875_000, 1_875_000),
              integer(args, "z", -1_875_000, 1_875_000));
      case "player.snapshot" -> player(playerArg(args), true);
      case "player.inventory" -> inventories(playerArg(args));
      case "player.statistics" -> statistics(playerArg(args), args);
      case "player.advancements" ->
          advancements(playerArg(args), args.has("offset") ? integer(args, "offset", 0, 10000) : 0);
      case "entity.snapshot" -> {
        Entity entity =
            plugin.getServer().getEntity(UUID.fromString(args.get("entityId").getAsString()));
        if (entity == null) throw new IllegalArgumentException("Entity unavailable");
        yield entity(entity);
      }
      case "block.snapshot" -> {
        World world = worldArg(args);
        int x = integer(args, "x", -30_000_000, 30_000_000),
            z = integer(args, "z", -30_000_000, 30_000_000),
            y = integer(args, "y", world.getMinHeight(), world.getMaxHeight() - 1);
        if (!world.isChunkLoaded(x >> 4, z >> 4))
          throw new IllegalArgumentException("Chunk not loaded");
        var block = world.getBlockAt(x, y, z);
        yield object(
            "type",
            block.getType().getKey().toString(),
            "biome",
            block.getBiome().getKey().toString(),
            "light",
            block.getLightLevel(),
            "power",
            block.getBlockPower());
      }
      default -> throw new IllegalArgumentException("Unknown query");
    };
  }

  World worldArg(JsonObject args) {
    World world = plugin.getServer().getWorld(UUID.fromString(args.get("worldId").getAsString()));
    if (world == null) throw new IllegalArgumentException("World unavailable");
    return world;
  }

  Player playerArg(JsonObject args) {
    Player player =
        plugin.getServer().getPlayer(UUID.fromString(args.get("playerId").getAsString()));
    if (player == null) throw new ControlFailure("PLAYER_OFFLINE");
    return player;
  }

  static int integer(JsonObject args, String key, int min, int max) {
    double v = args.get(key).getAsDouble();
    if (!Double.isFinite(v) || v < min || v > max || v != Math.rint(v))
      throw new IllegalArgumentException("Invalid number");
    return (int) v;
  }
}
