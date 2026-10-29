"""Package an already-tested plugin without bundling third-party server JARs.
SPDX-License-Identifier: AGPL-3.0-only
"""
import argparse
import hashlib
import json
import pathlib
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--version', required=True)
args = parser.parse_args()
root = pathlib.Path(__file__).resolve().parent.parent
jar = root / f'plugin/build/libs/VanillaOnlineStats-{args.version}.jar'
if not jar.is_file():
    parser.error('Build the plugin first')
output = root / 'plugin/build/release'
output.mkdir(parents=True, exist_ok=True)
bom = {
    'bomFormat': 'CycloneDX', 'specVersion': '1.6', 'version': 1,
    'metadata': {'component': {'type': 'application', 'name': 'VanillaOnlineStats plugin', 'version': args.version,
        'licenses': [{'license': {'id': 'AGPL-3.0-only'}}], 'hashes': [{'alg': 'SHA-256', 'content': hashlib.sha256(jar.read_bytes()).hexdigest()}]}},
    'components': [
        {'type': 'application', 'name': 'Paper', 'version': '26.3-227', 'scope': 'required',
            'description': 'External server runtime, not bundled'},
        {'type': 'application', 'name': 'AuthMeReloaded', 'version': '6.0.1-b2770', 'scope': 'required',
            'description': 'External plugin, not bundled'},
        {'type': 'application', 'name': 'SkinsRestorer', 'version': '15.12.6', 'scope': 'required', 'description': 'External plugin and public API, not bundled', 'licenses': [{'license': {'id': 'GPL-3.0-or-later'}}]},
        {'type': 'library', 'name': 'Gson', 'group': 'com.google.code.gson', 'version': '2.14.0', 'scope': 'required',
            'purl': 'pkg:maven/com.google.code.gson/gson@2.14.0', 'licenses': [{'license': {'id': 'Apache-2.0'}}],
            'description': 'Provided by Paper, not embedded in VanillaOnlineStats.jar'},
    ],
}
bom_path = output / 'plugin-runtime.cdx.json'
bom_path.write_text(json.dumps(bom, indent=2) + '\n', encoding='utf-8')
archive = output / f'VanillaOnlineStats-{args.version}.zip'
files = {
    jar.name: jar,
    'LICENSE': root / 'LICENSE',
    'THIRD_PARTY_NOTICES.md': root / 'THIRD_PARTY_NOTICES.md',
    'INSTALL.md': root / 'docs/PLUGIN.md',
    'config.example.yml': root / 'plugin/src/main/resources/config.yml',
    'plugin-runtime.cdx.json': bom_path,
    'contracts/telemetry-envelope.schema.json': root / 'packages/api-contracts/telemetry-envelope.schema.json',
    'contracts/control-body.schema.json': root / 'packages/api-contracts/control-body.schema.json',
}
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as package:
    for name, path in sorted(files.items()):
        info = zipfile.ZipInfo(name, (2026, 10, 28, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        package.writestr(info, path.read_bytes())
checksums = [f'{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}' for path in (jar, archive, bom_path)]
(output / 'SHA256SUMS').write_text('\n'.join(checksums) + '\n', encoding='utf-8')
print(archive)
