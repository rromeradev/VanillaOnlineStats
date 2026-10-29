// SPDX-License-Identifier: AGPL-3.0-only
package dev.vanillaonlinestats.plugin;

import static org.junit.jupiter.api.Assertions.*;

import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.util.Base64;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;

class SkinImageTest {
  private String png(int width, int height) throws Exception {
    var stream = new ByteArrayOutputStream();
    ImageIO.write(new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB), "png", stream);
    return Base64.getEncoder().encodeToString(stream.toByteArray());
  }

  @Test
  void acceptsActualClassicAndLegacyPngAndRejectsMalformedOrOversizedImages() throws Exception {
    assertEquals(64, SkinImage.decode(png(64, 64)).getHeight());
    assertEquals(32, SkinImage.decode(png(64, 32)).getHeight());
    assertThrows(Exception.class, () -> SkinImage.decode(png(128, 128)));
    assertThrows(Exception.class, () -> SkinImage.decode("A".repeat(28000)));
    assertThrows(Exception.class, () -> SkinImage.decode("not-a-png"));
    byte[] forged = new byte[33];
    System.arraycopy(java.util.HexFormat.of().parseHex("89504e470d0a1a0a"), 0, forged, 0, 8);
    java.nio.ByteBuffer.wrap(forged, 16, 4).putInt(64);
    java.nio.ByteBuffer.wrap(forged, 20, 4).putInt(64);
    assertThrows(
        Exception.class, () -> SkinImage.decode(Base64.getEncoder().encodeToString(forged)));
  }
}
