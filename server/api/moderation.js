// Display-name moderation for the public leaderboard. Shared server helper (not an endpoint; not in api/).
//
// Deliberately small and conservative: it blocks slurs, sexual terms and staff impersonation after
// normalizing case, accents, spacing/punctuation and common digit/symbol substitutions. A blocked name is never
// shown; callers fall back to the device's default artist handle. It is a launch-week safety net, not a
// complete moderation system — the owner can extend the lists.
const SUBSTITUTIONS = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g', '@': 'a', $: 's', '!': 'i', '|': 'i', '+': 't' };

// Matched anywhere inside the normalized name. Only words with no innocent substrings belong here — artist
// and place names matter in this game ("Canaletto", "Dickens", "Hitchcock", "Shitao" must stay allowed).
const CONTAINS = [
  'nigger', 'nigga', 'faggot', 'tranny', 'wetback', 'cunt', 'whore', 'slut', 'rapist', 'heilhitler', 'siegheil',
  'pedophil', 'paedophil', 'molest', 'porn', 'fuck', 'bullshit', 'shithead', 'motherf', 'asshole', 'bitch', 'jizz',
  'wank', 'retard', 'dickhead', 'cocksuck', 'pussy',
];
// Matched only as the whole normalized name (too common inside innocent names to match as substrings).
const EXACT = [
  'ass', 'fag', 'hoe', 'sex', 'cum', 'anal', 'dick', 'cock', 'tits', 'boob', 'boobs', 'penis', 'vagina', 'rape', 'nazi',
  'hitler', 'kkk', 'coon', 'spic', 'chink', 'gook', 'kike', 'dyke', 'pedo', 'shit', 'twat',
  'admin', 'administrator', 'moderator', 'mod', 'gesso', 'official', 'staff', 'katswint',
];

export function normalizeName(name) {
  return String(name || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[0134578@$!|+9]/g, ch => SUBSTITUTIONS[ch] || ch)
    .replace(/[^a-z]/g, '')
    .replace(/(.)\1{2,}/g, '$1$1'); // "fuuuuck" -> "fuuck"; still caught below via the collapsed form
}

export function isBlockedName(name) {
  const n = normalizeName(name);
  if (!n) return false;
  const collapsed = n.replace(/(.)\1+/g, '$1'); // "fuuck" -> "fuck", "shiit" -> "shit"
  if (EXACT.includes(n) || EXACT.includes(collapsed)) return true;
  return CONTAINS.some(w => n.includes(w) || collapsed.includes(w.replace(/(.)\1+/g, '$1')));
}
