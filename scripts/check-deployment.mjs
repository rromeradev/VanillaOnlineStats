// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
const origin = process.argv[2] ?? 'http://127.0.0.1:3000';
const health = await fetch(origin + '/api/v1/health');
assert.ok(health.ok, 'API health');
for (const path of ['/', '/login', '/admin/overview', '/player/overview']) {
  const response = await fetch(origin + path);
  assert.ok(response.ok, 'SPA route ' + path);
  const html = await response.text();
  assert.ok(html.includes('<vos-root>'), 'Angular entry point');
  assert.ok(!html.includes('media="print"'), 'CSP-compatible styles');
  const css = /href="(styles-[^"]+\.css)"/.exec(html)?.[1];
  const js = /src="(main-[^"]+\.js)"/.exec(html)?.[1];
  assert.ok(css && js, 'Compiled assets');
  assert.ok((await fetch(origin + '/' + css)).ok, 'Styles served');
  assert.ok((await fetch(origin + '/' + js)).ok, 'JavaScript served');
  assert.ok(response.headers.get('content-security-policy')?.includes("script-src 'self'"));
}
console.log('Deployment verified: root, login, SPA routes, JavaScript, CSS and API.');
