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


class WatchContractTest(unittest.TestCase):
    def test_read_only_watch_contract(self):
        schema = json.loads((ROOT / "control-body.schema.json").read_text())
        Draft202012Validator.check_schema(schema)
        validator = Draft202012Validator(schema, format_checker=FormatChecker())
        uid = "11111111-1111-4111-8111-111111111111"
        value = dict(schemaVersion=1, actionId=uid, actorId=uid, actorRole="PLAYER", serverId=uid,
                     tenantId=uid, operation="player.inventory", kind="watch",
                     arguments=dict(watchId=uid, query=dict(playerId=uid), stop=False),
                     issuedAt="2026-10-29T00:00:00Z", expiresAt="2026-10-29T00:00:25Z",
                     riskLevel="LOW", confirmed=False, nonce=uid, auditCorrelationId=uid)
        validator.validate(value)
        for key, invalid in [("operation", "server.broadcast"), ("riskLevel", "HIGH"), ("confirmed", True)]:
            case = copy.deepcopy(value)
            case[key] = invalid
            self.assertFalse(validator.is_valid(case))
        case = copy.deepcopy(value)
        case["arguments"]["watchId"] = "invalid"
        self.assertFalse(validator.is_valid(case))


class SkinContractTest(unittest.TestCase):
    def test_only_confirmed_self_skin_mutation_is_allowed(self):
        schema = json.loads((ROOT / "control-body.schema.json").read_text())
        validator = Draft202012Validator(schema, format_checker=FormatChecker())
        uid = "11111111-1111-4111-8111-111111111111"
        value = dict(schemaVersion=1, actionId=uid, actorId=uid, actorRole="PLAYER", serverId=uid,
                     tenantId=uid, operation="player.skin.set", kind="skin",
                     arguments=dict(png="cG5n", model="slim"), issuedAt="2026-10-29T00:00:00Z",
                     expiresAt="2026-10-29T00:00:25Z", riskLevel="MEDIUM", confirmed=True,
                     nonce=uid, auditCorrelationId=uid)
        validator.validate(value)
        for key, invalid in [("actorRole", "ADMIN"), ("confirmed", False), ("operation", "server.broadcast")]:
            case = copy.deepcopy(value)
            case[key] = invalid
            self.assertFalse(validator.is_valid(case))
        case = copy.deepcopy(value)
        case["arguments"]["playerId"] = uid
        self.assertFalse(validator.is_valid(case))


if __name__ == "__main__":
    unittest.main()
