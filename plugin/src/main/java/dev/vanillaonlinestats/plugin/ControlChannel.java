// SPDX-License-Identifier: AGPL-3.0-only
package dev.vanillaonlinestats.plugin;

import static dev.vanillaonlinestats.plugin.Telemetry.object;

import com.google.gson.*;
import java.net.http.*;
import java.nio.file.Path;
import java.time.*;
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
  private volatile WebSocket socket;
  private volatile boolean closed;
  private volatile String state = "aguardando";
  private volatile boolean healthy = true;
  private CompletableFuture<?> tail = CompletableFuture.completedFuture(null);
  private long rateStart = System.nanoTime();
  private int requests;

  ControlChannel(
      JavaPlugin plugin,
      Settings settings,
      UUID serverId,
      Path directory,
      String token,
      RemoteActions actions,
      CollectorRegistry registry)
      throws Exception {
    this.plugin = plugin;
    this.settings = settings;
    this.actions = actions;
    this.registry = registry;
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
    }
    if (++requests > 30) {
      state = "limite de controle";
      origin.abort();
      disconnected(origin);
      return;
    }
    ControlSecurity.Request request;
    try {
      request = security.verify(raw, Instant.now());
    } catch (Exception denied) {
      send(origin, object("type", "control.rejected", "reason", "INVALID_OR_UNAUTHORIZED"));
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
                    payload = actions.execute(request);
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
    String json = value.toString();
    if (closed || socket != origin || json.length() > 65536) return;
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
      if (healthy) state = "desconectado; reconectando";
    }
  }

  String status() {
    return state + " pendentes=" + inFlight.get();
  }

  @Override
  public void close() {
    closed = true;
    WebSocket active = socket;
    socket = null;
    if (active != null) active.abort();
    work.shutdownNow();
    reconnect.shutdownNow();
    client.shutdownNow();
  }
}
