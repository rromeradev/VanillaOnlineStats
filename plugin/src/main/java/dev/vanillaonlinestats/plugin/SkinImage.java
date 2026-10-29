// SPDX-License-Identifier: AGPL-3.0-only
package dev.vanillaonlinestats.plugin;

import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.util.*;
import javax.imageio.ImageIO;

final class SkinImage {
  static BufferedImage decode(String encoded) throws Exception {
    if (encoded.length() > 27308) throw new IllegalArgumentException("skin size");
    byte[] bytes = Base64.getDecoder().decode(encoded);
    if (bytes.length < 33
        || bytes.length > 20480
        || !Arrays.equals(
            Arrays.copyOf(bytes, 8), java.util.HexFormat.of().parseHex("89504e470d0a1a0a"))
        || java.nio.ByteBuffer.wrap(bytes, 16, 4).getInt() != 64
        || !Set.of(32, 64).contains(java.nio.ByteBuffer.wrap(bytes, 20, 4).getInt()))
      throw new IllegalArgumentException("skin dimensions");
    var image = ImageIO.read(new ByteArrayInputStream(bytes));
    if (image == null || image.getWidth() != 64 || !Set.of(32, 64).contains(image.getHeight()))
      throw new IllegalArgumentException("invalid skin PNG");
    return image;
  }
}
