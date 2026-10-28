// SPDX-License-Identifier: AGPL-3.0-only
package dev.vanillaonlinestats.plugin;

import com.google.gson.*;
import java.net.http.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;

final class BatchSender implements AutoCloseable {
  private final ScheduledExecutorService worker =
      Executors.newSingleThreadScheduledExecutor(
          r -> {
            Thread t = new Thread(r, "vos-batches");
            t.setDaemon(true);
            return t;
          });
  private final HttpClient client;
  private final Telemetry bus;
  private volatile String status = "desativado";
  private int failures;
  private long next;

  BatchSender(Settings settings, Telemetry bus, String token) {
    this.bus = bus;
    client =
        HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(settings.timeoutSeconds()))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();
    if (settings.telemetryEndpoint() == null) return;
    status = "aguardando";
    worker.scheduleWithFixedDelay(
        () -> {
          if (System.nanoTime() < next) return;
          try {
            bus.expire(Instant.now().minusSeconds(300));
            var batch = bus.batch(settings.batchMessages());
            if (batch.isEmpty()) return;
            JsonArray messages = new JsonArray();
            batch.forEach(e -> messages.add(JsonParser.parseString(e.json())));
            JsonObject body = new JsonObject();
            body.addProperty("schemaVersion", 1);
            body.add("messages", messages);
            var response =
                client.send(
                    HttpRequest.newBuilder(settings.telemetryEndpoint())
                        .timeout(Duration.ofSeconds(settings.timeoutSeconds()))
                        .header("Authorization", "Bearer " + token)
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString(body.toString()))
                        .build(),
                    HttpResponse.BodyHandlers.limiting(
                        HttpResponse.BodyHandlers.ofString(), 16384));
            if (response.statusCode() != 202) throw new IllegalStateException("rejected");
            JsonArray ack =
                JsonParser.parseString(response.body())
                    .getAsJsonObject()
                    .getAsJsonArray("acceptedMessageIds");
            Set<String> allowed = new HashSet<>();
            batch.forEach(e -> allowed.add(e.messageId()));
            Set<String> ids = new HashSet<>();
            for (JsonElement item : ack)
              if (allowed.contains(item.getAsString())) ids.add(item.getAsString());
            if (ids.isEmpty()) throw new IllegalStateException("ack");
            bus.acknowledge(ids);
            failures = 0;
            status = "conectado";
          } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
          } catch (Exception failure) {
            failures = Math.min(6, failures + 1);
            status = "indisponivel ou rejeitado";
            next =
                System.nanoTime()
                    + TimeUnit.SECONDS.toNanos(Math.min(60, 1L << failures))
                    + ThreadLocalRandom.current().nextLong(500_000_000L);
          }
        },
        1,
        1,
        TimeUnit.SECONDS);
  }

  String status() {
    return status + " " + bus.status();
  }

  @Override
  public void close() {
    worker.shutdownNow();
    client.shutdownNow();
  }
}
