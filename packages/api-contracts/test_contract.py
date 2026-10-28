"""SPDX-License-Identifier: AGPL-3.0-only"""
import copy
import json
import pathlib
import unittest
from jsonschema import Draft202012Validator, FormatChecker

ROOT = pathlib.Path(__file__).parent
SCHEMA = json.loads((ROOT / "heartbeat.schema.json").read_text())
EXAMPLE = json.loads((ROOT / "examples/heartbeat.v1.json").read_text())
VALIDATOR = Draft202012Validator(SCHEMA, format_checker=FormatChecker())


class ContractTest(unittest.TestCase):
    def test_example(self):
        Draft202012Validator.check_schema(SCHEMA)
        VALIDATOR.validate(EXAMPLE)

    def test_rejects_invalid_envelopes(self):
        cases = [
            ("schemaVersion", 2), ("messageId", "invalid"),
            ("sentAt", "yesterday"), ("type", "admin.command"),
            ("tenantId", "browser-controlled"),
        ]
        for key, value in cases:
            with self.subTest(key=key):
                data = copy.deepcopy(EXAMPLE)
                data[key] = value
                self.assertFalse(VALIDATOR.is_valid(data))

    def test_rejects_payload_secrets_and_invalid_counts(self):
        for key, value in [("password", "secret"), ("playersOnline", -1), ("uptimeSeconds", 0.5)]:
            data = copy.deepcopy(EXAMPLE)
            data["payload"][key] = value
            self.assertFalse(VALIDATOR.is_valid(data))
        for key in EXAMPLE:
            data = copy.deepcopy(EXAMPLE)
            del data[key]
            self.assertFalse(VALIDATOR.is_valid(data))


if __name__ == "__main__":
    unittest.main()
