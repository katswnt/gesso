import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildVisionCoverage, parseWindowAssignment } from './vision-inventory.mjs';
import { auditLegacyVisionRecords } from './vision-legacy.mjs';

export const VISION_INVENTORY_FILES = Object.freeze({
  pool: 'data/pool.js',
  teach: 'data/teach-works.js',
  hotspots: 'data/hotspots.js',
  vision: 'data/vision.js',
  ledger: 'data/vision-audit.json',
  evidence: 'data/vision-evidence.json',
  noPins: 'data/no-pins-reviewed.json',
  daily: 'data/daily-order.js',
  guessability: 'data/guessability/scores.json',
  adaptiveProbe: 'data/guessability/probe-sonnet.json',
  ease: 'data/guessability/ease.json',
});

export function buildVisionInventoryFromFiles({ root = process.cwd(), asOf }) {
  const raw = Object.fromEntries(Object.entries(VISION_INVENTORY_FILES)
    .map(([key, path]) => [key, readFileSync(resolve(root, path), 'utf8')]));
  const inputHashes = Object.fromEntries(Object.entries(raw)
    .map(([key, value]) => [key, createHash('sha256').update(value).digest('hex')]));
  const parseJson = key => JSON.parse(raw[key]);
  const pool = parseWindowAssignment(raw.pool, 'window.ARTEFACTUM_POOL');
  const teach = parseWindowAssignment(raw.teach, 'window.ARTEFACTUM_CUES.work');
  const hotspots = parseWindowAssignment(raw.hotspots, 'window.ARTEFACTUM_HOTSPOTS');
  const vision = parseWindowAssignment(raw.vision, 'window.ARTEFACTUM_VISION');
  const daily = parseWindowAssignment(raw.daily, 'window.ARTEFACTUM_DAILY');
  const scores = parseJson('guessability');
  const probe = parseJson('adaptiveProbe');
  const ease = parseJson('ease');
  const legacyAudit = auditLegacyVisionRecords(vision);
  if (!legacyAudit.ok) throw new Error(`legacy vision no-discard audit failed:\n${JSON.stringify(legacyAudit, null, 2)}`);

  return {
    legacyAudit,
    coverage: buildVisionCoverage({
      pool, teach, hotspots, vision,
      ledger: parseJson('ledger'), evidence: parseJson('evidence'),
      noPins: parseJson('noPins'), daily,
      research: {
        guessability: scores.works || {},
        adaptiveProbe: (probe.works || []).map(row => row.id),
        ease: ease.works || {},
      },
      asOf,
      inputHashes,
    }),
  };
}
