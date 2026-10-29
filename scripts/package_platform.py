"""Package source, compiled applications and third-party notices; never local secrets.
SPDX-License-Identifier: AGPL-3.0-only
"""
import argparse
import hashlib
import json
import pathlib
import subprocess
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--licenses', required=True, help='pnpm licenses list --prod --json output')
args = parser.parse_args()
root = pathlib.Path(__file__).resolve().parent.parent
output = root / 'dist'
output.mkdir(exist_ok=True)
version = json.loads((root / 'package.json').read_text())['version']
files = {}
for raw in subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd=root).decode().split('\0'):
    if not raw:
        continue
    path = pathlib.PurePosixPath(raw)
    if any(part.startswith('.env') or part in {'.tools', '.git', '.angular', 'node_modules', 'dist', 'build'} for part in path.parts):
        continue
    if path.suffix in {'.pem', '.key', '.log'}:
        continue
    files[raw] = root / raw
for folder in ('apps/api/dist', 'apps/web/dist'):
    for path in (root / folder).rglob('*'):
        if path.is_file():
            files[path.relative_to(root).as_posix()] = path
if not (root / 'apps/web/dist/browser/index.html').is_file() or not (root / 'apps/api/dist/main.js').is_file():
    parser.error('Build both apps first')
license_data = json.loads(pathlib.Path(args.licenses).read_text(encoding='utf-8-sig'))
components = []
for license_name, entries in license_data.items():
    for entry in entries:
        for package_version in entry['versions']:
            components.append({'type': 'library', 'name': entry['name'], 'version': package_version,
                               'licenses': [{'expression': license_name}]})
        slug = entry['name'].replace('@', '').replace('/', '__')
        for package_path in entry.get('paths', []):
            directory = pathlib.Path(package_path).resolve()
            if not directory.is_relative_to((root / 'node_modules').resolve()):
                continue
            for path in directory.iterdir():
                if path.is_file() and path.name.lower().split('.')[0] in {'license', 'licence', 'notice', 'copying'}:
                    files['licenses/' + slug + '/' + path.name] = path
bom = {'bomFormat': 'CycloneDX', 'specVersion': '1.6', 'version': 1,
       'metadata': {'component': {'type': 'application', 'name': 'VanillaOnlineStats platform', 'version': version,
                                 'licenses': [{'license': {'id': 'AGPL-3.0-only'}}]}},
       'components': sorted(components, key=lambda item: (item['name'], item['version']))}
bom_path = output / 'platform-runtime.cdx.json'
bom_path.write_text(json.dumps(bom, indent=2) + '\n', encoding='utf-8')
files['platform-runtime.cdx.json'] = bom_path
archive = output / f'VanillaOnlineStats-platform-{version}.zip'
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as package:
    for name, path in sorted(files.items()):
        info = zipfile.ZipInfo(name, (2026, 10, 28, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        package.writestr(info, path.read_bytes())
(output / 'SHA256SUMS-platform').write_text('\n'.join(f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}' for p in (archive, bom_path)) + '\n')
print(archive)
