// SPDX-License-Identifier: AGPL-3.0-only
package dev.vanillaonlinestats.plugin;

import com.google.gson.JsonParser;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

/** One immutable pending snapshot, one worker, at most three attempts per message. */
final class HeartbeatTransport implements AutoCloseable {
  interface Sender {
    int send(String json) throws IOException, InterruptedException;
  }

  record Pending(Heartbeat heartbeat, int attempts) {}

  private final AtomicReference<Pending> pending = new AtomicReference<>();
  private final AtomicLong sent = new AtomicLong(),
      failures = new AtomicLong(),
      dropped = new AtomicLong();
  private final Sender sender;
  private final HttpClient client;
  private ScheduledExecutorService worker;
  private volatile boolean closed;
  private volatile String state = "aguardando amostra";
  private volatile Instant lastSuccess;
  private long nextAttemptNanos;
  private int consecutiveFailures;

  HeartbeatTransport(URI endpoint, String token, int timeoutSeconds) {
    client =
        HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(Duration.ofSeconds(timeoutSeconds))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();
    sender =
        json -> {
          var response =
              client.send(
                  HttpRequest.newBuilder(endpoint)
                      .timeout(Duration.ofSeconds(timeoutSeconds))
                      .header("Authorization", "Bearer " + token)
                      .header("Content-Type", "application/json")
                      .POST(HttpRequest.BodyPublishers.ofString(json))
                      .build(),
                  HttpResponse.BodyHandlers.limiting(
                      HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8), 8192));
          return acknowledgement(response.statusCode(), json, response.body());
        };
  }

  HeartbeatTransport(Sender sender) {
    this.sender = sender;
    client = null;
  }

  static int acknowledgement(int code, String request, String response) {
    if (code != 202) return code == 200 ? 502 : code;
    try {
      var sent = JsonParser.parseString(request).getAsJsonObject();
      var ack = JsonParser.parseString(response).getAsJsonObject();
      if (!sent.get("messageId").getAsString().equals(ack.get("messageId").getAsString())
          || !ack.get("duplicate").getAsJsonPrimitive().isBoolean()) return 502;
      Instant.parse(ack.get("receivedAt").getAsString());
      return 202;
    } catch (RuntimeException invalid) {
      return 502;
    }
  }

  static URI endpoint(String value, boolean allowLocalHttp) {
    URI uri = URI.create(value);
    boolean localHttp =
        allowLocalHttp
            && "http".equals(uri.getScheme())
            && ("127.0.0.1".equals(uri.getHost()) || "[::1]".equals(uri.getHost()));
    if (!("https".equals(uri.getScheme()) || localHttp)
        || uri.getHost() == null
        || uri.getPort() == 0
        || uri.getPort() > 65535
        || uri.getUserInfo() != null
        || uri.getRawQuery() != null
        || uri.getFragment() != null
        || !"/api/v1/agents/heartbeat".equals(uri.getPath())) {
      throw new IllegalArgumentException("Invalid heartbeat endpoint");
    }
    return uri;
  }

  void start() {
    worker =
        Executors.newSingleThreadScheduledExecutor(
            task -> {
              Thread thread = new Thread(task, "vos-heartbeat");
              thread.setDaemon(true);
              return thread;
            });
    worker.scheduleWithFixedDelay(() -> tick(System.nanoTime()), 0, 250, TimeUnit.MILLISECONDS);
  }

  void offer(Heartbeat sample) {
    if (closed) return;
    if (pending.getAndSet(new Pending(sample, 0)) != null) dropped.incrementAndGet();
  }

  // Called only by the single worker. No Paper object or API is accessible here.
  void tick(long now) {
    if (closed || now < nextAttemptNanos) return;
    Pending current = pending.get();
    if (current == null) return;
    long started = System.nanoTime();
    int code = 0;
    try {
      code = sender.send(current.heartbeat().json());
    } catch (IOException | RuntimeException ignored) {
      // Never log the URL, headers, body, exception message or credential.
    } catch (InterruptedException interrupted) {
      Thread.currentThread().interrupt();
      return;
    }
    if (closed) return;
    if (code == 202) {
      pending.compareAndSet(current, null);
      sent.incrementAndGet();
      consecutiveFailures = 0;
      lastSuccess = Instant.now();
      state = "conectado";
      return;
    }
    failures.incrementAndGet();
    consecutiveFailures = Math.min(6, consecutiveFailures + 1);
    boolean permanent = code >= 400 && code < 500 && code != 408 && code != 429;
    state = permanent ? "rejeitado pela API" : "API indisponivel; reconectando";
    if (permanent || current.attempts() >= 2) {
      if (pending.compareAndSet(current, null)) dropped.incrementAndGet();
    } else {
      pending.compareAndSet(current, new Pending(current.heartbeat(), current.attempts() + 1));
    }
    long delay = permanent ? 60 : Math.min(60, 1L << consecutiveFailures);
    nextAttemptNanos =
        now
            + (System.nanoTime() - started)
            + TimeUnit.SECONDS.toNanos(delay)
            + ThreadLocalRandom.current().nextLong(TimeUnit.MILLISECONDS.toNanos(500));
  }

  String status() {
    return state
        + " | enviados="
        + sent.get()
        + " falhas="
        + failures.get()
        + " descartados="
        + dropped.get()
        + " pendentes="
        + (pending.get() == null ? 0 : 1)
        + " ultimoACK="
        + (lastSuccess == null ? "nenhum" : lastSuccess);
  }

  @Override
  public void close() {
    closed = true;
    pending.set(null);
    if (worker != null) worker.shutdownNow();
    if (client != null) client.shutdownNow();
  }
}
