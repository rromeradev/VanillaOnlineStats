// SPDX-License-Identifier: AGPL-3.0-only
package dev.vanillaonlinestats.plugin;

import com.google.gson.Gson;
import java.time.Instant;
import java.util.UUID;

record Heartbeat(int schemaVersion, String messageId, String serverId, String sentAt,
        String occurredAt, String type, String source, Payload payload) {
    record Payload(String pluginVersion, String minecraftVersion, String paperVersion, String authMeVersion,
            long uptimeSeconds, int playersOnline) {}

    static Heartbeat sample(UUID serverId, String plugin, String minecraft, String paper, String authMe,
            long uptimeSeconds, int playersOnline) {
        String now = Instant.now().toString();
        return new Heartbeat(1, UUID.randomUUID().toString(), serverId.toString(), now, now,
                "server.heartbeat", "paper-api",
                new Payload(plugin, minecraft, paper, authMe, uptimeSeconds, playersOnline));
    }

    String json() { return new Gson().toJson(this); }
}
