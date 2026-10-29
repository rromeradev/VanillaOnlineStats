"""Run isolated Paper bootstrap checks. SPDX-License-Identifier: AGPL-3.0-only"""
import argparse
import pathlib
import shutil
import subprocess
import threading
import time
import uuid
import secrets
import hashlib
import os
import urllib.request
import re

parser = argparse.ArgumentParser()
parser.add_argument("--java", required=True)
parser.add_argument("--paper", required=True)
parser.add_argument("--authme", required=True)
parser.add_argument("--skinsrestorer", required=True)
parser.add_argument("--plugin", required=True)
parser.add_argument("--output", required=True)
parser.add_argument("--accept-eula", action="store_true")
parser.add_argument("--heartbeat", action="store_true", help="Test actual Nest API outage and recovery")
parser.add_argument("--node", default="node")
args = parser.parse_args()
if not args.accept_eula:
    parser.error("Read https://aka.ms/MinecraftEULA and pass --accept-eula to run a test server")

for with_authme, with_skins in ((True, True), (False, True), (True, False)):
    root = pathlib.Path(args.output).resolve() / ("without-skinsrestorer" if not with_skins else "with-authme" if with_authme else "without-authme")
    root.mkdir(parents=True, exist_ok=False)
    (root / "plugins").mkdir()
    shutil.copyfile(args.paper, root / "paper.jar")
    if with_skins:
        shutil.copyfile(args.skinsrestorer, root / "plugins/SkinsRestorer.jar")
    shutil.copyfile(args.plugin, root / "plugins/VanillaOnlineStats.jar")
    if with_authme:
        shutil.copyfile(args.authme, root / "plugins/AuthMe.jar")
    api = None
    environment = os.environ.copy()
    api_log = (root / "api.log").open("w", encoding="utf-8")
    if with_authme and with_skins and args.heartbeat:
        server_id = str(uuid.uuid4())
        token = secrets.token_urlsafe(32)
        environment.update(VOS_LEGACY_MODE='1', VOS_AGENT_TOKEN=token, VOS_AGENT_SERVER_ID=server_id,
            VOS_TENANT_ID=str(uuid.uuid4()),
            VOS_AGENT_TOKEN_SHA256=hashlib.sha256(token.encode()).hexdigest(), PORT="3009", HOST="127.0.0.1")
        config = root / "plugins/VanillaOnlineStats"
        config.mkdir()
        (config / "server-id.txt").write_text(server_id + "\n")
        (config / "config.yml").write_text("schema-version: 1\nheartbeat:\n  enabled: true\n"
            "  endpoint: http://127.0.0.1:3009/api/v1/agents/heartbeat\n"
            "  interval-seconds: 5\n  timeout-seconds: 1\n  allow-loopback-http: true\n")

        def start_api():
            instance = subprocess.Popen([args.node, "apps/api/dist/main.js"],
                cwd=pathlib.Path(__file__).resolve().parent.parent, env=environment,
                stdout=api_log, stderr=subprocess.STDOUT,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            for _ in range(100):
                if instance.poll() is not None:
                    raise AssertionError("API failed to start; inspect api.log")
                try:
                    with urllib.request.urlopen("http://127.0.0.1:3009/api/v1/health", timeout=1) as response:
                        if response.status == 200:
                            return instance
                except OSError:
                    time.sleep(0.1)
            instance.kill()
            instance.wait()
            raise AssertionError("API startup timeout")
        api = start_api()
    (root / "eula.txt").write_text("eula=true\n")
    (root / "server.properties").write_text(
        "server-ip=127.0.0.1\nserver-port=25585\nonline-mode=true\n"
        "view-distance=2\nsimulation-distance=2\nlevel-type=minecraft:flat\n"
        "generate-structures=false\nspawn-protection=0\nmax-players=1\n"
    )
    process = subprocess.Popen(
        [args.java, "-Xms512M", "-Xmx2G", "-jar", "paper.jar", "--nogui"],
        cwd=root, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace",
        env=environment, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    lines = []
    timed_out = threading.Event()
    def expire():
        timed_out.set()
        process.kill()
    timer = threading.Timer(240, expire)
    timer.start()
    checks = []
    controller = None

    def heartbeat_checks():
        # Main thread keeps draining stdout while this thread requests status.
        def wait_status(predicate):
            for _ in range(60):
                start = len(lines)
                process.stdin.write("vos status\n")
                process.stdin.flush()
                time.sleep(1)
                for line in lines[start:]:
                    if predicate(line):
                        return line
                if process.poll() is not None:
                    break
            raise AssertionError("Heartbeat status timeout; inspect console.log")
        recovered_api = None
        try:
            connected = wait_status(lambda line: "heartbeat=conectado" in line)
            previous = int(re.search(r"enviados=(\d+)", connected)[1])
            api.terminate()
            api.wait(timeout=10)
            wait_status(lambda line: "heartbeat=API indisponivel" in line)
            assert process.poll() is None, "Paper stopped during API outage"
            recovered_api = start_api()
            wait_status(lambda line: "heartbeat=conectado" in line
                and int(re.search(r"enviados=(\d+)", line)[1]) > previous)
            checks.append(True)
        except Exception as error:
            checks.append(error)
        finally:
            if recovered_api is not None:
                recovered_api.terminate()
                recovered_api.wait(timeout=10)
            if process.poll() is None:
                process.stdin.write("stop\n")
                process.stdin.flush()
    try:
        with (root / "console.log").open("w", encoding="utf-8") as output:
            for line in process.stdout:
                lines.append(line)
                output.write(line)
                output.flush()
                if 'Done (' in line:
                    if with_authme and with_skins and args.heartbeat:
                        controller = threading.Thread(target=heartbeat_checks, daemon=True)
                        controller.start()
                    else:
                        process.stdin.write("vos status\nstop\n")
                        process.stdin.flush()
        code = process.wait(timeout=20)
    finally:
        timer.cancel()
        if process.poll() is None:
            process.kill()
            process.wait()
        if controller is not None:
            controller.join(timeout=5)
        if api is not None and api.poll() is None:
            api.terminate()
            api.wait(timeout=10)
        api_log.close()
    log = "".join(lines)
    assert not timed_out.is_set(), f"Server timeout: {root}"
    assert code == 0, f"Server exit {code}: {root}"
    assert 'Done (' in log, f"Server did not start: {root}"
    if with_authme and with_skins:
        assert 'Bootstrap pronto; AuthMe API disponivel' in log, f"Plugin not enabled: {root}"
        assert 'API local OK | serverId=' in log, f"Status command failed: {root}"
        if args.heartbeat:
            assert checks == [True], f"Heartbeat/outage/recovery failed: {checks}"
            assert token not in log, "Credential leaked in console"
            assert token not in (root / "api.log").read_text(), "Credential leaked in API log"
        else:
            assert 'heartbeat=desativado' in log
    else:
        assert 'Bootstrap pronto; AuthMe API disponivel' not in log
        assert 'UnknownDependencyException' in log and ('AuthMe' if not with_authme else 'SkinsRestorer') in log, f"Missing dependency not rejected: {root}"
    print(f"PASS: {root.name}", flush=True)
