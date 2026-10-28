// SPDX-License-Identifier: AGPL-3.0-only
package dev.vanillaonlinestats.plugin;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;

class CompatibilityTest {
    @Test void acceptsValidatedTargetOnly() {
        assertTrue(Compatibility.supports("26.3", "6.0.1-b2770"));
        assertFalse(Compatibility.supports("26.1", "6.0.1-b2770"));
        assertFalse(Compatibility.supports("26.3", "6.0.1-b2771"));
        assertFalse(Compatibility.supports("26.3", "6.0.0"));
        assertFalse(Compatibility.supports("26.3", "6.0.1-SNAPSHOT"));
        assertFalse(Compatibility.supports(null, null));
    }
}
