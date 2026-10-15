export const APPLE_LYRICS_ORDER = ['amll', 'lunabeat', 'amlyrics', 'applemusic'];
export const APPLE_LYRICS_NAMES = { amll: 'AMLL TTML DB', lunabeat: 'LunaBeat', amlyrics: 'AmLyrics', applemusic: 'Apple Music' };
export function normalizeAppleLyricsOrder(value) {
  const order = value == null ? APPLE_LYRICS_ORDER : Array.isArray(value) ? value : String(value).split(',');
  return [...new Set(order.map(x => x.trim()).filter(x => APPLE_LYRICS_ORDER.includes(x) && x !== 'applemusic')), 'applemusic'];
}
