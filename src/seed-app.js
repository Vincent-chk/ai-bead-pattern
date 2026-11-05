/* New local interface for the Seed bead pattern project, based on Bead Grid Studio. */
import './seed.css';
import { generateBeadPatternExact } from '../packages/core/src/index.js';

const $ = (id) => document.getElementById(id);
let source = null, selected = null, pattern = null, crop = null, drag = null;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
async function request(url, options) {
  const response = await fetch(url, options);
  let data = {};
  try { data = await response.json(); } catch { /* service may return an empty response */ }
  if (!response.ok) throw new Error((Array.isArray(data.errors) && data.errors.filter(item => typeof item === 'string').join('；')) || data.error || data.message || '请求失败，请检查设置后重试。');
  return data;
}
async function loadSettings() {
  try {
    const data = await request('/api/settings');
    for (const key of ['provider', 'baseUrl', 'model']) $('settings').elements[key].value = data[key] || '';
    $('settingsStatus').textContent = data.hasKey ? '已保存 API Key' : '尚未保存 API Key';
  } catch { $('settingsStatus').textContent = '无法读取模型设置，上传图片仍可使用。'; }
}
$('settings').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const saved = await request('/api/settings', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(Object.fromEntries(new FormData(form))) });
    form.elements.apiKey.value = '';
    $('settingsStatus').textContent = saved.hasKey ? '设置已保存，API Key 已保存' : '设置已保存，尚未保存 API Key';
  } catch (error) { $('settingsStatus').textContent = error.message; }
});
$('clearSettings').addEventListener('click', async () => {
  try { await request('/api/settings', { method:'DELETE' }); $('settings').reset(); $('settingsStatus').textContent = '设置已清除'; }
  catch (error) { $('settingsStatus').textContent = error.message; }
});
async function generate(referenceImage) {
  const prompt = $('prompt').value.trim();
  const extra = $('refPrompt').value.trim();
  const size = $('size').value;
  if (!prompt || (referenceImage && !extra)) { $('generationStatus').textContent = referenceImage ? '请输入补充修改要求。' : '请先描述你的想法。'; return; }
  $('generate').disabled = $('refGenerate').disabled = true;
  $('generationStatus').textContent = '正在生成，请稍候…';
  try {
    const data = await request('/api/generate', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ prompt: `${prompt}${referenceImage ? `\n补充修改要求：${extra}` : ''}\n目标图纸为 ${size} × ${size} 格，请让主体与细节适合这一格数。`, ...(referenceImage ? {referenceImage} : {}) }) });
    $('candidates').replaceChildren(); selected = null; $('referenceControls').hidden = true;
    (data.images || []).forEach((url, i) => {
      const button = document.createElement('button'); button.className = 'candidate'; button.setAttribute('aria-label', `选择候选图 ${i + 1}`);
      const img = document.createElement('img'); img.src = url; img.alt = `候选图 ${i + 1}`; button.append(img);
      button.addEventListener('click', () => { selected = url; document.querySelectorAll('.candidate').forEach(el => el.classList.remove('selected')); button.classList.add('selected'); $('referenceControls').hidden = false; });
      $('candidates').append(button);
    });
    $('generationStatus').textContent = (data.errors || []).join('；') || ((data.images || []).length ? '' : '未生成图片，请重试。');
  } catch (error) { $('generationStatus').textContent = error.message; }
  finally { $('generate').disabled = $('refGenerate').disabled = false; }
}
$('size').addEventListener('change', () => { $('cropSizeChoice').value = $('size').value; });
$('cropSizeChoice').addEventListener('change', () => { $('size').value = $('cropSizeChoice').value; });
$('generate').addEventListener('click', () => generate());
$('refGenerate').addEventListener('click', () => generate(selected));
$('useCandidate').addEventListener('click', () => loadImage(selected));
$('upload').addEventListener('change', async (event) => {
  const file = event.target.files[0]; if (!file) return;
  if (!file.type.startsWith('image/')) { $('generationStatus').textContent = '请选择图片文件。'; return; }
  const reader = new FileReader(); reader.onload = () => loadImage(reader.result); reader.onerror = () => { $('generationStatus').textContent = '无法读取图片，请换一张重试。'; }; reader.readAsDataURL(file);
});
function loadImage(url) {
  const image = new Image();
  image.onload = () => {
    if (!image.naturalWidth || !image.naturalHeight) { $('generationStatus').textContent = '无法读取图片尺寸。'; return; }
    if (image.naturalWidth * image.naturalHeight > 16000000 || Math.max(image.naturalWidth, image.naturalHeight) > 8192) {
      $('generationStatus').textContent = '图片过大，请缩小至 1600 万像素以内、边长不超过 8192 像素后重试。'; return;
    }
    $('generationStatus').textContent = '';
    source = image; const side = Math.min(image.naturalWidth, image.naturalHeight);
    crop = { x:(image.naturalWidth-side)/2, y:(image.naturalHeight-side)/2, width:side, height:side };
    $('cropX').value = $('cropY').value = 500; $('cropSize').value = 100;
    $('cropSection').hidden = false; $('resultSection').hidden = true; $('cropStatus').textContent = ''; drawCrop(); $('cropSection').scrollIntoView({behavior:'smooth'});
  };
  image.onerror = () => { $('generationStatus').textContent = '图片无法打开，请换一张重试。'; };
  image.src = url;
}
function syncSliders() {
  const maxX = source.naturalWidth - crop.width, maxY = source.naturalHeight - crop.height;
  $('cropX').value = maxX ? Math.round(crop.x / maxX * 1000) : 500;
  $('cropY').value = maxY ? Math.round(crop.y / maxY * 1000) : 500;
}
function drawCrop() {
  const canvas = $('cropCanvas'); const scale = Math.min(1, 720 / source.naturalWidth, 420 / source.naturalHeight);
  canvas.width = Math.max(1, Math.round(source.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
  const ctx = canvas.getContext('2d'); const sx = canvas.width/source.naturalWidth, sy = canvas.height/source.naturalHeight;
  ctx.drawImage(source,0,0,canvas.width,canvas.height); ctx.fillStyle = 'rgba(22,18,37,.5)'; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(source,crop.x,crop.y,crop.width,crop.height,crop.x*sx,crop.y*sy,crop.width*sx,crop.height*sy);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(crop.x*sx,crop.y*sy,crop.width*sx,crop.height*sy);
}
for (const id of ['cropX','cropY']) $(id).addEventListener('input', () => {
  crop.x = (source.naturalWidth-crop.width) * $('cropX').value/1000; crop.y = (source.naturalHeight-crop.height) * $('cropY').value/1000; drawCrop();
});
$('cropSize').addEventListener('input', () => {
  const centerX = crop.x + crop.width/2, centerY = crop.y + crop.height/2;
  crop.width = crop.height = Math.min(source.naturalWidth,source.naturalHeight) * $('cropSize').value/100;
  crop.x = clamp(centerX-crop.width/2,0,source.naturalWidth-crop.width); crop.y = clamp(centerY-crop.height/2,0,source.naturalHeight-crop.height); syncSliders(); drawCrop();
});
$('cropCanvas').addEventListener('pointerdown', event => { drag = {x:event.clientX,y:event.clientY,cropX:crop.x,cropY:crop.y}; event.currentTarget.setPointerCapture(event.pointerId); });
$('cropCanvas').addEventListener('pointermove', event => {
  if (!drag) return; const rect = event.currentTarget.getBoundingClientRect();
  crop.x = clamp(drag.cropX+(event.clientX-drag.x)*source.naturalWidth/rect.width,0,source.naturalWidth-crop.width);
  crop.y = clamp(drag.cropY+(event.clientY-drag.y)*source.naturalHeight/rect.height,0,source.naturalHeight-crop.height); syncSliders(); drawCrop();
});
$('cropCanvas').addEventListener('pointerup', () => { drag = null; });
$('cropCanvas').addEventListener('pointercancel', () => { drag = null; });
$('makePattern').addEventListener('click', async () => {
  $('makePattern').disabled = true; $('cropStatus').textContent = '正在生成图纸…';
  try {
    const canvas = document.createElement('canvas'); canvas.width = source.naturalWidth; canvas.height = source.naturalHeight;
    const context = canvas.getContext('2d', {willReadFrequently:true}); context.drawImage(source,0,0);
    const size = Number($('size').value); pattern = await generateBeadPatternExact(context.getImageData(0,0,canvas.width,canvas.height), {cols:size, rows:size, crop:{...crop}});
    renderResult(); $('resultSection').hidden = false; $('cropStatus').textContent = ''; $('resultSection').scrollIntoView({behavior:'smooth'});
  } catch (error) { $('cropStatus').textContent = `无法生成图纸：${error.message}`; }
  finally { $('makePattern').disabled = false; }
});
function drawChart(ctx, x, y, cell) {
  const colors = new Map(pattern.statistics.colors.map(c => [c.code,c]));
  pattern.grid.cells.forEach((code,i) => {
    const px=x+(i%pattern.grid.cols)*cell, py=y+Math.floor(i/pattern.grid.cols)*cell, color=colors.get(code);
    ctx.fillStyle = color?.hex || '#e6e6e6'; ctx.fillRect(px,py,cell,cell);
    ctx.strokeStyle='#777'; ctx.lineWidth=.6; ctx.strokeRect(px+.3,py+.3,cell-.6,cell-.6);
    if (color) { const hex=color.hex.replace('#',''); const brightness=(parseInt(hex.slice(0,2),16)*299+parseInt(hex.slice(2,4),16)*587+parseInt(hex.slice(4,6),16)*114)/1000; ctx.fillStyle=brightness<145?'#fff':'#111'; ctx.font=`bold ${Math.floor(cell*.31)}px sans-serif`; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(code,px+cell/2,py+cell/2,cell-2); }
  });
}
function renderResult() {
  $('dimensions').textContent = `${pattern.grid.cols} × ${pattern.grid.rows} 格`;
  $('total').textContent = `总计 ${pattern.statistics.totalBeads} 颗`;
  const canvas=$('patternCanvas'); canvas.width=pattern.grid.cols*32; canvas.height=pattern.grid.rows*32; drawChart(canvas.getContext('2d'),0,0,32); updateZoom();
  $('legend').replaceChildren(); for(const color of pattern.statistics.colors) { const item=document.createElement('div'); item.className='legend-item'; const swatch=document.createElement('span'); swatch.className='swatch'; swatch.style.background=color.hex; const text=document.createElement('span'); text.textContent=`${color.code} · ${color.count} 颗`; item.append(swatch,text); $('legend').append(item); }
}
function updateZoom() { $('patternCanvas').style.width = `${pattern.grid.cols * 32 * $('zoom').value / 100}px`; }
$('zoom').addEventListener('input', updateZoom);
$('download').addEventListener('click', () => {
  const size=32, pad=30, board=pattern.grid.cols*size, columns=Math.max(1,Math.floor(board/150)), rows=Math.ceil(pattern.statistics.colors.length/columns);
  const canvas=document.createElement('canvas'); canvas.width=Math.max(500,board+pad*2); canvas.height=board+140+rows*38; const ctx=canvas.getContext('2d'); ctx.fillStyle='#fff'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.fillStyle='#222'; ctx.font='bold 22px sans-serif'; ctx.textAlign='left'; ctx.textBaseline='alphabetic'; ctx.fillText(`拼豆图纸  ${pattern.grid.cols} × ${pattern.grid.rows} 格`,pad,35); ctx.font='16px sans-serif'; ctx.fillText(`MARD 兼容色卡   总计 ${pattern.statistics.totalBeads} 颗`,pad,62); drawChart(ctx,pad,80,size);
  pattern.statistics.colors.forEach((color,i) => { const x=pad+(i%columns)*150, y=board+105+Math.floor(i/columns)*38; ctx.fillStyle=color.hex; ctx.fillRect(x,y,24,24); ctx.strokeStyle='#777'; ctx.strokeRect(x,y,24,24); ctx.fillStyle='#222'; ctx.font='14px sans-serif'; ctx.textAlign='left'; ctx.textBaseline='middle'; ctx.fillText(`${color.code} · ${color.count} 颗`,x+30,y+12); });
  canvas.toBlob(blob => { if (!blob) return; const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='拼豆图纸.png'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),5000); },'image/png');
});
loadSettings();
