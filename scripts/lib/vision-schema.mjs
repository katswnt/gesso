// Vision completion / approved-patch STRICT schemas — dependency-free (no crypto/fs/sharp/network) ON PURPOSE so the
// dependency-free ledger contract (vision-ledger.mjs) can cross-validate evidence with the SAME validator the merge
// uses, and check-pool can share it without loading the image broker. scripts/lib/vision-run.mjs re-exports these.
export const ENUMS = {
  'image.issue': ['none', 'wrong-art', 'low-res', 'other'],
  imageQuality: ['good', 'poor'],
  framing: ['ok', 'cropped', 'detail', 'lost'],
  'fields.styleKind': ['culture', 'movement', 'period', 'school', 'tradition', 'genre'],
};
const PLAYER_TEXT = 500;                                    // max len for player-facing copy
const CTRL = /[\u0000-\u001f\u007f]/;                       // control chars (also excludes tab/newline in one-line copy)
const badText = (s, max) => typeof s !== 'string' || s.length > max || CTRL.test(s) || /[<>]/.test(s); // no control chars, no HTML angle brackets
const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const only = (obj, keys) => !!obj && typeof obj === 'object' && Object.keys(obj).every(k => keys.includes(k));
const idOk = (id) => typeof id === 'string' && /^[\w:.\/-]{1,200}$/.test(id);
function notesOk(v) {
  if (!Array.isArray(v) || v.length > 12) return false;
  let pins = 0;
  for (const n of v) {
    if (!n || typeof n !== 'object' || !only(n, ['head', 'body', 'x', 'y'])) return false;
    if (badText(n.head, 80) || badText(n.body, 600)) return false;
    if (n.head.trim() === '' || n.body.trim() === '') return false;   // reject BLANK head/body (empty strings pass badText)
    const hx = 'x' in n, hy = 'y' in n; if (hx !== hy) return false;   // a pin needs BOTH x and y (x-without-y rejected)
    if (hx) { pins++; if (!finite(n.x) || n.x < 0 || n.x > 100 || !finite(n.y) || n.y < 0 || n.y > 100) return false; }
  }
  return pins <= 12;
}
// no noPins+pins contradiction: a completion/patch that declares noPins:true must not carry any pinned note
const noPinsConsistent = (o) => !(o && o.noPins === true && Array.isArray(o.notes) && o.notes.some(n => n && 'x' in n));
// per-field validators — shared by the full-completion schema AND the approved-patch (subset) schema
const FIELD = {
  image: v => !!v && typeof v === 'object' && only(v, ['ok', 'issue', 'reason', 'suggestedUrl']) && typeof v.ok === 'boolean'
    && ENUMS['image.issue'].includes(v.issue) && (v.ok === (v.issue === 'none'))   // ok:true ⟺ issue:'none' — reject {ok:true,issue:'wrong-art'} and {ok:false,issue:'none'}
    && !badText(v.reason, PLAYER_TEXT)
    && (v.suggestedUrl === null || (typeof v.suggestedUrl === 'string' && v.suggestedUrl.length <= PLAYER_TEXT)),
  playable: v => typeof v === 'boolean',
  playableReason: v => !badText(v, PLAYER_TEXT),
  imageQuality: v => ENUMS.imageQuality.includes(v),
  qualityReason: v => !badText(v, PLAYER_TEXT),
  framing: v => ENUMS.framing.includes(v),
  mediumLegible: v => typeof v === 'boolean',
  fields: v => !!v && typeof v === 'object' && !Array.isArray(v) && only(v, ['style', 'styleKind', 'medium'])
    && (v.style == null || !badText(v.style, 120)) && (v.styleKind == null || ENUMS['fields.styleKind'].includes(v.styleKind)) && (v.medium == null || !badText(v.medium, 120)),
  notes: notesOk,
  noPins: v => typeof v === 'boolean',
};
const REQUIRED = ['image', 'playable', 'imageQuality', 'framing', 'mediumLegible', 'notes'];
const TOP_KEYS = ['id', ...Object.keys(FIELD)];

// Full completion: every REQUIRED field present + valid; no extra keys. Fail-closed.
export function validateCompletion(o) {
  const e = [];
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { ok: false, errors: ['not an object'] };
  if (!only(o, TOP_KEYS)) e.push('unexpected top-level key');
  if (!idOk(o.id)) e.push('id');
  for (const k of REQUIRED) if (!(k in o)) e.push(`missing ${k}`);
  for (const k of Object.keys(FIELD)) if (k in o && o[k] !== undefined && !FIELD[k](o[k])) e.push(k);
  if (!noPinsConsistent(o)) e.push('noPins:true contradicts pinned notes');
  return e.length ? { ok: false, errors: e } : { ok: true, value: o };
}

// Approved PATCH: a NONEMPTY subset of completion fields (id required); validates only the included fields — so a
// human can approve just {playable:false} without supplying the other five. Unknown keys / empty patch rejected.
export function validateApprovedPatch(o) {
  const e = [];
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { ok: false, errors: ['not an object'] };
  if (!only(o, TOP_KEYS)) e.push('unexpected key');
  if (!idOk(o.id)) e.push('id');
  const present = Object.keys(o).filter(k => k !== 'id');
  if (!present.length) e.push('empty patch (nothing approved)');
  for (const k of present) { if (!FIELD[k]) e.push(`unknown field ${k}`); else if (!FIELD[k](o[k])) e.push(k); }
  if (!noPinsConsistent(o)) e.push('noPins:true contradicts pinned notes');
  return e.length ? { ok: false, errors: e } : { ok: true, value: o };
}
