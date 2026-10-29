// SPDX-License-Identifier: AGPL-3.0-only
package dev.vanillaonlinestats.plugin;

import java.lang.management.ManagementFactory;
import java.util.Objects;
import java.util.UUID;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.java.JavaPlugin;

public final class VanillaOnlineStatsPlugin extends JavaPlugin {
  private HeartbeatTransport transport;
  private UUID serverId;
  private Telemetry bus;
  private BatchSender batches;
  private CollectorRegistry collectors;
  private ControlChannel control;
  private Settings settings;
  private Snapshots snapshots;
  private AuthMeBridge auth;
  private EncryptedSpool spool;
  private HostMetrics host;
  private final LinkCodes links = new LinkCodes();

  @Override
  public void onEnable() {
    Plugin authMe = getServer().getPluginManager().getPlugin("AuthMe");
    if (authMe == null
        || !authMe.isEnabled()
        || !Compatibility.supports(
            getServer().getMinecraftVersion(), authMe.getPluginMeta().getVersion())) {
      getLogger()
          .severe("Baseline exigida: Paper 26.3 e AuthMe 6.0.1 habilitado. Plugin desativado.");
      getServer().getPluginManager().disablePlugin(this);
      return;
    }
    // Verify the public API is visible through the declared hard dependency.
    try {
      Class<?> api =
          Class.forName(
              "fr.xephi.authme.api.v3.AuthMeApi", true, authMe.getClass().getClassLoader());
      Objects.requireNonNull(api.getMethod("getInstance").invoke(null));
    } catch (ReflectiveOperationException | LinkageError | NullPointerException exception) {
      getLogger().severe("API publica AuthMe indisponivel; plugin desativado.");
      getServer().getPluginManager().disablePlugin(this);
      return;
    }
    saveDefaultConfig();
    try {
      if (getConfig().getInt("schema-version", 1) == 1) {
        var backup = getDataFolder().toPath().resolve("config-v1.backup.yml");
        if (!java.nio.file.Files.exists(backup))
          java.nio.file.Files.copy(getDataFolder().toPath().resolve("config.yml"), backup);
        getConfig().set("schema-version", 2);
      }
      getConfig().options().copyDefaults(true);
      saveConfig();
      settings = Settings.read(getConfig());
      serverId = InstallationIdentity.load(getDataFolder().toPath());
      auth = new AuthMeBridge(authMe);
      bus = new Telemetry(serverId, settings.queueMessages(), settings.queueBytes());
      getServer()
          .getScheduler()
          .runTaskTimer(
              this, () -> bus.expire(java.time.Instant.now().minusSeconds(300)), 200, 200);
      String storageKey = System.getenv("VOS_STORAGE_KEY");
      if (storageKey != null && !storageKey.isBlank())
        spool =
            new EncryptedSpool(getDataFolder().toPath(), storageKey, bus, settings.queueBytes());
      snapshots = new Snapshots(this, settings, auth);
      java.util.Map<String, java.nio.file.Path> folders = new java.util.LinkedHashMap<>();
      getServer().getWorlds().stream()
          .limit(settings.maxWorlds())
          .forEach(w -> folders.put(w.getUID().toString(), w.getWorldFolder().toPath()));
      host =
          new HostMetrics(
              getDataFolder().toPath(),
              folders,
              getConfig().getBoolean("collectors.world-storage", false),
              bus);
      snapshots.host = host;
      collectors = new CollectorRegistry(this, settings, snapshots, bus, auth);
      getServer()
          .getScheduler()
          .runTaskTimer(this, () -> collectors.livePlayers(this, snapshots, bus, auth), 20, 20);
      GameEvents events = new GameEvents(this, settings, bus, auth, links::revoke);
      auth.listen(this, authMe, events::authEvent);
      String agentToken = System.getenv("VOS_AGENT_TOKEN");
      if (settings.telemetryEndpoint() != null || settings.controlEndpoint() != null) {
        if (agentToken == null || !agentToken.matches("[A-Za-z0-9_-]{43,128}"))
          throw new IllegalArgumentException("VOS_AGENT_TOKEN ausente/invalido");
        batches = new BatchSender(settings, bus, agentToken);
        if (settings.controlEndpoint() != null)
          control =
              new ControlChannel(
                  this,
                  settings,
                  serverId,
                  getDataFolder().toPath(),
                  agentToken,
                  new RemoteActions(this, settings, snapshots, links, auth),
                  collectors,
                  bus);
        if (control != null) batches.delegate(control::telemetryActive);
      }
      if (getConfig().getBoolean("heartbeat.enabled", false)) {
        int interval = getConfig().getInt("heartbeat.interval-seconds", 10);
        int timeout = getConfig().getInt("heartbeat.timeout-seconds", 3);
        String token = System.getenv("VOS_AGENT_TOKEN");
        if (interval < 5
            || interval > 60
            || timeout < 1
            || timeout > 10
            || token == null
            || !token.matches("[A-Za-z0-9_-]{43,128}")) {
          throw new IllegalArgumentException("Invalid heartbeat configuration");
        }
        transport =
            new HeartbeatTransport(
                HeartbeatTransport.endpoint(
                    getConfig().getString("heartbeat.endpoint", ""),
                    getConfig().getBoolean("heartbeat.allow-loopback-http", false)),
                token,
                timeout);
        transport.start();
        getServer()
            .getScheduler()
            .runTaskTimer(
                this,
                () ->
                    transport.offer(
                        Heartbeat.sample(
                            serverId,
                            getPluginMeta().getVersion(),
                            getServer().getMinecraftVersion(),
                            getServer().getVersion(),
                            authMe.getPluginMeta().getVersion(),
                            ManagementFactory.getRuntimeMXBean().getUptime() / 1000,
                            getServer().getOnlinePlayers().size())),
                1L,
                interval * 20L);
      }
    } catch (Exception exception) {
      getLogger()
          .severe(
              "Inicializacao recusada. Confira identidade, limites, AuthMe API, VOS_AGENT_TOKEN e"
                  + " chave publica de controle. Valores omitidos.");
      getServer().getPluginManager().disablePlugin(this);
      return;
    }
    Objects.requireNonNull(getCommand("vos"))
        .setExecutor(
            (sender, command, label, args) -> {
              if (args.length == 1 && args[0].equalsIgnoreCase("link")) {
                if (!(sender instanceof org.bukkit.entity.Player player)
                    || !auth.authenticated(player)) {
                  sender.sendMessage("Entre e autentique-se no jogo primeiro.");
                  return true;
                }
                sender.sendMessage(
                    "Codigo privado de uso unico (120s): "
                        + links.issue(player.getUniqueId(), java.time.Instant.now()));
                return true;
              }
              if (!sender.hasPermission("vanillaonlinestats.status")) {
                sender.sendMessage("Sem permissao.");
                return true;
              }
              if (args.length == 1 && args[0].equalsIgnoreCase("collectors")) {
                sender.sendMessage(collectors.status().toString());
                return true;
              }
              if (args.length == 1 && args[0].equalsIgnoreCase("capabilities")) {
                sender.sendMessage(collectors.capabilities().toString());
                return true;
              }
              if (args.length == 1 && args[0].equalsIgnoreCase("queue")) {
                sender.sendMessage(bus.status().toString());
                return true;
              }
              if (args.length >= 2 && args[0].equalsIgnoreCase("query")) {
                if (!(sender instanceof org.bukkit.command.ConsoleCommandSender)) {
                  sender.sendMessage(
                      "Consulta detalhada disponivel somente no console ou canal assinado.");
                  return true;
                }
                try {
                  var parameters =
                      args.length >= 3
                          ? com.google.gson.JsonParser.parseString(
                                  String.join(
                                      " ", java.util.Arrays.copyOfRange(args, 2, args.length)))
                              .getAsJsonObject()
                          : new com.google.gson.JsonObject();
                  String result = snapshots.query(args[1], parameters).toString();
                  sender.sendMessage(
                      result.length() > 16000
                          ? "Resultado excede o console; use o canal assinado."
                          : result);
                } catch (RuntimeException invalid) {
                  sender.sendMessage(
                      "Consulta recusada: operacao, argumentos ou politica de coleta.");
                }
                return true;
              }
              if (args.length != 1 || !args[0].equalsIgnoreCase("status")) return false;
              sender.sendMessage(
                  "VanillaOnlineStats "
                      + getPluginMeta().getVersion()
                      + " | AuthMe "
                      + authMe.getPluginMeta().getVersion()
                      + " | API local OK | serverId="
                      + serverId
                      + " | heartbeat="
                      + (transport == null ? "desativado" : transport.status()));
              sender.sendMessage(
                  "Telemetria="
                      + (batches == null ? "local; envio desativado" : batches.status())
                      + " | controle="
                      + (control == null ? "desativado" : control.status()));
              sender.sendMessage(
                  "Spool=" + (spool == null ? "desativado (VOS_STORAGE_KEY)" : spool.status()));
              return true;
            });
    getLogger()
        .info(
            "Bootstrap pronto; AuthMe API disponivel; heartbeat "
                + (transport == null ? "desativado." : "habilitado."));
  }

  @Override
  public void onDisable() {
    getServer().getScheduler().cancelTasks(this);
    if (transport != null) transport.close();
    if (batches != null) batches.close();
    if (control != null) control.close();
    links.clear();
    if (spool != null) spool.close();
    if (host != null) host.close();
  }
}
