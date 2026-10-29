// SPDX-License-Identifier: AGPL-3.0-only
package dev.vanillaonlinestats.plugin;

import com.google.gson.*;
import java.util.*;
import org.bukkit.profile.PlayerTextures;

final class SkinSnapshot {
  static JsonObject profile(PlayerTextures textures) {
    return fromUrl(
        textures.getSkin() == null ? null : textures.getSkin().toString(),
        textures.getSkinModel().name().equals("SLIM") ? "slim" : "classic",
        "paper-profile");
  }

  static JsonObject fromUrl(String url, String model, String source) {
    if (url == null) return Telemetry.object("source", "unavailable");
    try {
      var uri = java.net.URI.create(url);
      String path = uri.getPath();
      if (!"textures.minecraft.net".equalsIgnoreCase(uri.getHost())
          || !path.matches("/texture/[a-fA-F0-9]{32,64}"))
        return Telemetry.object("source", "unavailable");
      return Telemetry.object(
          "textureHash",
          path.substring(9).toLowerCase(Locale.ROOT),
          "model",
          model,
          "source",
          source);
    } catch (RuntimeException e) {
      return Telemetry.object("source", "unavailable");
    }
  }

  // Worker-only API lookup for offline logins. Online snapshots use the actual applied
  // Paper profile, including temporary skins applied by SkinsRestorer or a proxy.
  static JsonObject stored(org.bukkit.plugin.Plugin plugin, UUID uuid) {
    try {
      var api = net.skinsrestorer.api.SkinsRestorerProvider.get();
      var result = api.getPlayerStorage().getSkinOfPlayer(uuid);
      if (result.isEmpty()) return Telemetry.object("source", "unavailable");
      String encoded = result.get().getValue();
      if (encoded.length() > 16384) return Telemetry.object("source", "unavailable");
      var skin =
          JsonParser.parseString(
                  new String(
                      Base64.getDecoder().decode(encoded), java.nio.charset.StandardCharsets.UTF_8))
              .getAsJsonObject()
              .getAsJsonObject("textures")
              .getAsJsonObject("SKIN");
      String model =
          skin.has("metadata") && skin.getAsJsonObject("metadata").has("model")
              ? skin.getAsJsonObject("metadata").get("model").getAsString()
              : "classic";
      return fromUrl(
          skin.get("url").getAsString(),
          "slim".equals(model) ? "slim" : "classic",
          "skinsrestorer");
    } catch (Exception | LinkageError unavailable) {
      return Telemetry.object("source", "unavailable");
    }
  }
}
