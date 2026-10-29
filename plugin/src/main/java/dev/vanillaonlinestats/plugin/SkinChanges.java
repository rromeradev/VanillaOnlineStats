// SPDX-License-Identifier: AGPL-3.0-only
package dev.vanillaonlinestats.plugin;

import com.google.gson.JsonObject;
import java.util.*;
import java.util.concurrent.TimeUnit;
import net.skinsrestorer.api.SkinsRestorerProvider;
import net.skinsrestorer.api.property.SkinIdentifier;
import net.skinsrestorer.api.property.SkinProperty;
import net.skinsrestorer.api.property.SkinVariant;
import org.bukkit.plugin.java.JavaPlugin;

final class SkinChanges {
  // Runs on a dedicated worker. Storage and MineSkin requests must never block Paper's tick.
  static JsonObject apply(JavaPlugin plugin, AuthMeBridge auth, ControlSecurity.Request request)
      throws Exception {
    if (!request.kind().equals("skin")
        || !request.role().equals("PLAYER")
        || !request.operation().equals("player.skin.set")
        || !request.confirmed()
        || !request.expiresAt().isAfter(java.time.Instant.now()))
      throw new ControlFailure("SKIN_REQUEST_INVALID");
    var args = request.arguments();
    var api = SkinsRestorerProvider.get();
    SkinProperty property;
    if (args.keySet().equals(Set.of("value", "signature"))) {
      String value = args.get("value").getAsString(),
          signature = args.get("signature").getAsString();
      if (value.length() > 4096 || signature.length() > 2048)
        throw new ControlFailure("SKIN_REQUEST_INVALID");
      property = SkinProperty.of(value, signature);
    } else if (args.keySet().equals(Set.of("png", "model"))) {
      String model = args.get("model").getAsString();
      if (!Set.of("classic", "slim").contains(model))
        throw new ControlFailure("SKIN_REQUEST_INVALID");
      java.awt.image.BufferedImage image;
      try {
        image = SkinImage.decode(args.get("png").getAsString());
      } catch (Exception invalid) {
        throw new ControlFailure("SKIN_INVALID_PNG");
      }
      try {
        property =
            api.getMineSkinAPI()
                .genSkin(image, model.equals("slim") ? SkinVariant.SLIM : SkinVariant.CLASSIC)
                .getProperty();
      } catch (Exception unavailable) {
        throw new ControlFailure("SKIN_GENERATION_FAILED");
      }
    } else throw new ControlFailure("SKIN_REQUEST_INVALID");
    String key = "vos-" + request.actionId();
    api.getSkinStorage().setCustomSkinData(key, property);
    api.getPlayerStorage().setSkinIdOfPlayer(request.actorId(), SkinIdentifier.ofCustom(key));
    // A saved choice survives an offline player or a failed live refresh.
    String application;
    try {
      application =
          plugin
              .getServer()
              .getScheduler()
              .callSyncMethod(
                  plugin,
                  () -> {
                    var player = plugin.getServer().getPlayer(request.actorId());
                    if (player == null || !auth.authenticated(player)) return "next-login";
                    try {
                      api.getSkinApplier(org.bukkit.entity.Player.class)
                          .applySkin(player, property);
                      return "applied";
                    } catch (Exception unavailable) {
                      return "next-login";
                    }
                  })
              .get(5, TimeUnit.SECONDS);
    } catch (Exception unavailable) {
      application = "next-login";
    }
    return Telemetry.object(
        "saved",
        true,
        "application",
        application,
        "skin",
        SkinSnapshot.stored(plugin, request.actorId()));
  }
}
