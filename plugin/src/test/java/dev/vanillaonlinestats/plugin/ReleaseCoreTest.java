// SPDX-License-Identifier: AGPL-3.0-only
package dev.vanillaonlinestats.plugin;

import static org.junit.jupiter.api.Assertions.*;

import com.google.gson.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.*;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;

class ReleaseCoreTest {
  @TempDir Path directory;
  private final UUID server = UUID.randomUUID(), tenant = UUID.randomUUID();
  private final KeyPair keys;

  ReleaseCoreTest() throws Exception {
    keys = KeyPairGenerator.getInstance("Ed25519").generateKeyPair();
  }

  JsonObject body() {
    return Telemetry.object(
        "schemaVersion",
        1,
        "actionId",
        UUID.randomUUID().toString(),
        "actorId",
        UUID.randomUUID().toString(),
        "actorRole",
        "OWNER",
        "serverId",
        server.toString(),
        "tenantId",
        tenant.toString(),
        "operation",
        "world.time",
        "kind",
        "action",
        "arguments",
        Telemetry.object("value", 6000),
        "issuedAt",
        Instant.now().minusSeconds(1).toString(),
        "expiresAt",
        Instant.now().plusSeconds(20).toString(),
        "riskLevel",
        "LOW",
        "confirmed",
        false,
        "nonce",
        UUID.randomUUID().toString(),
        "auditCorrelationId",
        UUID.randomUUID().toString());
  }

  String sign(JsonObject body) throws Exception {
    byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
    Signature signer = Signature.getInstance("Ed25519");
    signer.initSign(keys.getPrivate());
    signer.update(bytes);
    return Telemetry.object(
            "body",
            Base64.getUrlEncoder().withoutPadding().encodeToString(bytes),
            "signature",
            Base64.getUrlEncoder().withoutPadding().encodeToString(signer.sign()))
        .toString();
  }

  ControlSecurity verifier() throws Exception {
    return new ControlSecurity(
        Base64.getEncoder().encodeToString(keys.getPublic().getEncoded()),
        server,
        tenant.toString());
  }

  @Test
  void rejectsForgedExpiredCrossTenantCrossServerAndPlayerControl() throws Exception {
    ControlSecurity security = verifier();
    JsonObject valid = body();
    assertEquals("world.time", security.verify(sign(valid), Instant.now()).operation());
    for (String field : List.of("serverId", "tenantId", "actorRole", "expiresAt")) {
      JsonObject bad = valid.deepCopy();
      bad.addProperty(
          field,
          switch (field) {
            case "actorRole" -> "PLAYER";
            case "expiresAt" -> Instant.now().minusSeconds(1).toString();
            default -> UUID.randomUUID().toString();
          });
      assertThrows(GeneralSecurityException.class, () -> security.verify(sign(bad), Instant.now()));
    }
    JsonObject wire = JsonParser.parseString(sign(valid)).getAsJsonObject();
    wire.addProperty("signature", Base64.getUrlEncoder().encodeToString(new byte[64]));
    assertThrows(
        GeneralSecurityException.class, () -> security.verify(wire.toString(), Instant.now()));
    valid.addProperty("actorRole", "PLAYER");
    valid.addProperty("kind", "link");
    valid.addProperty("operation", "player.link.redeem");
    assertEquals("PLAYER", security.verify(sign(valid), Instant.now()).role());
  }

  @Test
  void auditClaimsSurviveRestartAndNeverPersistArguments() throws Exception {
    JsonObject body = body();
    body.getAsJsonObject("arguments").addProperty("password", "NEVER_PERSIST");
    var request = verifier().verify(sign(body), Instant.now());
    AuditLedger ledger = new AuditLedger(directory);
    ledger.claim(request, Instant.now());
    ledger.result(request, "SUCCEEDED");
    assertThrows(
        java.io.IOException.class, () -> new AuditLedger(directory).claim(request, Instant.now()));
    assertFalse(
        Files.readString(directory.resolve("control-audit.jsonl")).contains("NEVER_PERSIST"));
    assertFalse(Files.readString(directory.resolve("control-audit.jsonl")).contains("arguments"));
  }

  @Test
  void nonceReplayWithNewActionIdIsRejected() throws Exception {
    JsonObject body = body();
    AuditLedger ledger = new AuditLedger(directory);
    ledger.claim(verifier().verify(sign(body), Instant.now()), Instant.now());
    body.addProperty("actionId", UUID.randomUUID().toString());
    var replay = verifier().verify(sign(body), Instant.now());
    assertThrows(java.io.IOException.class, () -> ledger.claim(replay, Instant.now()));
  }

  @Test
  void queueBoundsCoalescingAcknowledgementAndExpiry() {
    Telemetry bus = new Telemetry(server, 3, 2048);
    for (int i = 0; i < 100; i++) bus.emit("event.test", Telemetry.object("i", i), true);
    assertTrue(bus.status().get("pending").getAsInt() <= 3);
    assertTrue(bus.status().get("bytes").getAsInt() <= 2048);
    bus.emit("snapshot.test", Telemetry.object("i", 1), false);
    bus.emit("snapshot.test", Telemetry.object("i", 2), false);
    assertEquals(1, bus.batch(100).stream().filter(e -> e.type().equals("snapshot.test")).count());
    var id = bus.batch(1).getFirst().messageId();
    bus.acknowledge(Set.of(id));
    assertFalse(bus.batch(100).stream().anyMatch(e -> e.messageId().equals(id)));
    bus.expire(Instant.now().plusSeconds(1));
    assertEquals(0, bus.status().get("pending").getAsInt());
  }

  @Test
  void linkCodesExpireAreSingleUseAndRevocable() {
    LinkCodes codes = new LinkCodes();
    UUID player = UUID.randomUUID();
    Instant now = Instant.now();
    String code = codes.issue(player, now);
    assertEquals(player, codes.redeem(code, now));
    assertNull(codes.redeem(code, now));
    code = codes.issue(player, now);
    assertNull(codes.redeem(code, now.plusSeconds(121)));
    code = codes.issue(player, now);
    codes.revoke(player);
    assertNull(codes.redeem(code, now));
  }

  @Test
  void encryptedSpoolRestoresOnlyWithCorrectKey() throws Exception {
    byte[] key = new byte[32];
    new SecureRandom().nextBytes(key);
    String encoded = Base64.getEncoder().encodeToString(key);
    Telemetry bus = new Telemetry(server, 16, 65536);
    bus.emit("event.test", Telemetry.object("private", "not-in-plaintext"), true);
    EncryptedSpool spool = new EncryptedSpool(directory, encoded, bus, 65536);
    spool.close();
    Path file = directory.resolve("telemetry.spool.aes");
    long end = System.nanoTime() + 3_000_000_000L;
    while (!Files.exists(file) && System.nanoTime() < end) Thread.sleep(20);
    assertTrue(Files.exists(file));
    assertFalse(
        new String(Files.readAllBytes(file), StandardCharsets.ISO_8859_1)
            .contains("not-in-plaintext"));
    Telemetry restored = new Telemetry(server, 16, 65536);
    var reader = new EncryptedSpool(directory, encoded, restored, 65536);
    reader.close();
    assertEquals(1, restored.status().get("pending").getAsInt());
    assertThrows(
        Exception.class,
        () ->
            new EncryptedSpool(
                directory,
                Base64.getEncoder().encodeToString(new byte[32]),
                new Telemetry(server, 16, 65536),
                65536));
  }
}
