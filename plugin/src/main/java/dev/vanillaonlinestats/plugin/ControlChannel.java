// SPDX-License-Identifier: AGPL-3.0-only
package dev.vanillaonlinestats.plugin;

import static dev.vanillaonlinestats.plugin.Telemetry.object;

import com.google.gson.*;
import java.net.http.*;
import java.nio.file.Path;
import java.time.*;
import java.util.*;
import java.util.UUID;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import org.bukkit.plugin.java.JavaPlugin;

/** Outbound only. Machine credential cannot sign commands: separate pinned Ed25519 key. */
final class ControlChannel implements AutoCloseable {
  private final JavaPlugin plugin;
  private final HttpClient client;
  private final Settings settings;
  private final RemoteActions actions;
  private final ControlSecurity security;
  private final AuditLedger audit;
  private final CollectorRegistry registry;
  private final ThreadPoolExecutor work =
      new ThreadPoolExecutor(
          1,
          1,
          0,
          TimeUnit.SECONDS,
          new ArrayBlockingQueue<>(32),
          r -> {
            Thread t = new Thread(r, "vos-control-verify");
            t.setDaemon(true);
            return t;
          },
          new ThreadPoolExecutor.AbortPolicy());
  private final ScheduledExecutorService reconnect =
      Executors.newSingleThreadScheduledExecutor(
          r -> {
            Thread t = new Thread(r, "vos-control-connect");
            t.setDaemon(true);
            return t;
          });
  private final AtomicInteger inFlight = new AtomicInteger(), sending = new AtomicInteger();
  private final AtomicBoolean connecting = new AtomicBoolean();
  private final AtomicBoolean changingSkin = new AtomicBoolean();
  private volatile WebSocket socket;
  private volatile boolean closed;
  private volatile String state = "aguardando";
  private volatile boolean healthy = true;
  private CompletableFuture<?> tail = CompletableFuture.completedFuture(null);
  private long rateStart = System.nanoTime();
  private int requests;
  private int readRequests;
  private int frames;
  private int watchRequests;
  private final LiveWatches watches;
  private final Telemetry telemetry;
  private volatile boolean streaming;
  private volatile boolean telemetryStreaming;
  private volatile List<Telemetry.Entry> streamBatch = List.of();
  private long streamSent;

