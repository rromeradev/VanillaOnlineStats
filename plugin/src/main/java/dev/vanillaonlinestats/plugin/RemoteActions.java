// SPDX-License-Identifier: AGPL-3.0-only
package dev.vanillaonlinestats.plugin;

import static dev.vanillaonlinestats.plugin.Telemetry.object;

import com.google.gson.*;
import java.time.Instant;
import java.util.*;
import org.bukkit.*;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

final class RemoteActions {
  private final JavaPlugin plugin;
  private final Settings settings;
  private final Snapshots snapshots;
  private final LinkCodes links;
  private final AuthMeBridge auth;

  RemoteActions(
      JavaPlugin plugin,
      Settings settings,
      Snapshots snapshots,
      LinkCodes links,
      AuthMeBridge auth) {
    this.plugin = plugin;
    this.settings = settings;
    this.snapshots = snapshots;
    this.links = links;
    this.auth = auth;
  }

  JsonObject passwordLogin(ControlSecurity.Request request) throws Exception {
    if (!request.kind().equals("link")
        || !request.operation().equals("player.authme.login")
        || !request.expiresAt().isAfter(Instant.now()))
      throw new IllegalArgumentException("Invalid login");
    JsonObject proof =
        auth.passwordLogin(
            text(request.arguments(), "nickname", 16), text(request.arguments(), "password", 128));
    String name = proof.get("name").getAsString();
    OfflinePlayer cached =
        plugin
            .getServer()
            .getScheduler()
            .callSyncMethod(plugin, () -> plugin.getServer().getOfflinePlayerIfCached(name))
            .get(3, java.util.concurrent.TimeUnit.SECONDS);
    if (cached != null) proof.addProperty("playerId", cached.getUniqueId().toString());
    if (!proof.has("playerId") || proof.get("playerId").isJsonNull())
      throw new IllegalArgumentException("Account identity unavailable");
    return proof;
  }

