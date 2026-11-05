import {
  clamp,
  cropSourceRect,
  fitGeometryMetrics,
  fitPatternInsideBoard,
  gridForLongSide,
  gridFromAspectAnchor,
  normalizeCrop,
  orientedSourceDimensions,
} from './geometry.js';

import {
  clamp01,
  deltaE2000,
  hexToRgb,
  labDistance,
  linearSrgb,
  preparePaletteColor,
  rgbToCielab,
  rgbToHex,
  rgbToOklab,
  srgbLinear,
  visiblyChromaticRgb,
} from './color.js';

import {
  DEFAULT_PALETTE_PROVIDER_ID,
  LEGACY_64_DATA,
  LEGACY_64_HEX,
  LEGACY_TO_MARD,
  MARD_221_DATA,
  MARD_PALETTE_SOURCE,
  MARD_SERIES,
  PALETTE,
  PALETTE_PROVIDERS,
  createCustomPalette,
  getPaletteProvider,
  registerPaletteProvider,
} from './palette.js';

import {
  analyzeLineArtSubject,
  analyzeSourceComplexity,
  recommendAutoHdSettings,
  recommendDocumentGrid,
} from './analysis.js';

import { quantizePixels } from './quantize.js';

import {
  analyzePattern,
  assessPatternQuality,
  createPattern,
  deserializePattern,
  despeckleGrid,
  embedPatternGrid,
  occupiedBounds,
  parsePattern,
  replaceGridColor,
  serializePattern,
  validatePattern,
} from './pattern.js';

/**
 * End-to-end image to bead pattern generator pipeline.
 *
 * @param {{ data: Uint8Array | Uint8ClampedArray | number[], width: number, height: number }} imageData
 * @param {object} [options]
 * @param {number} [options.cols] - Target grid columns (default: 48)
 * @param {number} [options.rows] - Target grid rows (default: 48)
 * @param {number} [options.width] - Alias for cols
 * @param {number} [options.height] - Alias for rows
 * @param {string | object} [options.palette='mard-compatible-base-221'] - Palette provider id or instance
 * @param {number} [options.maxColors=32] - Max material colors
 * @param {'auto' | 'keep'} [options.whiteMode='auto'] - White background handling
 * @param {'cartoon' | 'detail' | 'document' | 'photo' | 'pixel'} [options.processMode='cartoon'] - Mode
 * @param {number} [options.mergeStrength=10] - Merge similarity strength
 * @param {boolean} [options.protectDark=true] - Protect neutral dark lines
 * @param {string} [options.title='Generated Pattern'] - Pattern title
 * @returns {Promise<ReturnType<typeof createPattern>>}
 */
export async function generateBeadPattern(imageData, options = {}) {
  if (!imageData || !imageData.data || !imageData.width || !imageData.height) {
    throw new Error('generateBeadPattern requires an imageData object with { data, width, height }');
  }

  const cols = options.cols || options.width || 48;
  const rows = options.rows || options.height || 48;
  const paletteArg = options.palette || DEFAULT_PALETTE_PROVIDER_ID;
  const provider = typeof paletteArg === 'string' ? getPaletteProvider(paletteArg) : paletteArg;
  const allowedColors = provider.colors.filter((c) => !c.isTransparent);

  const result = quantizePixels({
    data: imageData.data,
    width: imageData.width,
    height: imageData.height,
    cols,
    rows,
    palette: allowedColors,
    maxColors: options.maxColors ?? 32,
    whiteMode: options.whiteMode ?? 'auto',
    processMode: options.processMode ?? 'cartoon',
    mergeStrength: options.mergeStrength ?? 10,
    protectDark: options.protectDark ?? true,
  });

  return createPattern({
    width: cols,
    height: rows,
    cells: result.cells,
    palette: provider,
    title: options.title || 'Generated Pattern',
    metadata: {
      processMode: options.processMode ?? 'cartoon',
      maxColors: options.maxColors ?? 32,
      whiteMode: options.whiteMode ?? 'auto',
      mergeStrength: options.mergeStrength ?? 10,
      protectDark: options.protectDark ?? true,
      diagnostics: result.diagnostics,
      nonEmpty: result.nonEmpty,
    },
  });
}

/**
 * Convert original pixels to a pattern using area and alpha weighted RGB.
 * Color distance is squared sRGB distance; equal distances use palette order.
 * Crop coordinates are measured in source pixels and may be fractional.
 */
