// SPDX-License-Identifier: AGPL-3.0-only
package dev.vanillaonlinestats.plugin;

import java.nio.charset.StandardCharsets;
import java.security.*;
import java.time.*;
import java.util.*;

/** Only authenticated in-game players can issue a code; never persisted or logged. */
final class LinkCodes {
  private record Code(UUID player, Instant expires) {}

  private final Map<String, Code> codes = new HashMap<>();
  private final SecureRandom random = new SecureRandom();

  synchronized String issue(UUID player, Instant now) {
    expire(now);
    revoke(player);
    if (codes.size() >= 1024) throw new IllegalStateException("Too many pending links");
    byte[] bytes = new byte[16];
    random.nextBytes(bytes);
    String code = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    codes.put(hash(code), new Code(player, now.plusSeconds(120)));
    return code;
  }

  synchronized UUID redeem(String value, Instant now) {
    expire(now);
    Code code = codes.remove(hash(value));
    return code == null ? null : code.player;
  }

  synchronized void revoke(UUID player) {
    codes.values().removeIf(c -> c.player.equals(player));
  }

  synchronized void clear() {
    codes.clear();
  }

  private void expire(Instant now) {
    codes.values().removeIf(c -> !c.expires.isAfter(now));
  }

  private String hash(String value) {
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException error) {
      throw new IllegalStateException(error);
    }
  }
}
