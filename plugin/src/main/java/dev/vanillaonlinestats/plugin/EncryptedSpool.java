// SPDX-License-Identifier: AGPL-3.0-only
package dev.vanillaonlinestats.plugin;

import com.google.gson.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import javax.crypto.*;
import javax.crypto.spec.*;

/** Optional bounded AES-GCM crash recovery. Key is independent of the agent token. */
final class EncryptedSpool implements AutoCloseable {
  private final ScheduledExecutorService worker =
      Executors.newSingleThreadScheduledExecutor(
          r -> {
            Thread t = new Thread(r, "vos-spool");
            t.setDaemon(true);
            return t;
          });
  private final SecretKeySpec key;
  private final Path file;
  private final Telemetry bus;
  private final int maxBytes;
  private final SecureRandom random = new SecureRandom();
  private volatile String state = "ativo";

  EncryptedSpool(Path directory, String encodedKey, Telemetry bus, int maxBytes) throws Exception {
    byte[] raw = Base64.getDecoder().decode(encodedKey);
    if (raw.length != 32) throw new IllegalArgumentException("Storage key must be 32 bytes");
    key = new SecretKeySpec(raw, "AES");
    Arrays.fill(raw, (byte) 0);
    this.bus = bus;
    this.maxBytes = maxBytes;
    file = directory.resolve("telemetry.spool.aes");
    if (Files.exists(file)) {
      if (Files.size(file) > maxBytes + 65536)
        throw new IllegalArgumentException("Spool exceeds limit");
      byte[] data = Files.readAllBytes(file);
      if (data.length < 28) throw new IllegalArgumentException("Invalid spool");
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, Arrays.copyOf(data, 12)));
      JsonArray entries =
          JsonParser.parseString(
                  new String(cipher.doFinal(data, 12, data.length - 12), StandardCharsets.UTF_8))
              .getAsJsonArray();
      for (JsonElement entry : entries) bus.restore(entry.getAsJsonObject());
    }
    worker.scheduleWithFixedDelay(this::flush, 2, 2, TimeUnit.SECONDS);
  }

  private void flush() {
    try {
      bus.expire(Instant.now().minusSeconds(300));
      JsonArray entries = new JsonArray();
      for (var entry : bus.batch(8192)) entries.add(JsonParser.parseString(entry.json()));
      byte[] plain = entries.toString().getBytes(StandardCharsets.UTF_8);
      if (plain.length > maxBytes + 32768) throw new IllegalStateException("size");
      byte[] iv = new byte[12];
      random.nextBytes(iv);
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(128, iv));
      byte[] encrypted = cipher.doFinal(plain);
      Arrays.fill(plain, (byte) 0);
      byte[] output = new byte[iv.length + encrypted.length];
      System.arraycopy(iv, 0, output, 0, iv.length);
      System.arraycopy(encrypted, 0, output, iv.length, encrypted.length);
      Path temporary = file.resolveSibling("telemetry.spool.tmp");
      Files.write(
          temporary, output, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
      try {
        Files.move(
            temporary, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
      } catch (AtomicMoveNotSupportedException unsupported) {
        Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING);
      }
      state = "ativo";
    } catch (Exception error) {
      state = "falha; fila somente em memoria";
    }
  }

  String status() {
    return state;
  }

  @Override
  public void close() {
    worker.execute(this::flush);
    worker.shutdown();
  }
}
