// SPDX-License-Identifier: AGPL-3.0-only
package dev.vanillaonlinestats.plugin;

import java.lang.reflect.Method;
import java.util.function.BiConsumer;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.java.JavaPlugin;

final class AuthMeBridge {
  private final Object api;
  private final Method authenticated;
  private final Method npc;
  private final Method unrestricted;

  AuthMeBridge(Plugin authMe) throws ReflectiveOperationException {
    Class<?> type =
        Class.forName("fr.xephi.authme.api.v3.AuthMeApi", true, authMe.getClass().getClassLoader());
    api = type.getMethod("getInstance").invoke(null);
    if (api == null) throw new IllegalStateException("AuthMe unavailable");
    authenticated = type.getMethod("isAuthenticated", Player.class);
    npc = type.getMethod("isNpc", Player.class);
    unrestricted = type.getMethod("isUnrestricted", Player.class);
  }

  boolean authenticated(Player player) {
    try {
      return (boolean) authenticated.invoke(api, player)
          && !(boolean) npc.invoke(api, player)
          && !(boolean) unrestricted.invoke(api, player);
    } catch (ReflectiveOperationException error) {
      return false;
    }
  }

  com.google.gson.JsonObject passwordLogin(String name, String password) throws Exception {
    if (!name.matches("[A-Za-z0-9_]{3,16}") || password.isEmpty() || password.length() > 128)
      throw new IllegalArgumentException("Invalid credentials");
    // Baseline-specific adapter: fail closed if AuthMe cannot expose the account's 2FA policy.
    var sourceField = api.getClass().getDeclaredField("dataSource");
    sourceField.setAccessible(true);
    Object source = sourceField.get(api);
    Class<?> sourceType =
        Class.forName(
            "fr.xephi.authme.datasource.DataSource", true, api.getClass().getClassLoader());
    Object account =
        sourceType
            .getMethod("getAuth", String.class)
            .invoke(source, name.toLowerCase(java.util.Locale.ROOT));
    if (account == null) throw new IllegalArgumentException("Invalid credentials");
    String totp = (String) account.getClass().getMethod("getTotpKey").invoke(account);
    if (totp != null && !totp.isBlank())
      throw new IllegalArgumentException("Additional authentication required");
    if (!(boolean)
        api.getClass()
            .getMethod("checkPassword", String.class, String.class)
            .invoke(api, name, password)) throw new IllegalArgumentException("Invalid credentials");
    java.util.UUID uuid = (java.util.UUID) account.getClass().getMethod("getUuid").invoke(account);
    String realName = (String) account.getClass().getMethod("getRealName").invoke(account);
    return Telemetry.object(
        "playerId",
        uuid == null ? null : uuid.toString(),
        "name",
        realName == null ? name : realName,
        "proof",
        "authme-password");
  }

  @SuppressWarnings("unchecked")
  void listen(JavaPlugin plugin, Plugin authMe, BiConsumer<Player, String> callback)
      throws ReflectiveOperationException {
    Listener owner = new Listener() {};
    for (String name :
        new String[] {
          "LoginEvent",
          "LogoutEvent",
          "RestoreSessionEvent",
          "RegisterEvent",
          "UnregisterByPlayerEvent"
        }) {
      Class<? extends Event> type =
          (Class<? extends Event>)
              Class.forName(
                  "fr.xephi.authme.events." + name, true, authMe.getClass().getClassLoader());
      Method getPlayer = type.getMethod("getPlayer");
      plugin
          .getServer()
          .getPluginManager()
          .registerEvent(
              type,
              owner,
              EventPriority.MONITOR,
              (listener, event) -> {
                try {
                  Object value = getPlayer.invoke(event);
                  if (value instanceof Player player) {
                    Runnable task = () -> callback.accept(player, name);
                    if (event.isAsynchronous())
                      plugin.getServer().getScheduler().runTask(plugin, task);
                    else task.run();
                  }
                } catch (ReflectiveOperationException ignored) {
                }
              },
              plugin,
              true);
    }
  }
}
