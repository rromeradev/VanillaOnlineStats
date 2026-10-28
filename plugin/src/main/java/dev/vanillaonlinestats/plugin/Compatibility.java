// SPDX-License-Identifier: AGPL-3.0-only
package dev.vanillaonlinestats.plugin;

final class Compatibility {
    private Compatibility() {}

    static boolean supports(String minecraft, String authMe) {
        return "26.3".equals(minecraft) && "6.0.1-b2770".equals(authMe);
    }
}
