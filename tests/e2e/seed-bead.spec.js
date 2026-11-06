import { test, expect } from '@playwright/test';

test('上传图片后可裁切、生成图纸并下载', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('上传图片').setInputFiles({ name: 'white.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="white"/></svg>') });
  await expect(page.getByRole('heading', { name: '裁切图片' })).toBeVisible();
  await page.getByLabel('图纸尺寸').selectOption('29');
  await page.getByRole('button', { name: '生成图纸' }).click();
  await expect(page.getByText('总计 841 颗')).toBeVisible();
  await expect(page.getByText('29 × 29 格')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载 PNG' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
});

test('部分生图成功可选参考图并补充要求', async ({ page }) => {
  const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>');
  let body;
  await page.route('**/api/settings', route => route.fulfill({ json: { provider: 'seedream', baseUrl: '', model: '', hasKey: true } }));
  await page.route('**/api/generate', async route => { body = route.request().postDataJSON(); await route.fulfill({ json: { images: [image], errors: ['一张生成失败'] } }); });
  await page.goto('/');
  await page.getByLabel('描述你的想法').fill('一只猫');
  await page.getByRole('button', { name: '生成候选图' }).click();
  await expect(page.getByText('一张生成失败')).toBeVisible();
  await page.getByRole('button', { name: '选择候选图 1' }).click();
  await page.getByLabel('补充修改要求').fill('换成蓝色');
  await page.getByRole('button', { name: '参考此图生成' }).click();
  await expect.poll(() => body?.referenceImage).toBe(image);
  expect(body.prompt).toContain('换成蓝色');
});

test('横图可用滑块裁掉框外画面，并生成另外两档尺寸', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('上传图片').setInputFiles({ name: 'two-colors.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="60" height="60" fill="red"/><rect x="60" width="60" height="60" fill="blue"/></svg>') });
  await page.getByLabel('左右移动').fill('1000');
  for (const [size, total] of [['52', '2704'], ['104', '10816']]) {
    await page.getByLabel('图纸尺寸').selectOption(size);
    await page.getByRole('button', { name: '生成图纸' }).click();
    await expect(page.getByText(`总计 ${total} 颗`)).toBeVisible();
    await expect(page.getByText(`${size} × ${size} 格`)).toBeVisible();
    await expect(page.locator('.legend-item')).toHaveCount(1);
  }
});

test('生图失败时显示服务给出的原因', async ({ page }) => {
  await page.route('**/api/generate', route => route.fulfill({ status: 400, json: { images: [], errors: ['请填写提示词并配置密钥'] } }));
  await page.goto('/');
  await page.getByLabel('描述你的想法').fill('一只猫');
  await page.getByRole('button', { name: '生成候选图' }).click();
  await expect(page.getByText('请填写提示词并配置密钥')).toBeVisible();
});

test('更换服务后没有保留密钥时明确提示', async ({ page }) => {
  let hasKey = true;
  await page.route('**/api/settings', route => {
    if (route.request().method() === 'POST') hasKey = false;
    return route.fulfill({ json: { provider: 'openai', baseUrl: 'https://example.com', model: 'test', hasKey } });
  });
  await page.goto('/');
  await page.getByText('模型设置').click();
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(page.getByText('设置已保存，尚未保存 API Key')).toBeVisible();
});

test('超大图片提示缩小后重试', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('上传图片').setInputFiles({ name: 'large.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="5000" height="4000"><rect width="5000" height="4000" fill="white"/></svg>') });
  await expect(page.getByText('图片过大，请缩小至 1600 万像素以内、边长不超过 8192 像素后重试。')).toBeVisible();
  await expect(page.getByRole('heading', { name: '裁切图片' })).toBeHidden();
});

test('选图前可选择尺寸和色卡，生图和参考图使用所选格数', async ({ page }) => {
  const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>');
  const calls = [];
  await page.route('**/api/generate', route => { calls.push(route.request().postDataJSON()); return route.fulfill({ json: { images: [image], errors: [] } }); });
  await page.goto('/');
  await expect(page.getByLabel('图纸尺寸')).toBeVisible();
  await expect(page.getByLabel('色卡')).toHaveValue('MARD 兼容色卡');
  await page.getByLabel('图纸尺寸').selectOption('52');
  await page.getByLabel('描述你的想法').fill('一只猫');
  await page.getByRole('button', { name: '生成候选图' }).click();
  await expect(page.getByRole('button', { name: '选择候选图 1' })).toBeVisible();
  expect(calls[0].prompt).toContain('52 × 52');
  expect(calls[0].prompt).toContain('一只猫');
  await page.getByRole('button', { name: '选择候选图 1' }).click();
  await page.getByLabel('补充修改要求').fill('蓝色');
  await page.getByRole('button', { name: '参考此图生成' }).click();
  await expect.poll(() => calls.length).toBe(2);
  expect(calls[1].prompt).toContain('52 × 52');
  expect(calls[1].referenceImage).toBe(image);
  await page.getByRole('button', { name: '选择候选图 1' }).click();
  await page.getByRole('button', { name: '使用此图' }).click();
  await expect(page.getByLabel('裁切后尺寸')).toHaveValue('52');
  const zoom = page.getByLabel('缩放图片');
  await expect(zoom).toBeVisible();
  await expect(zoom).toHaveValue('1');
  await zoom.focus();
  await page.keyboard.press('ArrowRight');
  await expect(zoom).toHaveValue('1.1');
  await expect(zoom).toHaveAttribute('aria-valuetext', '1.1 倍');
  await page.getByLabel('裁切后尺寸').selectOption('104');
  await expect(page.getByLabel('图纸尺寸')).toHaveValue('104');
});

test('缩放图片让留白中的主体占据更多图纸区域', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('上传图片').setInputFiles({ name: 'subject.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="white"/><rect x="80" y="80" width="40" height="40" fill="red"/></svg>') });
  const zoom = page.getByLabel('缩放图片');
  await expect(zoom).toBeVisible();
  await expect(zoom).toHaveValue('1');
  const preview = page.getByLabel('裁切预览');
  const pixel = () => preview.evaluate(canvas => Array.from(canvas.getContext('2d').getImageData(20, 100, 1, 1).data));
  const before = await pixel();
  const resultPreview = page.getByLabel('裁切结果预览');
  const resultPixel = (x, y) => resultPreview.evaluate((canvas, [x, y]) => Array.from(canvas.getContext('2d').getImageData(x * canvas.width, y * canvas.height, 1, 1).data), [x, y]);
  expect((await resultPixel(0.2, 0.5))[1]).toBeGreaterThan(200);
  await page.getByRole('button', { name: '生成图纸' }).click();
  const redCount = async () => page.locator('.legend-item').evaluateAll(items => {
    const red = items.find(item => { const [r, g, b] = getComputedStyle(item.querySelector('.swatch')).backgroundColor.match(/\d+/g).map(Number); return r > g * 1.5 && r > b * 1.5; });
    return Number(red.textContent.match(/(\d+) 颗/)[1]);
  });
  const initial = await redCount();
  await zoom.fill('4');
  expect((await pixel())[0]).toBeLessThan(before[0]);
  expect((await resultPixel(0.2, 0.5))[1]).toBeLessThan(30);
  await page.getByRole('button', { name: '生成图纸' }).click();
  await expect.poll(redCount).toBeGreaterThan(initial * 8);
  await page.getByLabel('左右移动').fill('1000');
  expect((await resultPixel(0.5, 0.5))[1]).toBeGreaterThan(200);
  await page.getByRole('button', { name: '生成图纸' }).click();
  await expect(page.locator('.legend-item')).toHaveCount(1);
});
