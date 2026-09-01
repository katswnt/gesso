// Deterministic, offline view generation for the recognition/inference pilot.
// Input MUST already be the G-03 broker's sanitized derivative. No URL or raw corpus bytes enter here.
import sharp from 'sharp';
import { sha256, VIEW_SPECS } from './recognition-pilot.mjs';

export const IMAGE_POLICY = Object.freeze({
  version: 'recognition-image/2',
  maxSide: 1568,
  patchSize: 28,
  maxVisualTokens: 1568,
  format: 'jpeg',
  quality: 90,
  chromaSubsampling: '4:4:4',
  interpolation: 'lanczos3',
  cropRounding: 'round-half-up',
  background: '#ffffff',
});

export function nativeImageSize(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error('invalid source dimensions');
  const fits = (w, h) => Math.ceil(w / IMAGE_POLICY.patchSize) * IMAGE_POLICY.patchSize <= IMAGE_POLICY.maxSide
    && Math.ceil(h / IMAGE_POLICY.patchSize) * IMAGE_POLICY.patchSize <= IMAGE_POLICY.maxSide
    && Math.ceil(w / IMAGE_POLICY.patchSize) * Math.ceil(h / IMAGE_POLICY.patchSize) <= IMAGE_POLICY.maxVisualTokens;
  if (fits(width, height)) return { width, height };
  const landscape = width >= height;
  const long = landscape ? width : height, short = landscape ? height : width;
  const aspect = long / short;
  let lo = 1, hi = Math.min(long, IMAGE_POLICY.maxSide) + 1;
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const candidateShort = Math.max(1, Math.round(mid / aspect));
    const w = landscape ? mid : candidateShort, h = landscape ? candidateShort : mid;
    if (fits(w, h)) lo = mid; else hi = mid;
  }
  const fittedShort = Math.max(1, Math.round(lo / aspect));
  return landscape ? { width: lo, height: fittedShort } : { width: fittedShort, height: lo };
}

const anchorPoint = (anchor, slackX, slackY) => ({
  center: [slackX / 2, slackY / 2],
  northwest: [slackX * 0.1, slackY * 0.1],
  northeast: [slackX * 0.9, slackY * 0.1],
  southwest: [slackX * 0.1, slackY * 0.9],
  southeast: [slackX * 0.9, slackY * 0.9],
}[anchor]);

async function canonicalRaster(input) {
  const md = await sharp(input, { failOn: 'warning', animated: false, limitInputPixels: 100_000_000 }).metadata();
  const swapsAxes = [5, 6, 7, 8].includes(md.orientation);
  const size = nativeImageSize(swapsAxes ? md.height : md.width, swapsAxes ? md.width : md.height);
  return sharp(input, { failOn: 'warning', animated: false, limitInputPixels: 100_000_000 })
    .rotate()
    .flatten({ background: IMAGE_POLICY.background })
    .toColourspace('srgb')
    .resize({ width: size.width, height: size.height, fit: 'fill', withoutEnlargement: true, kernel: IMAGE_POLICY.interpolation })
    .jpeg({ quality: IMAGE_POLICY.quality, chromaSubsampling: IMAGE_POLICY.chromaSubsampling, progressive: false, mozjpeg: false })
    .toBuffer();
}

export async function renderStudyView(input, spec, anchor = 'center') {
  const base = await canonicalRaster(input);
  const md = await sharp(base).metadata();
  let pipe = sharp(base, { failOn: 'warning' });
  if (spec.kind === 'crop') {
    const width = Math.max(1, Math.round(md.width * spec.fraction));
    const height = Math.max(1, Math.round(md.height * spec.fraction));
    const slackX = md.width - width, slackY = md.height - height;
    const point = anchorPoint(anchor, slackX, slackY);
    if (!point) throw new Error(`unknown anchor: ${anchor}`);
    // The crop is a view-window intervention, not an image-size intervention: rescale each nested
    // crop back to the canonical raster dimensions so API image-token size is held constant.
    pipe = pipe.extract({ left: Math.round(point[0]), top: Math.round(point[1]), width, height })
      .resize({ width: md.width, height: md.height, fit: 'fill', kernel: IMAGE_POLICY.interpolation });
  } else if (spec.kind === 'mirror') pipe = pipe.flop();
  else if (spec.kind === 'rotate') pipe = pipe.rotate(spec.degrees, { background: IMAGE_POLICY.background });
  else if (spec.kind === 'grayscale') pipe = pipe.grayscale();
  else if (spec.kind !== 'full') throw new Error(`unknown view kind: ${spec.kind}`);
  const buffer = await pipe
    .flatten({ background: IMAGE_POLICY.background })
    .toColourspace('srgb')
    .jpeg({ quality: IMAGE_POLICY.quality, chromaSubsampling: IMAGE_POLICY.chromaSubsampling, progressive: false, mozjpeg: false })
    .toBuffer();
  const out = await sharp(buffer).metadata();
  return { buffer, sha256: sha256(buffer), width: out.width, height: out.height, mime: 'image/jpeg', ext: 'jpg', view: spec.id, anchor };
}

export async function renderAllStudyViews(input, anchor = 'center') {
  const rows = [];
  for (const spec of VIEW_SPECS) rows.push(await renderStudyView(input, spec, anchor));
  return rows;
}
