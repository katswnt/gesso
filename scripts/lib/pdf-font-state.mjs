// Font association for the PDF glyph audit (VSD-092 review-3 finding 1). Pure: replays a pdf.js operator list.
// pdf.js glyphs carry no font reference, so the font each glyph is shown in is the font of the PDF graphics state at
// that point. This replays that state exactly as pdf.js emitted it: `q`/`Q` (save/restore) save and restore the
// selected font, a form XObject (paintFormXObjectBegin/End) runs in a saved state that is restored at its
// end, and an ExtGState `/Font` entry (setGState) selects a font without any `Tf`. Whenever the association cannot be
// established (no font selected, unbalanced restore or form end, an unreadable gs font entry, a text operator pdf.js
// should have normalized to showText) the glyphs fail closed as unauditable.
const UNKNOWN = why => ({ font: null, key: null, unknown: why });
export function fontStateReplay(OPS, fnArray, argsArray, lookup) {
  let cur = { font: null, key: null, unknown: null };
  const saves = [], forms = [], shown = [];
  const select = key => {
    if (typeof key !== 'string' || !key) return UNKNOWN('unreadable font selection');
    let font = null; try { font = lookup(key); } catch { font = null; }
    return { font, key, unknown: null };
  };
  const SHOW = new Set([OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText].filter(v => v != null));
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i], args = argsArray[i];
    if (fn === OPS.save) saves.push(cur);
    else if (fn === OPS.restore) cur = saves.length > (forms.length ? forms.at(-1) + 1 : 0) ? saves.pop() : UNKNOWN('unbalanced restore');
    else if (fn === OPS.paintFormXObjectBegin) { forms.push(saves.length); saves.push(cur); }
    else if (fn === OPS.paintFormXObjectEnd) {
      if (!forms.length) { cur = UNKNOWN('unbalanced form end'); continue; }
      saves.length = forms.pop() + 1; cur = saves.pop();
    } else if (fn === OPS.setFont) cur = select(args?.[0]);
    else if (fn === OPS.setGState) {
      if (!Array.isArray(args?.[0])) { cur = UNKNOWN('unreadable graphics state'); continue; }
      for (const entry of args[0]) {
        if (!Array.isArray(entry)) { cur = UNKNOWN('unreadable graphics state'); continue; }
        if (entry[0] === 'Font') cur = Array.isArray(entry[1]) ? select(entry[1][0]) : UNKNOWN('unreadable graphics-state font');
      }
    } else if (SHOW.has(fn)) {
      if (fn !== OPS.showText || !Array.isArray(args?.[0])) { shown.push({ state: UNKNOWN('unnormalized text operator'), glyphs: [null] }); continue; }
      const glyphs = args[0].filter(g => g && typeof g === 'object');
      if (glyphs.length) shown.push({ state: cur, glyphs });
    }
  }
  return shown;
}