  ControlChannel(
      JavaPlugin plugin,
      Settings settings,
      UUID serverId,
      Path directory,
      String token,
      RemoteActions actions,
      CollectorRegistry registry,
      Telemetry telemetry)
      throws Exception {
    this.plugin = plugin;
    this.settings = settings;
    this.actions = actions;
    this.registry = registry;
    this.telemetry = telemetry;
    watches =
        new LiveWatches(
            settings.budgetNanos(),
            actions::execute,
            (id, value) -> {
              value.addProperty("type", "watch.update");
              value.addProperty("watchId", id.toString());
              WebSocket active = socket;
              if (active != null) send(active, value);
            });
    plugin
        .getServer()
        .getScheduler()
        .runTaskTimer(
            plugin,
            () -> {
              if (streaming && !closed) watches.tick();
            },
            1,
            1);
    security = new ControlSecurity(settings.publicKey(), serverId, settings.tenantId());
    audit = new AuditLedger(directory);
    client =
        HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(settings.timeoutSeconds()))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();
    reconnect.scheduleWithFixedDelay(
        () -> {
          if (closed || !healthy || socket != null || !connecting.compareAndSet(false, true))
            return;
          client
              .newWebSocketBuilder()
              .connectTimeout(Duration.ofSeconds(settings.timeoutSeconds()))
              .header("Authorization", "Bearer " + token)
              .buildAsync(settings.controlEndpoint(), new Listener())
              .whenComplete(
                  (ws, error) -> {
                    connecting.set(false);
                    if (error != null) state = "indisponivel ou rejeitado";
                  });
        },
        0,
        5,
        TimeUnit.SECONDS);
    reconnect.scheduleWithFixedDelay(this::flushTelemetry, 200, 200, TimeUnit.MILLISECONDS);
  }

  private final class Listener implements WebSocket.Listener {
    private final StringBuilder message = new StringBuilder();

    @Override
    public void onOpen(WebSocket ws) {
      if (closed) {
        ws.abort();
        return;
      }
      socket = ws;
      state = "conectado";
      send(ws, object("type", "agent.capabilities", "payload", registry.capabilities()));
      ws.request(1);
    }

    @Override
    public CompletionStage<?> onText(WebSocket ws, CharSequence data, boolean last) {
      if (message.length() + data.length() > 65536) {
        ws.abort();
        disconnected(ws);
        return CompletableFuture.completedFuture(null);
      }
      message.append(data);
      if (last) {
        String raw = message.toString();
        message.setLength(0);
        try {
          work.execute(() -> receive(ws, raw));
        } catch (RejectedExecutionException saturated) {
          ws.abort();
          disconnected(ws);
        }
      }
      ws.request(1);
      return CompletableFuture.completedFuture(null);
    }

    @Override
    public CompletionStage<?> onClose(WebSocket ws, int status, String reason) {
      disconnected(ws);
      return CompletableFuture.completedFuture(null);
    }

    @Override
    public void onError(WebSocket ws, Throwable error) {
      disconnected(ws);
    }

    @Override
    public CompletionStage<?> onBinary(WebSocket ws, java.nio.ByteBuffer data, boolean last) {
      ws.abort();
      disconnected(ws);
      return CompletableFuture.completedFuture(null);
    }
  }

  private void receive(WebSocket origin, String raw) {
    if (closed || !healthy || socket != origin) return;
    long now = System.nanoTime();
    if (now - rateStart > TimeUnit.MINUTES.toNanos(1)) {
      rateStart = now;
      requests = 0;
      readRequests = 0;
      frames = 0;
      watchRequests = 0;
    }
    if (++frames > 2000) {
      origin.abort();
      disconnected(origin);
      return;
    }
    try {
      var value = JsonParser.parseString(raw).getAsJsonObject();
      if (value.has("type") && value.get("type").getAsString().equals("agent.ready")) {
        streaming = value.has("watches") && value.get("watches").getAsBoolean();
        telemetryStreaming =
            value.has("telemetry")
                && value.get("telemetry").getAsBoolean()
                && settings.telemetryEndpoint() != null;
        return;
      }
      if (value.has("type") && value.get("type").getAsString().equals("agent.telemetry.ack")) {
        ackTelemetry(value.getAsJsonArray("ids"));
        return;
      }
    } catch (RuntimeException invalid) {
      return;
    }
    ControlSecurity.Request request;
    try {
      request = security.verify(raw, Instant.now());
    } catch (Exception denied) {
      send(origin, object("type", "control.rejected", "reason", "INVALID_OR_UNAUTHORIZED"));
      return;
    }
    if (request.kind().equals("watch")
        ? ++watchRequests > 256
        : request.kind().equals("query") ? ++readRequests > 600 : ++requests > 30) {
      send(origin, result(request, "REJECTED", object("reasonCode", "RATE_LIMITED")));
      return;
    }
    if (inFlight.incrementAndGet() > 8) {
      inFlight.decrementAndGet();
      send(origin, result(request, "REJECTED", null));
      return;
    }
    try {
      audit.claim(request, Instant.now());
    } catch (Exception denied) {
      inFlight.decrementAndGet();
      send(origin, result(request, "REJECTED", null));
      return;
    }
    if (request.kind().equals("link") && request.operation().equals("player.authme.login")) {
      try {
        JsonObject payload = actions.passwordLogin(request);
        if (!request.expiresAt().isAfter(Instant.now()))
          throw new IllegalArgumentException("Expired");
        audit.result(request, "SUCCEEDED");
        send(origin, result(request, "SUCCEEDED", payload));
      } catch (Exception rejected) {
        try {
          audit.result(request, "FAILED");
        } catch (Exception unavailable) {
          healthy = false;
        }
        send(origin, result(request, "FAILED", null));
      } finally {
        inFlight.decrementAndGet();
      }
      return;
    }
    if (request.kind().equals("skin")) {
      if (!changingSkin.compareAndSet(false, true)) {
        inFlight.decrementAndGet();
        send(origin, result(request, "REJECTED", object("reasonCode", "SKIN_BUSY")));
        return;
      }
      Thread worker =
          new Thread(
              () -> {
                String outcome = "FAILED";
                JsonObject payload;
                try {
                  payload = SkinChanges.apply(plugin, actions.auth(), request);
                  outcome = "SUCCEEDED";
                } catch (Exception failure) {
                  payload =
                      object(
                          "reasonCode",
                          failure instanceof ControlFailure rejected
                              ? rejected.code
                              : "SKIN_STORAGE_FAILED");
                }
                try {
                  audit.result(request, outcome);
                  send(origin, result(request, outcome, payload));
                } catch (Exception failure) {
                  healthy = false;
                } finally {
                  changingSkin.set(false);
                  inFlight.decrementAndGet();
                }
              },
              "vos-skin-change");
      worker.setDaemon(true);
      worker.start();
      return;
    }
    try {
      plugin
          .getServer()
          .getScheduler()
          .runTask(
              plugin,
              () -> {
                String outcome = "REJECTED";
                JsonObject payload = null;
                try {
                  if (socket == origin
                      && !closed
                      && healthy
                      && request.expiresAt().isAfter(Instant.now())) {
                    if (request.kind().equals("watch")) {
                      watches.accept(request);
                      payload = object("subscribed", true);
                    } else payload = actions.execute(request);
                    outcome = "SUCCEEDED";
                  } else if (!request.expiresAt().isAfter(Instant.now())) outcome = "EXPIRED";
                } catch (Exception failed) {
                  outcome = "FAILED";
                  payload =
                      object(
                          "reasonCode",
                          failed instanceof ControlFailure failure
                              ? failure.code
                              : failed instanceof IllegalArgumentException
                                  ? "INVALID_ARGUMENTS"
                                  : "OPERATION_FAILED");
                }
                String completed = outcome;
                JsonObject data = payload;
                try {
                  work.execute(
                      () -> {
                        try {
                          audit.result(request, completed);
                          if (request.kind().equals("watch") && !completed.equals("SUCCEEDED"))
                            send(
                                origin,
                                object(
                                    "type",
                                    "watch.error",
                                    "watchId",
                                    request.arguments().get("watchId").getAsString(),
                                    "payload",
                                    data == null
                                        ? object("reasonCode", "SUBSCRIPTION_FAILED")
                                        : data));
                          send(origin, result(request, completed, data));
                        } catch (Exception failure) {
                          healthy = false;
                          state = "auditoria indisponivel; controle bloqueado";
                          origin.abort();
                          disconnected(origin);
                        } finally {
                          inFlight.decrementAndGet();
                        }
                      });
                } catch (RejectedExecutionException stopped) {
                  inFlight.decrementAndGet();
                  healthy = false;
                }
              });
    } catch (RuntimeException stopped) {
      inFlight.decrementAndGet();
    }
  }

  private JsonObject result(ControlSecurity.Request request, String state, JsonObject payload) {
    return object(
        "type",
        "control.result",
        "actionId",
        request.actionId().toString(),
        "auditCorrelationId",
        request.auditId().toString(),
        "state",
        state,
        "payload",
        payload);
  }

  private synchronized void send(WebSocket origin, JsonObject value) {
    sendFrame(origin, value, 65536);
  }

  private synchronized void sendFrame(WebSocket origin, JsonObject value, int limit) {
    String json = value.toString();
    if (closed
        || socket != origin
        || json.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > limit) return;
    if (sending.incrementAndGet() > 32) {
      sending.decrementAndGet();
      origin.abort();
      disconnected(origin);
      return;
    }
    tail =
        tail.handle((previous, error) -> null)
            .thenCompose(
                ignored -> {
                  if (closed || socket != origin) return CompletableFuture.completedFuture(origin);
                  return origin.sendText(json, true);
                })
            .whenComplete(
                (ws, error) -> {
                  sending.decrementAndGet();
                  if (error != null) disconnected(origin);
                });
  }

  private void disconnected(WebSocket origin) {
    if (socket == origin) {
      socket = null;
      streaming = false;
      telemetryStreaming = false;
      streamBatch = List.of();
      if (plugin.isEnabled()) plugin.getServer().getScheduler().runTask(plugin, watches::clear);
      if (healthy) state = "desconectado; reconectando";
    }
  }

  String status() {
    return state + " pendentes=" + inFlight.get() + " assinaturas=" + watches.size();
  }

  boolean telemetryActive() {
    return telemetryStreaming && socket != null && !closed;
  }

  private synchronized void flushTelemetry() {
    WebSocket active = socket;
    if (!telemetryActive() || active == null) return;
    Instant cutoff = Instant.now().minusSeconds(300);
    telemetry.expire(cutoff);
    if (streamBatch.stream().anyMatch(entry -> entry.occurredAt().isBefore(cutoff)))
      streamBatch = List.of();
    if (!streamBatch.isEmpty() && System.nanoTime() - streamSent < 3_000_000_000L) return;
    if (streamBatch.isEmpty()) {
      var selected = new ArrayList<Telemetry.Entry>();
      int bytes = 0;
      for (var entry : telemetry.batch(Math.min(settings.batchMessages(), 32))) {
        if (bytes + entry.bytes() > 200000) break;
        selected.add(entry);
        bytes += entry.bytes();
      }
      streamBatch = List.copyOf(selected);
    }
    if (streamBatch.isEmpty()) return;
    JsonArray values = new JsonArray();
    streamBatch.forEach(entry -> values.add(JsonParser.parseString(entry.json())));
    streamSent = System.nanoTime();
    sendLarge(active, object("type", "agent.telemetry", "messages", values));
  }

  private synchronized void ackTelemetry(JsonArray ids) {
    if (ids == null) return;
    Set<String> allowed = new HashSet<>();
    streamBatch.forEach(entry -> allowed.add(entry.messageId()));
    Set<String> accepted = new HashSet<>();
    for (var id : ids) if (allowed.contains(id.getAsString())) accepted.add(id.getAsString());
    telemetry.acknowledge(accepted);
    streamBatch = List.of();
  }

  private synchronized void sendLarge(WebSocket origin, JsonObject value) {
    sendFrame(origin, value, 262144);
  }

  @Override
  public void close() {
    closed = true;
    WebSocket active = socket;
    socket = null;
    streaming = false;
    watches.clear();
    if (active != null) active.abort();
    work.shutdownNow();
    reconnect.shutdownNow();
    client.shutdownNow();
  }
}
