// SPDX-License-Identifier: AGPL-3.0-only
package dev.vanillaonlinestats.plugin;

import com.google.gson.*;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;

/** No Bukkit objects, passwords or unbounded payloads cross the network boundary. */
final class Telemetry {
  private static final Gson GSON = new Gson();

  record Entry(
      String messageId, String type, String json, int bytes, boolean event, Instant occurredAt) {}

  private final UUID serverId;
  private final int maxMessages, maxBytes;
  private final ArrayDeque<Entry> queue = new ArrayDeque<>();
  private final Map<String, JsonObject> latest = new LinkedHashMap<>();
  private int bytes;
  private long dropped, accepted, sent;

  Telemetry(UUID serverId, int maxMessages, int maxBytes) {
    this.serverId = serverId;
    this.maxMessages = maxMessages;
    this.maxBytes = maxBytes;
  }

  synchronized boolean emit(String type, JsonObject payload, boolean event) {
    JsonObject envelope = new JsonObject();
    envelope.addProperty("schemaVersion", 1);
    String id = UUID.randomUUID().toString(), now = Instant.now().toString();
    envelope.addProperty("messageId", id);
    envelope.addProperty("serverId", serverId.toString());
    envelope.addProperty("type", type);
    envelope.addProperty(
        "source",
        type.startsWith("auth.")
            ? "authme-api"
            : type.startsWith("host.")
                ? "jvm-filesystem"
                : type.equals("server.performance.snapshot")
                    ? "paper-api+jvm"
                    : type.equals("events.counters") ? "derived" : "paper-api");
    envelope.addProperty("occurredAt", now);
    envelope.addProperty("sentAt", now);
    envelope.add("payload", payload.deepCopy());
    String json = envelope.toString();
    int size = json.getBytes(StandardCharsets.UTF_8).length;
    if (size > 65536 || size > maxBytes) {
      dropped++;
      return false;
    }
    if (!event) {
      for (Iterator<Entry> it = queue.iterator(); it.hasNext(); ) {
        Entry entry = it.next();
        if (!entry.event && entry.type.equals(type)) {
          bytes -= entry.bytes;
          it.remove();
          dropped++;
        }
      }
      latest.put(type, envelope.deepCopy());
      while (latest.size() > 32) latest.remove(latest.keySet().iterator().next());
    }
    while (!queue.isEmpty() && (queue.size() >= maxMessages || bytes + size > maxBytes)) {
      Entry oldest = queue.removeFirst();
      bytes -= oldest.bytes;
      dropped++;
    }
    queue.addLast(new Entry(id, type, json, size, event, Instant.parse(now)));
    bytes += size;
    accepted++;
    return true;
  }

  synchronized List<Entry> batch(int max) {
    return queue.stream().limit(max).toList();
  }

  synchronized void restore(JsonObject envelope) {
    if (!serverId.toString().equals(envelope.get("serverId").getAsString()))
      throw new IllegalArgumentException("Spool scope");
    Instant occurred = Instant.parse(envelope.get("occurredAt").getAsString());
    if (occurred.isBefore(Instant.now().minusSeconds(300))
        || occurred.isAfter(Instant.now().plusSeconds(120))) return;
    String json = envelope.toString();
    int size = json.getBytes(StandardCharsets.UTF_8).length;
    if (size > 65536 || queue.size() >= maxMessages || bytes + size > maxBytes) {
      dropped++;
      return;
    }
    queue.addLast(
        new Entry(
            envelope.get("messageId").getAsString(),
            envelope.get("type").getAsString(),
            json,
            size,
            true,
            occurred));
    bytes += size;
  }

  synchronized void acknowledge(Set<String> ids) {
    for (Iterator<Entry> it = queue.iterator(); it.hasNext(); ) {
      Entry entry = it.next();
      if (ids.contains(entry.messageId)) {
        it.remove();
        bytes -= entry.bytes;
        sent++;
      }
    }
  }

  synchronized void expire(Instant cutoff) {
    for (Iterator<Entry> it = queue.iterator(); it.hasNext(); ) {
      Entry entry = it.next();
      if (entry.occurredAt.isBefore(cutoff)) {
        it.remove();
        bytes -= entry.bytes;
        dropped++;
      }
    }
  }

  synchronized JsonObject status() {
    JsonObject result = new JsonObject();
    result.addProperty("pending", queue.size());
    result.addProperty("bytes", bytes);
    result.addProperty("accepted", accepted);
    result.addProperty("sent", sent);
    result.addProperty("dropped", dropped);
    return result;
  }

  synchronized JsonObject snapshot() {
    JsonObject result = new JsonObject();
    latest.forEach((k, v) -> result.add(k, v.deepCopy()));
    return result;
  }

  static JsonObject object(Object... pairs) {
    JsonObject result = new JsonObject();
    for (int i = 0; i < pairs.length; i += 2)
      result.add(pairs[i].toString(), GSON.toJsonTree(pairs[i + 1]));
    return result;
  }
}
