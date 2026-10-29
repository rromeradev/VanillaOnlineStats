"""Paper release integration, using protocol fixtures rather than an application backend.
SPDX-License-Identifier: AGPL-3.0-only
"""
import argparse
import base64
import json
import os
import pathlib
import secrets
import shutil
import subprocess
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from websockets.sync.server import serve
from jsonschema import Draft202012Validator, FormatChecker

parser = argparse.ArgumentParser()
for name in ('java', 'paper', 'authme', 'skinsrestorer', 'plugin', 'output'):
    parser.add_argument('--' + name, required=True)
parser.add_argument('--accept-eula', action='store_true')
parser.add_argument('--cache')
args = parser.parse_args()
if not args.accept_eula:
    parser.error('Read Minecraft EULA, then pass --accept-eula')
root = pathlib.Path(args.output).resolve()
root.mkdir(parents=True, exist_ok=False)
(root / 'plugins/VanillaOnlineStats').mkdir(parents=True)
if args.cache:
    for folder in ('libraries', 'cache'):
        source = pathlib.Path(args.cache) / folder
        if source.is_dir():
            shutil.copytree(source, root / folder)
shutil.copyfile(args.paper, root / 'paper.jar')
shutil.copyfile(args.authme, root / 'plugins/AuthMe.jar')
shutil.copyfile(args.skinsrestorer, root / 'plugins/SkinsRestorer.jar')
shutil.copyfile(args.plugin, root / 'plugins/VanillaOnlineStats.jar')
server_id, tenant_id = str(uuid.uuid4()), str(uuid.uuid4())
token = secrets.token_urlsafe(32)
key = Ed25519PrivateKey.generate()
public_key = base64.b64encode(key.public_key().public_bytes(Encoding.DER, PublicFormat.SubjectPublicKeyInfo)).decode()
(root / 'plugins/VanillaOnlineStats/server-id.txt').write_text(server_id + '\n')
(root / 'plugins/VanillaOnlineStats/config.yml').write_text(f'''schema-version: 2
heartbeat:
  enabled: false
  allow-loopback-http: true
  timeout-seconds: 1
telemetry:
  endpoint: http://127.0.0.1:3011/api/v1/agents/telemetry/batches
collectors:
  period-seconds: 5
limits:
  queue-messages: 32
  queue-bytes: 131072
  collector-budget-micros: 20000
control:
  endpoint: ws://127.0.0.1:3012/api/v1/agents/control
  tenant-id: {tenant_id}
  public-key: {public_key}
  writes-enabled: true
  allowed-operations: [world.time, world.weather, world.difficulty, world.gamerule, world.border]
''')
(root / 'eula.txt').write_text('eula=true\n')
(root / 'server.properties').write_text('server-ip=127.0.0.1\nserver-port=25585\nview-distance=2\nsimulation-distance=2\nlevel-type=minecraft:flat\ngenerate-structures=false\n')
environment = os.environ.copy()
environment['VOS_AGENT_TOKEN'] = token
environment['VOS_STORAGE_KEY'] = base64.b64encode(secrets.token_bytes(32)).decode()
received, findings, responses = [], [], []
ready, finished = threading.Event(), threading.Event()
unavailable = threading.Event()
schema_path = pathlib.Path(__file__).resolve().parent.parent / 'packages/api-contracts/telemetry-envelope.schema.json'
validator = Draft202012Validator(json.loads(schema_path.read_text()), format_checker=FormatChecker())

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_POST(self):
        length = int(self.headers.get('Content-Length', '0'))
        if length > 1_000_000:
            self.send_error(413)
            return
        data = json.loads(self.rfile.read(length))
        if self.path != '/api/v1/agents/telemetry/batches' or self.headers.get('Authorization') != 'Bearer ' + token:
            self.send_error(401)
            return
        if unavailable.is_set():
            self.send_error(503)
            return
        for entry in data['messages']:
            validator.validate(entry)
            assert entry['serverId'] == server_id
            assert entry['schemaVersion'] == 1
            assert token not in json.dumps(entry)
            received.append(entry)
        response = json.dumps({'acceptedMessageIds': [entry['messageId'] for entry in data['messages']]}).encode()
        self.send_response(202)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(response)))
        self.end_headers()
        self.wfile.write(response)

def signed(operation, arguments=None, role='OWNER', kind='query', confirmed=False, risk='LOW'):
    now = time.time()
    stamp = lambda value: __import__('datetime').datetime.fromtimestamp(value, __import__('datetime').timezone.utc).isoformat().replace('+00:00', 'Z')
    body = {'schemaVersion': 1, 'actionId': str(uuid.uuid4()), 'actorId': str(uuid.uuid4()), 'actorRole': role,
        'serverId': server_id, 'tenantId': tenant_id, 'operation': operation, 'kind': kind, 'arguments': arguments or {},
        'issuedAt': stamp(now), 'expiresAt': stamp(now + 25), 'riskLevel': risk, 'confirmed': confirmed,
        'nonce': str(uuid.uuid4()), 'auditCorrelationId': str(uuid.uuid4())}
    raw = json.dumps(body, separators=(',', ':')).encode()
    encode = lambda value: base64.urlsafe_b64encode(value).decode().rstrip('=')
    return json.dumps({'body': encode(raw), 'signature': encode(key.sign(raw))})

