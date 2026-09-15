// Pure helpers for the offline Pass-B editorial packet. These describe reviewable hotspot proposals;
// they do not mutate evidence, accept an approval, or write production data.
import { EVIDENCE_AXES } from './vision-content-schema.mjs';
import { b4Lineage } from './pass-b-b4-delta.mjs';

export const EDITORIAL_REVIEW_VERSION = 'passBEditorialReview/2';

const firstSentence = text => String(text || '').split(/(?<=[.!?])\s+/)[0];

function groundingById(body) {
  const out = new Map();
  for (const axis of EVIDENCE_AXES) for (const item of (body?.evidence?.[axis] || [])) {
    out.set(item.evidenceId, { axis, title: item.feature, description: item.why });
  }
  for (const item of (body?.richDescriptors?.visual?.delights || [])) {
    out.set(item.delightId, { axis: 'delight', title: firstSentence(item.note), description: item.note });
  }
  return out;
}

const suppressionMessage = reason => ({
  'near-full-frame-bbox': 'Not published: its evidence box covered most of the image, so a center pin would be misleading.',
  'missing-localized-anchor': 'Not published: no usable location was supplied.',
  'duplicate-evidence-ref': 'Not published: another hotspot already describes the same evidence.',
  'near-duplicate-pin': 'Not published: it landed almost on top of another proposed hotspot.',
}[reason] || `Not published: ${reason || 'no publishable location'}.`);

export function hotspotReviewRows({ delta, body, hydration }) {
  const placements = new Map((hydration?.hotspots?.placements || []).map(row => [row.deltaIndex, row]));
  const suppressed = new Map((hydration?.hotspots?.suppressed || []).map(row => [row.deltaIndex, row]));
  const bodyById = new Map((body?.hotspots || []).map(row => [row.hotspotId, row]));
  const grounding = groundingById(body);
  let suppressedOrdinal = 0;
  return b4Lineage(delta).hotspots.filter(row => row.survives).map(row => {
    const source = delta.hotspots[row.deltaIndex] || {};
    const placement = placements.get(row.deltaIndex) || null;
    const suppression = suppressed.get(row.deltaIndex) || null;
    if (!placement && !suppression) throw new Error(`hotspot delta[${row.deltaIndex}] has no hydration outcome`);
    const published = placement ? bodyById.get(placement.hotspotId) : null;
    if (placement && !published) throw new Error(`hotspot delta[${row.deltaIndex}] placement has no published body row`);
    const grounded = grounding.get(source.evidenceRef) || {};
    const label = published ? `P${published.rank}` : `S${++suppressedOrdinal}`;
    return {
      key: `delta-${row.deltaIndex}`,
      deltaIndex: row.deltaIndex,
      label,
      state: published ? 'published' : 'suppressed',
      action: source.action,
      role: source.role,
      ref: source.ref ?? null,
      evidenceRef: source.evidenceRef ?? null,
      title: published?.conciseText || grounded.title || `Hotspot ${label}`,
      description: published?.deepText || grounded.description || grounded.title || 'No description available.',
      evidenceAxis: grounded.axis || null,
      x: published?.x ?? null,
      y: published?.y ?? null,
      hotspotId: published?.hotspotId ?? null,
      placementMethod: placement?.method ?? null,
      suppressionReason: suppression?.reason ?? null,
      statusText: published
        ? `Published at ${published.x.toFixed(1)}%, ${published.y.toFixed(1)}% (${placement.method}).`
        : suppressionMessage(suppression?.reason),
    };
  });
}