export async function generateBeadPatternExact(imageData, options = {}) {
  const { width, height, data } = imageData || {};
  const { cols, rows } = options;
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0 ||
      !data || data.length < width * height * 4) {
    throw new Error('Expected complete image data with positive integer dimensions');
  }
  if (!Number.isInteger(cols) || cols <= 0 || !Number.isInteger(rows) || rows <= 0) {
    throw new Error('Expected positive integer grid dimensions');
  }
  const crop = options.crop ?? { x: 0, y: 0, width, height };
  if (![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) ||
      crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0 ||
      crop.x + crop.width > width || crop.y + crop.height > height) {
    throw new Error('Crop must be a positive rectangle inside the image');
  }
  const provider = typeof options.palette === 'string'
    ? getPaletteProvider(options.palette)
    : options.palette ?? getPaletteProvider();
  const colors = provider.colors.map((color, index) => ({ color, index, rgb: color.rgb ?? hexToRgb(color.hex) }))
    .filter(({ color }) => !color.isTransparent);
  if (!colors.length) throw new Error('Palette must contain an opaque color');

  const cells = new Int16Array(cols * rows).fill(-1);
  for (let row = 0; row < rows; row++) {
    const top = crop.y + crop.height * row / rows;
    const bottom = crop.y + crop.height * (row + 1) / rows;
    for (let col = 0; col < cols; col++) {
      const left = crop.x + crop.width * col / cols;
      const right = crop.x + crop.width * (col + 1) / cols;
      const area = (right - left) * (bottom - top);
      let visible = 0, red = 0, green = 0, blue = 0;
      for (let y = Math.floor(top); y < Math.ceil(bottom) && y < height; y++) {
        const overlapY = Math.min(bottom, y + 1) - Math.max(top, y);
        for (let x = Math.floor(left); x < Math.ceil(right) && x < width; x++) {
          const overlapX = Math.min(right, x + 1) - Math.max(left, x);
          const offset = (y * width + x) * 4;
          const weight = overlapX * overlapY * data[offset + 3] / 255;
          visible += weight;
          red += data[offset] * weight;
          green += data[offset + 1] * weight;
          blue += data[offset + 2] * weight;
        }
      }
      // Fractional grid boundaries can round to opposite sides of an exact half.
      // Bound the rounding error by the coordinate magnitudes and cell dimensions.
      const tolerance = Number.EPSILON * 4 * (
        Math.max(1, Math.abs(left), Math.abs(right)) * (bottom - top) +
        Math.max(1, Math.abs(top), Math.abs(bottom)) * (right - left)
      );
      if (visible === 0 || visible + tolerance < area * 0.5) continue;
      red /= visible; green /= visible; blue /= visible;
      let closest = -1, distance = Infinity;
      for (const entry of colors) {
        const value = (red - entry.rgb[0]) ** 2 + (green - entry.rgb[1]) ** 2 + (blue - entry.rgb[2]) ** 2;
        if (value < distance) { distance = value; closest = entry.index; }
      }
      cells[row * cols + col] = closest;
    }
  }
  return createPattern({ width: cols, height: rows, cells, palette: provider, title: options.title || 'Generated Pattern' });
}

// Re-exports
export {
  // Geometry
  clamp,
  normalizeCrop,
  cropSourceRect,
  gridForLongSide,
  gridFromAspectAnchor,
  orientedSourceDimensions,
  fitGeometryMetrics,
  fitPatternInsideBoard,

  // Color
  clamp01,
  srgbLinear,
  linearSrgb,
  hexToRgb,
  rgbToHex,
  rgbToOklab,
  labDistance,
  rgbToCielab,
  deltaE2000,
  visiblyChromaticRgb,
  preparePaletteColor,

  // Palette
  MARD_PALETTE_SOURCE,
  MARD_SERIES,
  MARD_221_DATA,
  PALETTE,
  LEGACY_64_DATA,
  LEGACY_64_HEX,
  LEGACY_TO_MARD,
  DEFAULT_PALETTE_PROVIDER_ID,
  PALETTE_PROVIDERS,
  getPaletteProvider,
  registerPaletteProvider,
  createCustomPalette,

  // Analysis
  analyzeLineArtSubject,
  analyzeSourceComplexity,
  recommendDocumentGrid,
  recommendAutoHdSettings,

  // Quantize
  quantizePixels,

  // Pattern
  embedPatternGrid,
  occupiedBounds,
  assessPatternQuality,
  analyzePattern,
  createPattern,
  serializePattern,
  parsePattern,
  deserializePattern,
  validatePattern,
  despeckleGrid,
  replaceGridColor,
};
