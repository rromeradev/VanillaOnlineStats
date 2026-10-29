// SPDX-License-Identifier: AGPL-3.0-only
package dev.vanillaonlinestats.plugin;

import com.google.gson.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.spec.X509EncodedKeySpec;
import java.time.Instant;
import java.util.*;

final class ControlSecurity {
  record Request(
      UUID actionId,
      UUID actorId,
      String role,
      String operation,
      String kind,
      JsonObject arguments,
      Instant expiresAt,
      String risk,
      boolean confirmed,
      UUID nonce,
      UUID auditId) {}

  private final PublicKey publicKey;
  private final UUID serverId, tenantId;

  ControlSecurity(String key, UUID serverId, String tenantId) throws GeneralSecurityException {
    this.publicKey =
        KeyFactory.getInstance("Ed25519")
            .generatePublic(new X509EncodedKeySpec(Base64.getDecoder().decode(key)));
    this.serverId = serverId;
    this.tenantId = UUID.fromString(tenantId);
  }

  Request verify(String wire, Instant now) throws GeneralSecurityException {
    if (wire.length() > 65536) throw new GeneralSecurityException("size");
    try {
      JsonObject wrapper = JsonParser.parseString(wire).getAsJsonObject();
      if (!wrapper.keySet().equals(Set.of("body", "signature")))
        throw new GeneralSecurityException("wrapper");
      byte[] body = Base64.getUrlDecoder().decode(wrapper.get("body").getAsString());
      if (body.length > 32768) throw new GeneralSecurityException("size");
      Signature signature = Signature.getInstance("Ed25519");
      signature.initVerify(publicKey);
      signature.update(body);
      if (!signature.verify(Base64.getUrlDecoder().decode(wrapper.get("signature").getAsString())))
        throw new GeneralSecurityException("signature");
      JsonObject value =
          JsonParser.parseString(new String(body, StandardCharsets.UTF_8)).getAsJsonObject();
      Set<String> fields =
          Set.of(
              "schemaVersion",
              "actionId",
              "actorId",
              "actorRole",
              "serverId",
              "tenantId",
              "operation",
              "kind",
              "arguments",
              "issuedAt",
              "expiresAt",
              "riskLevel",
              "confirmed",
              "nonce",
              "auditCorrelationId");
      if (!value.keySet().equals(fields) || !value.get("schemaVersion").toString().equals("1"))
        throw new GeneralSecurityException("schema");
      if (!serverId.equals(UUID.fromString(value.get("serverId").getAsString()))
          || !tenantId.equals(UUID.fromString(value.get("tenantId").getAsString())))
        throw new GeneralSecurityException("scope");
      Instant issued = Instant.parse(value.get("issuedAt").getAsString()),
          expires = Instant.parse(value.get("expiresAt").getAsString());
      if (issued.isAfter(now.plusSeconds(5))
          || issued.isBefore(now.minusSeconds(30))
          || !expires.isAfter(now)
          || expires.isAfter(issued.plusSeconds(30))
          || !expires.isAfter(issued)) throw new GeneralSecurityException("ttl");
      String role = value.get("actorRole").getAsString(),
          kind = value.get("kind").getAsString(),
          operation = value.get("operation").getAsString(),
          risk = value.get("riskLevel").getAsString();
      if (kind.equals("watch")) {
        var args = value.getAsJsonObject("arguments");
        if (!args.keySet().equals(Set.of("watchId", "query", "stop"))
            || !args.get("query").isJsonObject()
            || !args.get("stop").isJsonPrimitive()
            || !args.get("stop").getAsJsonPrimitive().isBoolean())
          throw new GeneralSecurityException("watch arguments");
        UUID.fromString(args.get("watchId").getAsString());
      }
      if (!Set.of("ADMIN", "OWNER").contains(role)
          && !(role.equals("PLAYER")
              && kind.equals("link")
              && Set.of("player.link.redeem", "player.authme.login").contains(operation))
          && !(role.equals("PLAYER")
              && (kind.equals("query") || kind.equals("watch"))
              && Set.of(
                      "player.snapshot",
                      "player.inventory",
                      "player.statistics",
                      "player.advancements")
                  .contains(operation)
              && value
                  .get("actorId")
                  .getAsString()
                  .equals(
                      (kind.equals("watch")
                              ? value.getAsJsonObject("arguments").getAsJsonObject("query")
                              : value.getAsJsonObject("arguments"))
                          .get("playerId")
                          .getAsString()))) throw new GeneralSecurityException("role");
      if (!Set.of("query", "action", "link", "watch").contains(kind)
          || !operation.matches("[a-z][a-z0-9.-]{1,63}")
          || !Set.of("LOW", "MEDIUM", "HIGH").contains(risk))
        throw new GeneralSecurityException("operation");
      if (!value.get("confirmed").getAsJsonPrimitive().isBoolean())
        throw new GeneralSecurityException("confirmation");
      if (kind.equals("watch")
          && (!LiveWatches.QUERIES.contains(operation)
              || !risk.equals("LOW")
              || value.get("confirmed").getAsBoolean()))
        throw new GeneralSecurityException("read-only watch");
      return new Request(
          UUID.fromString(value.get("actionId").getAsString()),
          UUID.fromString(value.get("actorId").getAsString()),
          role,
          operation,
          kind,
          value.getAsJsonObject("arguments").deepCopy(),
          expires,
          risk,
          value.get("confirmed").getAsBoolean(),
          UUID.fromString(value.get("nonce").getAsString()),
          UUID.fromString(value.get("auditCorrelationId").getAsString()));
    } catch (RuntimeException invalid) {
      throw new GeneralSecurityException("invalid request");
    }
  }
}
