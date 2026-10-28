// SPDX-License-Identifier: AGPL-3.0-only
package dev.vanillaonlinestats.plugin;

import static dev.vanillaonlinestats.plugin.Telemetry.object;

import com.google.gson.*;
import java.io.IOException;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.*;
import java.util.concurrent.*;

/** Bounded filesystem metadata only, on a separate worker, without following symlinks. */
final class HostMetrics implements AutoCloseable {
  private final ScheduledExecutorService worker =
      Executors.newSingleThreadScheduledExecutor(
          r -> {
            Thread t = new Thread(r, "vos-host-metrics");
            t.setDaemon(true);
            return t;
          });
  private volatile JsonObject latest = object("status", "not-collected");

  HostMetrics(Path root, Map<String, Path> worlds, boolean sizes, Telemetry bus) {
    worker.scheduleWithFixedDelay(
        () -> {
          try {
            var store = Files.getFileStore(root);
            JsonObject result =
                object(
                    "diskTotalBytes",
                    store.getTotalSpace(),
                    "diskUsableBytes",
                    store.getUsableSpace(),
                    "scope",
                    "filesystem-visible-to-process");
            if (sizes) {
              JsonArray estimates = new JsonArray();
              long deadline = System.nanoTime() + 200_000_000L;
              for (var world : worlds.entrySet()) {
                if (System.nanoTime() > deadline) break;
                long[] count = {0, 0};
                boolean[] partial = {false};
                if (!Files.isDirectory(world.getValue()) || Files.isSymbolicLink(world.getValue()))
                  continue;
                Files.walkFileTree(
                    world.getValue(),
                    EnumSet.noneOf(FileVisitOption.class),
                    8,
                    new SimpleFileVisitor<>() {
                      @Override
                      public FileVisitResult preVisitDirectory(
                          Path directory, BasicFileAttributes attrs) {
                        if (System.nanoTime() > deadline || count[0] >= 10000) {
                          partial[0] = true;
                          return FileVisitResult.TERMINATE;
                        }
                        return FileVisitResult.CONTINUE;
                      }

                      @Override
                      public FileVisitResult visitFile(Path path, BasicFileAttributes attrs) {
                        count[0]++;
                        if (attrs.isRegularFile()) count[1] += attrs.size();
                        if (System.nanoTime() > deadline || count[0] >= 10000) {
                          partial[0] = true;
                          return FileVisitResult.TERMINATE;
                        }
                        return FileVisitResult.CONTINUE;
                      }

                      @Override
                      public FileVisitResult visitFileFailed(Path file, IOException error) {
                        partial[0] = true;
                        return FileVisitResult.CONTINUE;
                      }
                    });
                estimates.add(
                    object(
                        "worldId",
                        world.getKey(),
                        "bytesObserved",
                        count[1],
                        "filesObserved",
                        count[0],
                        "partial",
                        partial[0]));
              }
              result.add("worldStorageSamples", estimates);
            }
            result.addProperty("observedAt", java.time.Instant.now().toString());
            latest = result;
            bus.emit("host.filesystem.snapshot", result, false);
          } catch (Exception unavailable) {
            latest = object("status", "unavailable");
          }
        },
        1,
        60,
        TimeUnit.SECONDS);
  }

  JsonObject snapshot() {
    return latest.deepCopy();
  }

  @Override
  public void close() {
    worker.shutdownNow();
  }
}
