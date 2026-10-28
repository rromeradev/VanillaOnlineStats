// SPDX-License-Identifier: AGPL-3.0-only
package dev.vanillaonlinestats.plugin;

import static dev.vanillaonlinestats.plugin.Telemetry.object;

import com.google.gson.*;
import java.io.*;
import java.nio.*;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;

/** Durable at-most-once claims, shared by nonce and actionId. Never stores arguments. */
final class AuditLedger {
  private final Path path;
  private final Map<UUID, Instant> used = new HashMap<>();

  AuditLedger(Path directory) throws IOException {
    Files.createDirectories(directory);
    path = directory.resolve("control-audit.jsonl");
    for (Path file : List.of(directory.resolve("control-audit.previous.jsonl"), path)) {
      if (!Files.exists(file)) continue;
      if (Files.size(file) > 8_388_608) throw new IOException("Audit too large");
      try (var reader = Files.newBufferedReader(file)) {
        String line;
        while ((line = reader.readLine()) != null) {
          if (line.length() > 2048) throw new IOException("Invalid audit");
          try {
            JsonObject entry = JsonParser.parseString(line).getAsJsonObject();
            if (entry.get("state").getAsString().equals("PENDING")) {
              Instant expires = Instant.parse(entry.get("expiresAt").getAsString());
              if (expires.isAfter(Instant.now())) {
                used.put(UUID.fromString(entry.get("actionId").getAsString()), expires);
                used.put(UUID.fromString(entry.get("nonce").getAsString()), expires);
              }
            }
          } catch (RuntimeException invalid) {
            throw new IOException("Corrupt audit");
          }
        }
      }
    }
  }

  synchronized void claim(ControlSecurity.Request request, Instant now) throws IOException {
    used.values().removeIf(expiry -> !expiry.isAfter(now));
    if (used.containsKey(request.actionId())
        || used.containsKey(request.nonce())
        || used.size() >= 4096) throw new IOException("Replay or capacity");
    append(request, "PENDING");
    used.put(request.actionId(), request.expiresAt());
    used.put(request.nonce(), request.expiresAt());
  }

  synchronized void result(ControlSecurity.Request request, String state) throws IOException {
    append(request, state);
  }

  private void append(ControlSecurity.Request request, String state) throws IOException {
    if (Files.exists(path) && Files.size(path) > 8_000_000)
      Files.move(
          path,
          path.resolveSibling("control-audit.previous.jsonl"),
          StandardCopyOption.REPLACE_EXISTING);
    JsonObject entry =
        object(
            "actionId",
            request.actionId().toString(),
            "nonce",
            request.nonce().toString(),
            "actorId",
            request.actorId().toString(),
            "auditCorrelationId",
            request.auditId().toString(),
            "operation",
            request.operation(),
            "state",
            state,
            "at",
            Instant.now().toString(),
            "expiresAt",
            request.expiresAt().toString());
    byte[] data = (entry + "\n").getBytes(StandardCharsets.UTF_8);
    try (FileChannel channel =
        FileChannel.open(
            path, StandardOpenOption.CREATE, StandardOpenOption.WRITE, StandardOpenOption.APPEND)) {
      ByteBuffer buffer = ByteBuffer.wrap(data);
      while (buffer.hasRemaining()) channel.write(buffer);
      channel.force(true);
    }
  }
}
