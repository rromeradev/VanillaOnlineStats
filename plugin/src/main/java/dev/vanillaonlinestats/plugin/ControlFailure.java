// SPDX-License-Identifier: AGPL-3.0-only
package dev.vanillaonlinestats.plugin;

final class ControlFailure extends IllegalArgumentException {
  final String code;

  ControlFailure(String code) {
    super(code);
    this.code = code;
  }
}