def control(connection):
    try:
        hello = json.loads(connection.recv(timeout=120))
        assert hello['type'] == 'agent.capabilities'
        assert ready.wait(120), 'Paper did not finish startup'
        def request(operation, arguments=None, **options):
            wire = signed(operation, arguments, **options)
            connection.send(wire)
            result = json.loads(connection.recv(timeout=10))
            responses.append({'operation': operation, 'result': result})
            return result, wire
        result, _ = request('server.performance')
        assert result['state'] == 'SUCCEEDED', result
        assert 'msptP95' in result['payload']
        result, _ = request('worlds.list')
        world_id = result['payload']['items'][0]['worldId']
        result, _ = request('world.snapshot', {'worldId': world_id})
        assert result['state'] == 'SUCCEEDED', result
        assert 'seed' not in result['payload'] and 'spawn' not in result['payload']
        result, wire = request('world.time', {'worldId': world_id, 'value': 6000}, kind='action')
        assert result['state'] == 'SUCCEEDED', result
        connection.send(wire)
        assert json.loads(connection.recv(timeout=10))['state'] == 'REJECTED'
        result, _ = request('world.time', {'worldId': world_id, 'value': 100}, role='PLAYER', kind='action')
        assert result['type'] == 'control.rejected'
        result, _ = request('world.snapshot', {'worldId': world_id})
        assert 6000 <= result['payload']['time'] < 6200
        result, _ = request('world.border', {'worldId': world_id, 'size': 100}, kind='action')
        assert result['state'] == 'FAILED', 'Unconfirmed destructive action was accepted'
        result, _ = request('world.difficulty', {'worldId': world_id, 'value': 'HARD'}, kind='action')
        assert result['state'] == 'SUCCEEDED'
        result, _ = request('world.snapshot', {'worldId': world_id})
        assert result['payload']['difficulty'] == 'HARD'
        result, _ = request('server.console', {'command': 'stop'}, kind='action', confirmed=True, risk='HIGH')
        assert result['state'] == 'FAILED'
        result, _ = request('player.inventory', {'playerId': str(uuid.uuid4())})
        assert result['state'] == 'FAILED'
        deadline = time.time() + 40
        while not received and time.time() < deadline:
            time.sleep(.2)
        assert received, 'No authenticated telemetry batches received'
        unavailable.set()
        time.sleep(7)
        result, _ = request('server.performance')
        assert result['state'] == 'SUCCEEDED', 'Control/game tick stopped during telemetry outage'
        count = len(received)
        unavailable.clear()
        deadline = time.time() + 35
        while len(received) <= count and time.time() < deadline:
            time.sleep(.2)
        assert len(received) > count, 'Telemetry did not recover'
        findings.append('PASS: native collectors, authenticated batches, signed queries/actions, replay, PLAYER rejection, confirmations, privacy, outage/recovery')
    except Exception as error:
        findings.append('FAIL: ' + str(error))
    finally:
        finished.set()

http = ThreadingHTTPServer(('127.0.0.1', 3011), Handler)
threading.Thread(target=http.serve_forever, daemon=True).start()
websocket = serve(control, '127.0.0.1', 3012)
threading.Thread(target=websocket.serve_forever, daemon=True).start()
process = subprocess.Popen([args.java, '-Xms512M', '-Xmx2G', '-jar', 'paper.jar', '--nogui'], cwd=root, env=environment,
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace',
    creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
timer = threading.Timer(240, process.kill)
timer.start()
def stop_when_done():
    if finished.wait(230) and process.poll() is None:
        process.stdin.write('vos status\nvos collectors\nvos queue\nstop\n')
        process.stdin.flush()
threading.Thread(target=stop_when_done, daemon=True).start()
try:
    with (root / 'console.log').open('w', encoding='utf-8') as log:
        for line in process.stdout:
            log.write(line)
            log.flush()
            if 'Done (' in line:
                ready.set()
    code = process.wait(timeout=20)
finally:
    timer.cancel()
    if process.poll() is None:
        process.kill()
        process.wait()
    websocket.shutdown()
    http.shutdown()
log = (root / 'console.log').read_text(encoding='utf-8')
(root / 'control-responses.json').write_text(json.dumps(responses, indent=2), encoding='utf-8')
(root / 'results.txt').write_text('\n'.join(findings), encoding='utf-8')
assert code == 0, f'Paper failed: exit {code}'
assert findings and findings[0].startswith('PASS:'), findings
assert token not in log
assert (root / 'plugins/VanillaOnlineStats/control-audit.jsonl').exists()
assert (root / 'plugins/VanillaOnlineStats/telemetry.spool.aes').exists()
(root / 'telemetry.json').write_text(json.dumps(received, indent=2), encoding='utf-8')
(root / 'results.txt').write_text('\n'.join(findings), encoding='utf-8')
print(findings[0])
