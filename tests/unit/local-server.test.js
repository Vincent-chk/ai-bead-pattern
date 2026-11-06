import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

test('本地设置隐藏密钥，并拒绝跨站请求', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'beads-'));
  const child = spawn(process.execPath, ['server/server.js'], { env: { ...process.env, BEAD_CONFIG_DIR: dir, PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    const [chunk] = await once(child.stdout, 'data');
    const port = Number(String(chunk).trim());
    const url = `http://127.0.0.1:${port}`;
    const origin = { origin: url, 'content-type': 'application/json' };
    let response = await fetch(`${url}/api/settings`, { method: 'POST', headers: origin, body: JSON.stringify({ provider: 'seedream', baseUrl: 'https://example.com/v1', model: 'test', apiKey: 'secret' }) });
    assert.equal(response.status, 200);
    response = await fetch(`${url}/api/settings`);
    const settings = await response.json();
    assert.equal(settings.hasKey, true);
    assert.equal(JSON.stringify(settings).includes('secret'), false);
    response = await fetch(`${url}/api/settings`, { method: 'DELETE', headers: { origin: 'https://evil.example' } });
    assert.equal(response.status, 403);
    response = await fetch(`${url}/api/settings`, { method: 'DELETE', headers: { origin: url } });
    assert.equal(response.status, 200);
    response = await fetch(`${url}/api/settings`);
    assert.equal((await response.json()).hasKey, false);
  } finally { child.kill(); await rm(dir, { recursive: true, force: true }); }
});

test('本地接口限制 Host、配置地址和参考图', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'beads-'));
  const child = spawn(process.execPath, ['server/server.js'], { env: { ...process.env, BEAD_CONFIG_DIR: dir, PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    const [chunk] = await once(child.stdout, 'data');
    const url = `http://127.0.0.1:${Number(String(chunk).trim())}`;
    const headers = { origin: url, 'content-type': 'application/json' };
    const status = await new Promise((resolve, reject) => { const req = http.get(`${url}/api/settings`, { headers: { host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); });
    assert.equal(status, 403);
    let response;
    response = await fetch(`${url}/api/settings`, { method: 'POST', headers, body: JSON.stringify({ provider: 'openai', baseUrl: 'http://127.0.0.1', model: 'x', apiKey: 'x' }) });
    assert.equal(response.status, 400);
    response = await fetch(`${url}/api/settings`, { method: 'POST', headers, body: JSON.stringify({ provider: 'openai', baseUrl: 'https://example.com/v1', model: 'x', apiKey: 'x' }) });
    assert.equal(response.status, 200);
    response = await fetch(`${url}/api/settings`, { method: 'POST', headers, body: JSON.stringify({ provider: 'openai', baseUrl: 'https://example.com/v1', model: 'x', apiKey: '' }) });
    assert.equal((await response.json()).hasKey, true);
    response = await fetch(`${url}/api/generate`, { method: 'POST', headers, body: JSON.stringify({ prompt: '猫', referenceImage: 'not an image' }) });
    assert.equal(response.status, 400);
  } finally { child.kill(); await rm(dir, { recursive: true, force: true }); }
});

test('三次请求保留部分成功，参考图进入编辑接口', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'beads-'));
  const log = join(dir, 'calls');
  const child = spawn(process.execPath, ['--import', './tests/fixtures/mock-image-provider.js', 'server/server.js'], { env: { ...process.env, BEAD_CONFIG_DIR: dir, BEAD_MOCK_LOG: log, PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    const [chunk] = await once(child.stdout, 'data');
    const url = `http://127.0.0.1:${Number(String(chunk).trim())}`;
    const headers = { origin: url, 'content-type': 'application/json' };
    await fetch(`${url}/api/settings`, { method: 'POST', headers, body: JSON.stringify({ provider: 'openai', baseUrl: 'https://example.com/v1', model: 'test', apiKey: 'test-key' }) });
    const reference = 'data:image/png;base64,iVBORw0KGgo=';
    const response = await fetch(`${url}/api/generate`, { method: 'POST', headers, body: JSON.stringify({ prompt: '猫', referenceImage: reference }) });
    const result = await response.json();
    assert.equal(result.images.length, 2);
    assert.deepEqual(result.errors, ['接口或模型不存在，或密钥无权使用，请检查服务地址、模型名称和权限']);
    const { readFile } = await import('node:fs/promises');
    const calls = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(calls.length, 3);
    assert.ok(calls.every(call => call.path === '/v1/images/edits' && call.body.images[0].image_url === reference));
  } finally { child.kill(); await rm(dir, { recursive: true, force: true }); }
});


test('更换服务地址或提供商时不会沿用旧密钥', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'beads-'));
  const child = spawn(process.execPath, ['server/server.js'], { env: { ...process.env, BEAD_CONFIG_DIR: dir, PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    const [chunk] = await once(child.stdout, 'data');
    const url = `http://127.0.0.1:${Number(String(chunk).trim())}`;
    const headers = { origin: url, 'content-type': 'application/json' };
    const save = async value => (await fetch(`${url}/api/settings`, { method: 'POST', headers, body: JSON.stringify(value) })).json();
    const settings = { provider: 'openai', baseUrl: 'https://example.com/v1', model: 'model', apiKey: 'old-key' };
    assert.equal((await save(settings)).hasKey, true);
    assert.equal((await save({ ...settings, baseUrl: 'https://elsewhere.example/v1', apiKey: '' })).hasKey, false);
    assert.equal((await save(settings)).hasKey, true);
    assert.equal((await save({ ...settings, provider: 'seedream', apiKey: '' })).hasKey, false);
    const seed = { provider: 'seedream', baseUrl: 'https://example.com/api/v3', model: 'model', apiKey: 'test-key' };
    assert.equal((await save(seed)).hasKey, true);
    assert.equal((await save({ ...seed, baseUrl: `${seed.baseUrl}/images/generations`, apiKey: '' })).hasKey, false);
  } finally { child.kill(); await rm(dir, { recursive: true, force: true }); }
});

