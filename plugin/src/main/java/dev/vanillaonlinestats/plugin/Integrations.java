// SPDX-License-Identifier: AGPL-3.0-only
package dev.vanillaonlinestats.plugin;

import static dev.vanillaonlinestats.plugin.Telemetry.object;

import com.google.gson.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

/** Optional public API adapters. Never reads third-party databases or private files. */
final class Integrations {
  private final JavaPlugin plugin;

  Integrations(JavaPlugin plugin) {
    this.plugin = plugin;
  }

  JsonObject status() {
    JsonArray entries = new JsonArray();
    for (String name :
        List.of(
            "LuckPerms",
            "Vault",
            "PlaceholderAPI",
            "WorldGuard",
            "CoreProtect",
            "Essentials",
            "spark",
            "BlueMap",
            "dynmap")) {
      var target = plugin.getServer().getPluginManager().getPlugin(name);
      entries.add(
          object(
              "name",
              name,
              "installed",
              target != null,
              "enabled",
              target != null && target.isEnabled(),
              "version",
              target == null ? "unavailable" : target.getPluginMeta().getVersion(),
              "adapter",
              Set.of("LuckPerms", "Vault", "PlaceholderAPI").contains(name)
                  ? "public-api-optional-unverified"
                  : "external-integration-not-implemented"));
    }
    return object("items", entries);
  }

  @SuppressWarnings({"unchecked", "rawtypes"})
  JsonObject query(String operation, Player player, JsonObject arguments)
      throws ReflectiveOperationException {
    String name =
        switch (operation) {
          case "integration.luckperms" -> "LuckPerms";
          case "integration.vault" -> "Vault";
          case "integration.placeholder" -> "PlaceholderAPI";
          default -> throw new IllegalArgumentException("Unknown adapter");
        };
    var target = plugin.getServer().getPluginManager().getPlugin(name);
    if (target == null
        || !target.isEnabled()
        || !plugin.getConfig().getBoolean("integrations." + name.toLowerCase(Locale.ROOT), false))
      throw new IllegalArgumentException("Integration unavailable");
    ClassLoader loader = target.getClass().getClassLoader();
    if (name.equals("LuckPerms")) {
      Class<?> provider = Class.forName("net.luckperms.api.LuckPermsProvider", true, loader);
      Object api = provider.getMethod("get").invoke(null);
      Class<?> apiType = Class.forName("net.luckperms.api.LuckPerms", true, loader);
      Object manager = apiType.getMethod("getUserManager").invoke(api);
      Object user =
          Class.forName("net.luckperms.api.model.user.UserManager", true, loader)
              .getMethod("getUser", UUID.class)
              .invoke(manager, player.getUniqueId());
      if (user == null) throw new IllegalArgumentException("User not cached");
      Object group =
          Class.forName("net.luckperms.api.model.user.User", true, loader)
              .getMethod("getPrimaryGroup")
              .invoke(user);
      return object("primaryGroup", group.toString(), "source", "luckperms-public-api");
    }
    if (name.equals("Vault")) {
      Class<?> economy = Class.forName("net.milkbowl.vault.economy.Economy", true, loader);
      var registration = plugin.getServer().getServicesManager().getRegistration((Class) economy);
      if (registration == null) throw new IllegalArgumentException("Economy provider unavailable");
      Object balance =
          economy
              .getMethod("getBalance", OfflinePlayer.class)
              .invoke(registration.getProvider(), player);
      return object("balance", ((Number) balance).doubleValue(), "source", "vault-public-api");
    }
    String placeholder = RemoteActions.text(arguments, "placeholder", 128);
    if (!plugin
            .getConfig()
            .getStringList("integrations.placeholder-allowlist")
            .contains(placeholder)
        || placeholder
            .toLowerCase(Locale.ROOT)
            .matches(".*(password|hash|token|secret|authme|address|email|ip).*"))
      throw new IllegalArgumentException("Placeholder denied");
    Class<?> api = Class.forName("me.clip.placeholderapi.PlaceholderAPI", true, loader);
    String value =
        (String)
            api.getMethod("setPlaceholders", OfflinePlayer.class, String.class)
                .invoke(null, player, placeholder);
    if (value.length() > 512) throw new IllegalArgumentException("Placeholder too long");
    return object(
        "placeholder", placeholder, "value", value, "resolved", !value.equals(placeholder));
  }
}
