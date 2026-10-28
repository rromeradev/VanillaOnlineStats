// SPDX-License-Identifier: AGPL-3.0-only
package dev.vanillaonlinestats.plugin;

import java.util.Objects;
import java.util.UUID;
import java.io.IOException;
import java.lang.management.ManagementFactory;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.java.JavaPlugin;

public final class VanillaOnlineStatsPlugin extends JavaPlugin {
    private HeartbeatTransport transport;
    private UUID serverId;

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
        try {
            serverId = InstallationIdentity.load(getDataFolder().toPath());
            if (getConfig().getBoolean("heartbeat.enabled", false)) {
                int interval = getConfig().getInt("heartbeat.interval-seconds", 10);
                int timeout = getConfig().getInt("heartbeat.timeout-seconds", 3);
                String token = System.getenv("VOS_AGENT_TOKEN");
                if (getConfig().getInt("schema-version") != 1 || interval < 5 || interval > 60
                        || timeout < 1 || timeout > 10 || token == null
                        || !token.matches("[A-Za-z0-9_-]{43,128}")) {
                    throw new IllegalArgumentException("Invalid heartbeat configuration");
                }
                transport = new HeartbeatTransport(HeartbeatTransport.endpoint(
                        getConfig().getString("heartbeat.endpoint", ""),
                        getConfig().getBoolean("heartbeat.allow-loopback-http", false)), token, timeout);
                transport.start();
                getServer().getScheduler().runTaskTimer(this, () -> transport.offer(Heartbeat.sample(
                        serverId, getPluginMeta().getVersion(), getServer().getMinecraftVersion(),
                        getServer().getVersion(),
                        authMe.getPluginMeta().getVersion(),
                        ManagementFactory.getRuntimeMXBean().getUptime() / 1000,
                        getServer().getOnlinePlayers().size())), 1L, interval * 20L);
            }
        } catch (IOException | IllegalArgumentException exception) {
            getLogger().severe("Identidade/configuracao invalida. Confira server-id.txt e heartbeat; valores omitidos.");
            getServer().getPluginManager().disablePlugin(this);
            return;
        }
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
                    + " | API local OK | serverId=" + serverId + " | heartbeat="
                    + (transport == null ? "desativado" : transport.status()));
            return true;
        });
        getLogger().info("Bootstrap pronto; AuthMe API disponivel; heartbeat "
                + (transport == null ? "desativado." : "habilitado."));
    }

    @Override public void onDisable() {
        getServer().getScheduler().cancelTasks(this);
        if (transport != null) transport.close();
    }
}
