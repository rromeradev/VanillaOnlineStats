// SPDX-License-Identifier: AGPL-3.0-only
package dev.vanillaonlinestats.plugin;

import java.util.Objects;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.java.JavaPlugin;

public final class VanillaOnlineStatsPlugin extends JavaPlugin {
    @Override
    public void onEnable() {
        Plugin authMe = getServer().getPluginManager().getPlugin("AuthMe");
        if (authMe == null || !authMe.isEnabled()
                || !Compatibility.supports(getServer().getMinecraftVersion(), authMe.getPluginMeta().getVersion())) {
            getLogger().severe("Baseline exigida: Paper 26.3 e AuthMe 6.0.1 habilitado. Plugin desativado.");
            getServer().getPluginManager().disablePlugin(this);
            return;
        }
        // Verify the public API is visible through the declared hard dependency.
        try {
            Class<?> api = Class.forName("fr.xephi.authme.api.v3.AuthMeApi", true, authMe.getClass().getClassLoader());
            Objects.requireNonNull(api.getMethod("getInstance").invoke(null));
        } catch (ReflectiveOperationException | LinkageError | NullPointerException exception) {
            getLogger().severe("API publica AuthMe indisponivel; plugin desativado.");
            getServer().getPluginManager().disablePlugin(this);
            return;
        }
        saveDefaultConfig();
        Objects.requireNonNull(getCommand("vos")).setExecutor((sender, command, label, args) -> {
            if (!sender.hasPermission("vanillaonlinestats.status")) {
                sender.sendMessage("Sem permissao.");
                return true;
            }
            if (args.length != 1 || !args[0].equalsIgnoreCase("status")) {
                return false;
            }
            sender.sendMessage("VanillaOnlineStats " + getPluginMeta().getVersion()
                    + " | AuthMe " + authMe.getPluginMeta().getVersion()
                    + " | API local OK | transporte pendente");
            return true;
        });
        getLogger().info("Bootstrap pronto; AuthMe API disponivel; transporte desativado.");
    }
}
