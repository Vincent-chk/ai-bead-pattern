import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';
import { readFile, mkdir, chmod, open, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join, extname } from 'node:path';

const configDir = process.env.BEAD_CONFIG_DIR || join(homedir(), 'Library', 'Application Support', 'AI Bead Pattern');
const configFile = join(configDir, 'settings.json');
const defaults = { provider: 'seedream', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seedream-5-0-lite-260128', apiKey: '' };
const root = resolve(process.env.BEAD_STATIC_DIR || 'dist');
const maxBytes = 20 * 1024 * 1024;
async function load() {
  try { return { ...defaults, ...JSON.parse(await readFile(configFile, 'utf8')) }; }
  catch (error) { if (error.code === 'ENOENT') return { ...defaults }; throw error; }
}
async function save(value) {
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  if ((await lstat(configDir)).isSymbolicLink()) throw Error('invalid directory');
  await chmod(configDir, 0o700);
  const file = await open(configFile, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
  try { await file.chmod(0o600); if (((await file.stat()).mode & 0o077) !== 0) throw Error('insecure permissions'); await file.writeFile(JSON.stringify(value)); } finally { await file.close(); }
}
function publicSettings(value) { return { provider: value.provider, baseUrl: value.baseUrl, model: value.model, hasKey: Boolean(value.apiKey) }; }
function safeUrl(text, allowQuery = false) {
  const url = new URL(text);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (!allowQuery && url.search)) throw Error('invalid url');
  return url;
}
function publicIp(ip) {
  if (net.isIP(ip) !== 4) return false;
  const [a,b,c] = ip.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
}
async function remote(url, options = {}) {
  const parsed = safeUrl(url, options.allowQuery);
  const addresses = await dns.lookup(parsed.hostname, { all: true, family: 4 });
  if (!addresses.length || addresses.some(x => !publicIp(x.address))) throw Error('unsafe address');
  return new Promise((res, rej) => {
    const req = https.request(parsed, { method: options.method || 'GET', headers: options.headers, lookup: (_name, opts, cb) => opts.all ? cb(null, [{ address: addresses[0].address, family: 4 }]) : cb(null, addresses[0].address, 4), timeout: 120000 }, response => {
      const chunks = []; let size = 0;
      response.on('data', chunk => { size += chunk.length; if (size > maxBytes) response.destroy(Error('too large')); else chunks.push(chunk); });
      response.on('error', rej);
      response.on('end', () => res({ status: response.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('timeout', () => req.destroy(Error('timeout'))); req.on('error', rej);
    if (options.body) req.write(options.body); req.end();
  });
}
function imageData(bytes) {
  let type;
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) type = 'png';
  else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) type = 'jpeg';
  else if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') type = 'webp';
  else throw Error('invalid image');
  return `data:image/${type};base64,${bytes.toString('base64')}`;
}
function parseImage(data) {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(data || '');
  if (!match || match[2].length > maxBytes * 4 / 3) throw Error('invalid image');
  const bytes = Buffer.from(match[2], 'base64');
  const result = imageData(bytes);
  if (!result.startsWith(`data:image/${match[1]};`)) throw Error('invalid image');
  return result;
}
async function generateOne(settings, prompt, reference) {
  const seed = settings.provider === 'seedream';
  const endpoint = seed || !reference ? '/images/generations' : '/images/edits';
  const data = { model: settings.model, prompt: `适合拼豆的图案，主体清晰、颜色简洁。${prompt}` };
  if (seed) { data.response_format = 'b64_json'; if (reference) data.image = reference; }
  else { data.n = 1; if (reference) data.images = [{ image_url: reference }]; }
  const baseUrl = settings.baseUrl.replace(/\/$/, '');
  const requestUrl = seed && baseUrl.endsWith('/images/generations') ? baseUrl : `${baseUrl}${endpoint}`;
  const result = await remote(requestUrl, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${settings.apiKey}` }, body: JSON.stringify(data) });
  if (result.status !== 200) throw Error(result.status === 401 || result.status === 403 ? '密钥或权限无效' : result.status === 429 ? '请求过于频繁或额度不足' : result.status === 404 ? '接口或模型不存在，或密钥无权使用，请检查服务地址、模型名称和权限' : reference ? '生成失败，模型可能不支持参考图' : '生图服务请求失败');
  let item; try { item = JSON.parse(result.body).data?.[0]; } catch { throw Error('生图服务返回无效数据'); }
  if (!item || item.error) throw Error(reference ? '生成失败，模型可能不支持参考图' : '生图服务未返回图片');
  if (item.b64_json) return imageData(Buffer.from(item.b64_json, 'base64'));
  if (item.url) { const image = await remote(item.url, { allowQuery: true }); if (image.status !== 200) throw Error('图片下载失败'); return imageData(image.body); }
  throw Error('生图服务未返回图片');
}
async function body(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > maxBytes) throw Error('请求过大'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString());
}
function json(res, status, value) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(value)); }
const server = http.createServer(async (req, res) => {
  const host = `127.0.0.1:${server.address().port}`;
  if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== `http://${host}`)) return json(res, 403, { error: '请求来源无效' });
  if (req.url.startsWith('/api/') && req.method !== 'GET' && (req.headers.origin !== `http://${host}` || (req.method === 'POST' && !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')))) return json(res, 403, { error: '请求来源无效' });
  try {
    if (req.url === '/api/settings' && req.method === 'GET') return json(res, 200, publicSettings(await load()));
    if (req.url === '/api/settings' && req.method === 'POST') {
      const input = await body(req); const previous = await load();
      if (!['seedream', 'openai'].includes(input.provider) || typeof input.model !== 'string' || !input.model.trim() || input.model.length > 200 || typeof input.baseUrl !== 'string' || typeof input.apiKey !== 'string' || input.apiKey.length > 4096 || /[\r\n]/.test(input.apiKey)) return json(res, 400, { error: '配置无效' });
      safeUrl(input.baseUrl);
      const baseUrl = input.baseUrl.replace(/\/$/, '');
      const sameService = input.provider === previous.provider && baseUrl === previous.baseUrl.replace(/\/$/, '');
      const value = { provider: input.provider, baseUrl, model: input.model.trim(), apiKey: input.apiKey || (sameService ? previous.apiKey : '') };
      await save(value); return json(res, 200, publicSettings(value));
    }
    if (req.url === '/api/settings' && req.method === 'DELETE') { const value = await load(); value.apiKey = ''; await save(value); return json(res, 200, publicSettings(value)); }
    if (req.url === '/api/generate' && req.method === 'POST') {
      const input = await body(req); const settings = await load();
      if (!settings.apiKey || typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 4000) return json(res, 400, { images: [], errors: ['请填写提示词并配置密钥'] });
      let reference;
      if (input.referenceImage) { try { reference = parseImage(input.referenceImage); } catch { return json(res, 400, { images: [], errors: ['参考图片格式无效'] }); } }
      const results = await Promise.allSettled(Array.from({ length: 3 }, () => generateOne(settings, input.prompt.trim(), reference)));
      return json(res, 200, { images: results.filter(x => x.status === 'fulfilled').map(x => x.value), errors: results.filter(x => x.status === 'rejected').map(x => ['密钥或权限无效', '请求过于频繁或额度不足', '接口或模型不存在，或密钥无权使用，请检查服务地址、模型名称和权限', '生成失败，模型可能不支持参考图', '生图服务请求失败', '生图服务返回无效数据', '生图服务未返回图片', '图片下载失败'].includes(x.reason.message) ? x.reason.message : '网络或图片处理失败，请检查服务配置后重试') });
    }
    if (req.method !== 'GET') return json(res, 404, { error: '未找到' });
    const path = decodeURIComponent(new URL(req.url, `http://${host}`).pathname);
    const file = resolve(root, `.${path === '/' ? '/index.html' : path}`);
    if (!file.startsWith(`${root}/`)) return json(res, 404, { error: '未找到' });
    const content = await readFile(file);
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'x-content-type-options': 'nosniff' }); res.end(content);
  } catch { json(res, 400, { error: '请求无效或本地配置不可用' }); }
});
server.listen(Number(process.env.PORT || 0), '127.0.0.1', () => console.log(server.address().port));