  JsonObject execute(ControlSecurity.Request request) {
    if (!request.expiresAt().isAfter(Instant.now())) throw new IllegalArgumentException("Expired");
    JsonObject args = request.arguments();
    String op = request.operation();
    if (request.kind().equals("query")) {
      if (request.role().equals("PLAYER")
          && (!Set.of(
                      "player.snapshot",
                      "player.inventory",
                      "player.statistics",
                      "player.advancements")
                  .contains(op)
              || !request.actorId().toString().equals(args.get("playerId").getAsString())))
        throw new IllegalArgumentException("Own data only");
      return snapshots.query(op, args);
    }
    if (request.kind().equals("link")) {
      if (!op.equals("player.link.redeem"))
        throw new IllegalArgumentException("Unknown link operation");
      UUID id = links.redeem(text(args, "code", 64), Instant.now());
      Player player = id == null ? null : plugin.getServer().getPlayer(id);
      if (player == null || !auth.authenticated(player))
        throw new IllegalArgumentException("Link unavailable");
      return object(
          "playerId",
          player.getUniqueId().toString(),
          "name",
          player.getName(),
          "proof",
          "authenticated-in-game",
          "expiresAt",
          request.expiresAt().toString());
    }
    if (!settings.actions()
        || !settings.allowedActions().contains(op)
        || !Set.of("ADMIN", "OWNER").contains(request.role()))
      throw new IllegalArgumentException("Action disabled");
    boolean high =
        Set.of("player.inventory.clear", "server.console", "world.save", "world.border")
            .contains(op);
    if (high
        && (!request.role().equals("OWNER")
            || !request.confirmed()
            || !request.risk().equals("HIGH")))
      throw new IllegalArgumentException("Owner confirmation required");
    switch (op) {
      case "player.kick" ->
          snapshots
              .playerArg(args)
              .kick(net.kyori.adventure.text.Component.text(text(args, "reason", 256)));
      case "player.ban" ->
          snapshots
              .playerArg(args)
              .ban(text(args, "reason", 256), (Instant) null, "VanillaOnlineStats", true);
      case "player.unban" -> {
        UUID id = UUID.fromString(text(args, "playerId", 36));
        org.bukkit.ban.ProfileBanList bans = plugin.getServer().getBanList(BanList.Type.PROFILE);
        bans.pardon(plugin.getServer().createPlayerProfile(id));
      }
      case "player.whitelist.add", "player.whitelist.remove" ->
          plugin
              .getServer()
              .getOfflinePlayer(UUID.fromString(text(args, "playerId", 36)))
              .setWhitelisted(op.endsWith("add"));
      case "player.message" ->
          snapshots
              .playerArg(args)
              .sendMessage(net.kyori.adventure.text.Component.text(text(args, "message", 512)));
      case "server.broadcast" ->
          plugin
              .getServer()
              .broadcast(net.kyori.adventure.text.Component.text(text(args, "message", 512)));
      case "player.gamemode" ->
          snapshots.playerArg(args).setGameMode(GameMode.valueOf(text(args, "mode", 16)));
      case "player.health" -> {
        Player player = snapshots.playerArg(args);
        double value = number(args, "value", 0.01, player.getMaxHealth());
        player.setHealth(value);
      }
      case "player.food" ->
          snapshots.playerArg(args).setFoodLevel(Snapshots.integer(args, "value", 0, 20));
      case "player.level" ->
          snapshots.playerArg(args).setLevel(Snapshots.integer(args, "value", 0, 10000));
      case "player.inventory.clear" -> snapshots.playerArg(args).getInventory().clear();
      case "player.teleport" -> {
        World world = snapshots.worldArg(args);
        double x = number(args, "x", -29_999_984, 29_999_984),
            y = number(args, "y", world.getMinHeight() + 1, world.getMaxHeight() - 2),
            z = number(args, "z", -29_999_984, 29_999_984);
        Location location = new Location(world, x, y, z);
        if (!world.isChunkLoaded(location.getBlockX() >> 4, location.getBlockZ() >> 4)
            || !world.getWorldBorder().isInside(location)
            || !world.getBlockAt(location).isPassable()
            || !world.getBlockAt(location.clone().add(0, 1, 0)).isPassable()
            || !world.getBlockAt(location.clone().add(0, -1, 0)).getType().isSolid())
          throw new IllegalArgumentException("Unsafe destination or unloaded chunk");
        Set<Material> hazards =
            Set.of(
                Material.LAVA,
                Material.WATER,
                Material.FIRE,
                Material.SOUL_FIRE,
                Material.MAGMA_BLOCK,
                Material.CAMPFIRE,
                Material.SOUL_CAMPFIRE,
                Material.CACTUS,
                Material.POWDER_SNOW,
                Material.SWEET_BERRY_BUSH,
                Material.WITHER_ROSE);
        for (int dy = -1; dy <= 1; dy++) {
          var block = world.getBlockAt(location.clone().add(0, dy, 0));
          if (hazards.contains(block.getType()) || block.isLiquid())
            throw new IllegalArgumentException("Hazardous destination");
        }
        if (!snapshots.playerArg(args).teleport(location))
          throw new IllegalArgumentException("Teleport cancelled");
      }
      case "world.time" ->
          snapshots.worldArg(args).setTime(Snapshots.integer(args, "value", 0, 23999));
      case "world.weather" -> {
        World world = snapshots.worldArg(args);
        String weather = text(args, "value", 16);
        if (!Set.of("clear", "rain", "thunder").contains(weather))
          throw new IllegalArgumentException("Weather");
        world.setStorm(!weather.equals("clear"));
        world.setThundering(weather.equals("thunder"));
      }
      case "world.difficulty" ->
          snapshots.worldArg(args).setDifficulty(Difficulty.valueOf(text(args, "value", 16)));
      case "world.gamerule" -> {
        World world = snapshots.worldArg(args);
        String rule = text(args, "rule", 64), value = text(args, "value", 32);
        GameRule<?> gameRule = Registry.GAME_RULE.get(NamespacedKey.fromString(rule));
        if (gameRule == null) throw new IllegalArgumentException("Unknown gamerule");
        setRule(world, gameRule, value);
      }
      case "world.border" -> {
        World world = snapshots.worldArg(args);
        double value = number(args, "size", 1, 59_999_968);
        world.getWorldBorder().setSize(value);
      }
      case "world.save" -> snapshots.worldArg(args).save();
      case "server.console" -> {
        if (!settings.console()) throw new IllegalArgumentException("Console disabled");
        String command = text(args, "command", 512);
        String root = command.split(" ", 2)[0].toLowerCase(Locale.ROOT);
        Set<String> allowed =
            Set.copyOf(plugin.getConfig().getStringList("control.allowed-console-roots"));
        var registered = plugin.getServer().getPluginCommand(root);
        if (registered != null && registered.getPlugin().getName().equals("AuthMe"))
          throw new IllegalArgumentException("Authentication commands are forbidden");
        if (!allowed.contains(root)
            || command.chars().anyMatch(Character::isISOControl)
            || command.contains("\n")
            || command.contains("\r")
            || command.contains(";")
            || root.contains(":")
            || root.startsWith("/")
            || Set.of(
                    "op",
                    "deop",
                    "stop",
                    "restart",
                    "reload",
                    "login",
                    "l",
                    "register",
                    "reg",
                    "unregister",
                    "authme",
                    "changepassword",
                    "changepass",
                    "cp",
                    "email",
                    "2fa",
                    "totp",
                    "execute",
                    "function",
                    "sudo")
                .contains(root)) throw new IllegalArgumentException("Console denied");
        if (!plugin.getServer().dispatchCommand(plugin.getServer().getConsoleSender(), command))
          throw new IllegalArgumentException("Command failed");
      }
      default -> throw new IllegalArgumentException("Unknown action");
    }
    return object("operation", op, "completed", true);
  }

  @SuppressWarnings("unchecked")
  private <T> void setRule(World world, GameRule<T> rule, String value) {
    Object parsed;
    if (rule.getType() == Boolean.class) {
      if (!Set.of("true", "false").contains(value))
        throw new IllegalArgumentException("Boolean required");
      parsed = Boolean.valueOf(value);
    } else {
      int integer = Integer.parseInt(value);
      if (integer < 0 || integer > 1000000) throw new IllegalArgumentException("Integer range");
      parsed = integer;
    }
    if (!world.setGameRule(rule, (T) parsed))
      throw new IllegalArgumentException("Gamerule rejected");
  }

  static String text(JsonObject args, String key, int max) {
    String result = args.get(key).getAsString();
    if (result.isEmpty() || result.length() > max || result.indexOf('\0') >= 0)
      throw new IllegalArgumentException("Invalid text");
    return result;
  }

  private double number(JsonObject args, String key, double min, double max) {
    double value = args.get(key).getAsDouble();
    if (!Double.isFinite(value) || value < min || value > max)
      throw new IllegalArgumentException("Invalid number");
    return value;
  }
}
