"""Run isolated Paper bootstrap checks. SPDX-License-Identifier: AGPL-3.0-only"""
import argparse
import pathlib
import shutil
import subprocess
import threading

parser = argparse.ArgumentParser()
parser.add_argument("--java", required=True)
parser.add_argument("--paper", required=True)
parser.add_argument("--authme", required=True)
parser.add_argument("--plugin", required=True)
parser.add_argument("--output", required=True)
parser.add_argument("--accept-eula", action="store_true")
args = parser.parse_args()
if not args.accept_eula:
    parser.error("Read https://aka.ms/MinecraftEULA and pass --accept-eula to run a test server")

for with_authme in (True, False):
    root = pathlib.Path(args.output).resolve() / ("with-authme" if with_authme else "without-authme")
    root.mkdir(parents=True, exist_ok=False)
    (root / "plugins").mkdir()
    shutil.copyfile(args.paper, root / "paper.jar")
    shutil.copyfile(args.plugin, root / "plugins/VanillaOnlineStats.jar")
    if with_authme:
        shutil.copyfile(args.authme, root / "plugins/AuthMe.jar")
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
    )
    lines = []
    timed_out = threading.Event()
    def expire():
        timed_out.set()
        process.kill()
    timer = threading.Timer(240, expire)
    timer.start()
    try:
        with (root / "console.log").open("w", encoding="utf-8") as output:
            for line in process.stdout:
                lines.append(line)
                output.write(line)
                output.flush()
                if 'Done (' in line:
                    process.stdin.write("vos status\nstop\n")
                    process.stdin.flush()
        code = process.wait(timeout=20)
    finally:
        timer.cancel()
        if process.poll() is None:
            process.kill()
            process.wait()
    log = "".join(lines)
    assert not timed_out.is_set(), f"Server timeout: {root}"
    assert code == 0, f"Server exit {code}: {root}"
    assert 'Done (' in log, f"Server did not start: {root}"
    if with_authme:
        assert 'Bootstrap pronto; AuthMe API disponivel' in log, f"Plugin not enabled: {root}"
        assert 'API local OK | transporte pendente' in log, f"Status command failed: {root}"
    else:
        assert 'Bootstrap pronto; AuthMe API disponivel' not in log
        assert 'UnknownDependencyException' in log and 'AuthMe' in log, f"Missing dependency not rejected: {root}"
    print(f"PASS: {root.name}", flush=True)
