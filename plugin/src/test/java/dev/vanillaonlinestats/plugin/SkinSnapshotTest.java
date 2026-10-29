// SPDX-License-Identifier: AGPL-3.0-only
package dev.vanillaonlinestats.plugin;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;

class SkinSnapshotTest {
  @Test
  void onlyExportsTextureHashesFromMinecraftHost() {
    var hash = "a".repeat(64);
    var skin =
        SkinSnapshot.fromUrl(
            "http://textures.minecraft.net/texture/" + hash, "slim", "paper-profile");
    assertEquals(hash, skin.get("textureHash").getAsString());
    assertEquals("slim", skin.get("model").getAsString());
    for (var url :
        new String[] {
          "https://evil.test/texture/" + hash,
          "http://127.0.0.1/texture/" + hash,
          "https://textures.minecraft.net/texture/../private",
          "https://textures.minecraft.net/texture/no-hash"
        }) assertFalse(SkinSnapshot.fromUrl(url, "classic", "paper-profile").has("textureHash"));
  }
}
