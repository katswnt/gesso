#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseWindowAssignment } from './lib/vision-inventory.mjs';

const root = process.cwd();
const output = resolve(root, process.argv[2] || 'data/incoming/vision-calibration/rich-existing-teaching-gallery.html');
const load = (path, key) => parseWindowAssignment(readFileSync(resolve(root, path), 'utf8'), key);

const pool = load('data/pool.js', 'window.ARTEFACTUM_POOL');
const teaching = load('data/teach-works.js', 'window.ARTEFACTUM_CUES.work');
const hotspots = load('data/hotspots.js', 'window.ARTEFACTUM_HOTSPOTS');
const poolById = new Map(pool.map(work => [work.id, work]));

const lengthOf = value => typeof value === 'string' ? value.trim().length : 0;
const rows = Object.entries(teaching).flatMap(([id, record]) => {
  const work = poolById.get(id);
  if (!work) return [];
  const guide = Array.isArray(record.guide) ? record.guide : [];
  const notes = Array.isArray(record.notes) ? record.notes : [];
  const pins = Array.isArray(hotspots[id]) ? hotspots[id] : [];
  if (guide.length < 7 || notes.length < 4) return [];

  const guideChars = guide.reduce((sum, item) => sum + lengthOf(item.q) + lengthOf(item.a), 0);
  const noteChars = notes.reduce((sum, item) => sum + lengthOf(item.head) + lengthOf(item.body), 0);
  const score = Math.min(guide.length, 20) * 500
    + Math.min(notes.length, 12) * 300
    + Math.min(pins.length, 8) * 160
    + Math.min(guideChars, 6000)
    + Math.min(noteChars, 3500);

  return [{
    id,
    title: work.title || 'Untitled',
    artist: work.artist || 'Unknown artist',
    date: work.y ?? null,
    place: work.place || work.region || '',
    medium: work.medium || '',
    image: work.img || '',
    why: record.why || '',
    cues: Array.isArray(record.cues) ? record.cues : [],
    guide,
    notes,
    pins,
    stats: {
      questions: guide.length,
      notes: notes.length,
      pins: pins.length,
      averageAnswerChars: Math.round(guide.reduce((sum, item) => sum + lengthOf(item.a), 0) / guide.length),
    },
    score,
  }];
});

rows.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

// The point is editorial calibration, not a word-count contest. Start with the richest
// records, but keep the set broad enough to compare paintings, prints, manuscripts,
// sculpture, metalwork, and ceramics from different traditions.
const selected = [];
const artistCounts = new Map();
for (const row of rows) {
  const artistKey = row.artist || 'Unknown artist';
  if ((artistCounts.get(artistKey) || 0) >= 2) continue;
  selected.push(row);
  artistCounts.set(artistKey, (artistCounts.get(artistKey) || 0) + 1);
  if (selected.length === 30) break;
}

