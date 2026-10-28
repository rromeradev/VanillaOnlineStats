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
