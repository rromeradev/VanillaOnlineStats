// SPDX-License-Identifier: AGPL-3.0-only
package dev.vanillaonlinestats.plugin;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.UUID;

final class InstallationIdentity {
  static UUID load(Path directory) throws IOException {
    Files.createDirectories(directory);
    Path file = directory.resolve("server-id.txt");
    if (!Files.exists(file)) {
      Files.writeString(file, UUID.randomUUID() + "\n", StandardOpenOption.CREATE_NEW);
    }
    // A malformed identity is never silently replaced: that would break agent binding.
    return UUID.fromString(Files.readString(file).trim());
  }
}