const json = JSON.stringify(selected).replaceAll('</script', '<\\/script');
const generated = new Date().toISOString();
const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Gesso — rich existing teaching examples</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-stone-100 text-stone-950 antialiased">
  <header class="border-b border-stone-300 bg-white">
    <div class="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <p class="mb-2 text-sm font-semibold text-amber-800">Editorial calibration · existing site content</p>
      <h1 class="max-w-4xl text-balance text-3xl font-semibold sm:text-4xl">Thirty of Gesso’s richest current study guides and note sets</h1>
      <p class="mt-3 max-w-3xl text-pretty text-stone-600">These are selected mechanically from the live legacy content for depth, note coverage, and pin coverage, with no claim that every fact is correct. Use them to identify the teaching voice and structures worth preserving.</p>
      <p class="mt-2 text-sm tabular-nums text-stone-500">Generated ${generated} · ${selected.length} works · source files unchanged</p>
    </div>
  </header>

  <div class="sticky top-0 z-10 border-b border-stone-300 bg-stone-100">
    <div class="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
      <label class="min-w-60 flex-1">
        <span class="sr-only">Search works</span>
        <input id="search" type="search" placeholder="Search title, artist, question, or note…" class="w-full rounded-md border border-stone-400 bg-white px-3 py-2 text-sm focus:border-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-700">
      </label>
      <button id="expand" class="rounded-md border border-stone-400 bg-white px-3 py-2 text-sm font-medium hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-amber-700">Expand all</button>
      <button id="collapse" class="rounded-md border border-stone-400 bg-white px-3 py-2 text-sm font-medium hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-amber-700">Collapse all</button>
      <button id="copy" class="rounded-md bg-amber-800 px-3 py-2 text-sm font-medium text-white hover:bg-amber-900 focus:outline-none focus:ring-2 focus:ring-amber-700 focus:ring-offset-2">Copy shortlist (<span id="count" class="tabular-nums">0</span>)</button>
      <span id="status" aria-live="polite" class="text-sm text-stone-600"></span>
    </div>
  </div>

  <main id="gallery" class="mx-auto grid max-w-7xl gap-5 px-4 py-6 sm:px-6"></main>

  <script>
    const works = ${json};
    const gallery = document.querySelector('#gallery');
    const escapeHtml = value => String(value ?? '').replace(/[&<>\"]/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[character]));
    const nl = value => escapeHtml(value).replaceAll('\\n', '<br>');
    const meta = work => [work.artist, work.date, work.place, work.medium].filter(Boolean).join(' · ');

    function render() {
      gallery.innerHTML = works.map((work, index) => {
        const noteByNumber = new Map(work.notes.map((note, noteIndex) => [noteIndex + 1, note]));
        const pinMarkup = work.pins.map(pin => {
          const note = noteByNumber.get(pin.n);
          const label = note?.head ? 'Note ' + pin.n + ': ' + note.head : 'Pin ' + pin.n;
          return '<span aria-label="' + escapeHtml(label) + '" title="' + escapeHtml(label) + '" class="absolute grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white bg-amber-800 text-xs font-bold text-white shadow" style="left:' + Number(pin.x) + '%;top:' + Number(pin.y) + '%">' + escapeHtml(pin.n) + '</span>';
        }).join('');
        const guides = work.guide.map((item, itemIndex) => '<li class="border-t border-stone-200 py-4 first:border-t-0 first:pt-0"><p class="text-pretty font-semibold"><span class="mr-2 text-stone-400">' + (itemIndex + 1) + '.</span>' + escapeHtml(item.q) + '</p><p class="mt-2 text-pretty leading-7 text-stone-700">' + nl(item.a) + '</p></li>').join('');
        const notes = work.notes.map((note, noteIndex) => '<li class="border-t border-stone-200 py-4 first:border-t-0 first:pt-0"><p class="text-pretty font-semibold"><span class="mr-2 inline-grid size-6 place-items-center rounded-full bg-amber-800 text-xs text-white">' + (noteIndex + 1) + '</span>' + escapeHtml(note.head) + '</p><p class="mt-2 text-pretty leading-7 text-stone-700">' + nl(note.body) + '</p>' + (Number.isFinite(note.x) ? '<p class="mt-1 text-xs tabular-nums text-stone-500">Embedded note coordinate: ' + note.x + '%, ' + note.y + '%</p>' : '') + '</li>').join('');
        const cues = work.cues.map(cue => '<li class="text-pretty leading-6">' + escapeHtml(cue) + '</li>').join('');
        const searchText = [work.title, work.artist, work.why, ...work.cues, ...work.guide.flatMap(x => [x.q,x.a]), ...work.notes.flatMap(x => [x.head,x.body])].join(' ').toLowerCase();
        return '<details open data-search="' + escapeHtml(searchText) + '" class="overflow-hidden rounded-lg border border-stone-300 bg-white shadow-sm">'
          + '<summary class="cursor-pointer list-none px-5 py-5 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-amber-700">'
          + '<div class="flex flex-wrap items-start justify-between gap-4"><div class="min-w-0"><p class="mb-1 text-xs font-semibold text-amber-800">#' + (index + 1) + ' by richness · ' + escapeHtml(work.id) + '</p><h2 class="text-balance text-xl font-semibold">' + escapeHtml(work.title) + '</h2><p class="mt-1 text-pretty text-sm text-stone-600">' + escapeHtml(meta(work)) + '</p></div>'
          + '<div class="flex items-center gap-4"><p class="text-right text-sm tabular-nums text-stone-600">' + work.stats.questions + ' questions · ' + work.stats.notes + ' notes · ' + work.stats.pins + ' pins<br>avg. answer ' + work.stats.averageAnswerChars + ' characters</p><label class="flex items-center gap-2 rounded-md border border-stone-300 px-3 py-2 text-sm font-medium" onclick="event.stopPropagation()"><input class="shortlist size-4 accent-amber-800" type="checkbox" value="' + escapeHtml(work.id) + '" data-title="' + escapeHtml(work.title) + '">Like this one</label></div></div></summary>'
          + '<div class="border-t border-stone-200 p-5"><div class="grid items-start gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">'
          + '<div class="lg:sticky lg:top-24"><div class="relative overflow-hidden rounded-md bg-stone-200"><img loading="lazy" src="' + escapeHtml(work.image) + '" alt="' + escapeHtml(work.title) + '" class="max-h-[70dvh] w-full object-contain">' + pinMarkup + '</div>'
          + '<div class="mt-5 rounded-md bg-stone-100 p-4"><h3 class="font-semibold">Why this work</h3><p class="mt-2 text-pretty leading-7 text-stone-700">' + nl(work.why) + '</p></div>'
          + '<details class="mt-3 rounded-md border border-stone-300 p-4"><summary class="cursor-pointer font-semibold">Identification cues (' + work.cues.length + ')</summary><ul class="mt-3 list-disc space-y-2 pl-5 text-stone-700">' + cues + '</ul></details></div>'
          + '<div class="grid gap-6"><section><h3 class="mb-3 text-lg font-semibold">Study guide</h3><ol>' + guides + '</ol></section><section><h3 class="mb-3 text-lg font-semibold">Look-closer notes and hotspots</h3><ol>' + notes + '</ol></section></div>'
          + '</div></div></details>';
      }).join('');
    }

    render();
    const cards = () => [...gallery.querySelectorAll('details[data-search]')];
    document.querySelector('#search').addEventListener('input', event => {
      const query = event.target.value.trim().toLowerCase();
      cards().forEach(card => { card.hidden = query && !card.dataset.search.includes(query); });
    });
    document.querySelector('#expand').addEventListener('click', () => cards().filter(card => !card.hidden).forEach(card => { card.open = true; }));
    document.querySelector('#collapse').addEventListener('click', () => cards().filter(card => !card.hidden).forEach(card => { card.open = false; }));
    gallery.addEventListener('change', event => {
      if (!event.target.matches('.shortlist')) return;
      document.querySelector('#count').textContent = gallery.querySelectorAll('.shortlist:checked').length;
    });
    document.querySelector('#copy').addEventListener('click', async () => {
      const selected = [...gallery.querySelectorAll('.shortlist:checked')].map(input => input.dataset.title + ' — ' + input.value);
      const status = document.querySelector('#status');
      if (!selected.length) { status.textContent = 'Choose at least one work first.'; return; }
      try {
        await navigator.clipboard.writeText(selected.join('\\n'));
        status.textContent = 'Shortlist copied.';
      } catch {
        status.textContent = 'Clipboard blocked for local files; your selections remain checked.';
      }
    });
  </script>
</body>
</html>`;

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, html);
console.log(`wrote ${output}`);
console.log(`selected ${selected.length} of ${rows.length} rich candidates`);