test('Seedream 使用单图请求，支持服务根地址和完整生成地址', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'beads-'));
  const log = join(dir, 'calls');
  const child = spawn(process.execPath, ['--import', './tests/fixtures/mock-image-provider.js', 'server/server.js'], { env: { ...process.env, BEAD_CONFIG_DIR: dir, BEAD_MOCK_LOG: log, PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    const [chunk] = await once(child.stdout, 'data');
    const url = `http://127.0.0.1:${Number(String(chunk).trim())}`;
    const headers = { origin: url, 'content-type': 'application/json' };
    const reference = 'data:image/png;base64,iVBORw0KGgo=';
    const cases = [
      { model: 'doubao-seedream-5.0-flash', baseUrl: 'https://example.com/api/plan/v3/images/generations', referenceImage: reference, path: '/api/plan/v3/images/generations' },
      { model: 'doubao-seedream-5.0-pro', baseUrl: 'https://example.com/api/plan/v3/images/generations/', path: '/api/plan/v3/images/generations' },
      { model: 'doubao-seedream-5.0-flash', baseUrl: 'https://example.com/api/plan/v3', referenceImage: reference, path: '/api/plan/v3/images/generations' },
      { model: 'doubao-seedream-5-0-pro-260101', baseUrl: 'https://example.com/api/v3/', path: '/api/v3/images/generations' },
      { model: 'doubao-seedream-5-0-lite-260128', baseUrl: 'https://example.com/api/v3', path: '/api/v3/images/generations' }
    ];
    for (const item of cases) {
      const saved = await fetch(`${url}/api/settings`, { method: 'POST', headers, body: JSON.stringify({ provider: 'seedream', baseUrl: item.baseUrl, model: item.model, apiKey: 'test-key' }) });
      assert.equal(saved.status, 200);
      const response = await fetch(`${url}/api/generate`, { method: 'POST', headers, body: JSON.stringify({ prompt: '猫', referenceImage: item.referenceImage }) });
      const result = await response.json();
      assert.equal(result.images.length + result.errors.length, 3);
      assert.ok(result.images.length >= 2);
    }
    const { readFile } = await import('node:fs/promises');
    const calls = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(calls.length, cases.length * 3);
    for (const [index, item] of cases.entries()) {
      for (const call of calls.slice(index * 3, index * 3 + 3)) {
        assert.equal(call.path, item.path);
        assert.equal(call.body.model, item.model);
        assert.equal(call.body.response_format, 'b64_json');
        assert.equal(call.body.image, item.referenceImage);
        assert.equal('n' in call.body, false);
        assert.equal('sequential_image_generation' in call.body, false);
      }
    }
  } finally { child.kill(); await rm(dir, { recursive: true, force: true }); }
});
