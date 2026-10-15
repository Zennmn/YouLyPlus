// Local test fixture: uses the actual packaged content scripts with a simulated MusicKit instance.
const previewAssetRevision = Date.now();
const extensionURL = path => {
  const url = new URL(`/@fs/${__LYPLUS_ROOT__}/${path}`, location.origin);
  url.searchParams.set('preview', String(previewAssetRevision));
  return url.href;
};
const listeners = new Map();
const storageListeners = [];
const storedSettings = { blurInactive: true, wordByWord: true, appleMusicAMLLBackground: true };
// Share font preferences with the settings page's local development storage.
try {
  const saved = JSON.parse(localStorage.getItem('youly_mock_storage') || '{}');
  if (typeof saved.appleMusicPlayerFont === 'string') storedSettings.appleMusicPlayerFont = saved.appleMusicPlayerFont;
  if (saved.appleMusicPlayerFontFile) storedSettings.appleMusicPlayerFontFile = saved.appleMusicPlayerFontFile;
} catch { /* Ignore malformed development-only storage. */ }
let track = 0;
const titles = ['夜航', '山海之间', '一封未寄出的信', '纯音乐'];
const texts = ['晚风轻轻掠过海面', '月光落在你的肩', '我们沿着星光向前', '把城市留在身后', '让所有喧嚣都走远', '这一刻只听见心跳', '穿过漫长的黑夜', '在黎明之前靠岸', '你是我归航的方向', '也是不曾熄灭的光'];
const songItem = () => ({ id: String(track + 1), attributes: { name: titles[track], artistName: 'YouLy+ 演示', albumName: 'Night Voyage', durationInMillis: 75000, artwork: { url: new URL('/cover.svg', location.origin).href }, playParams: { id: String(track + 1), kind: 'songs' }, hasLyrics: false } });
const emit = name => (listeners.get(name) || []).forEach(callback => callback());
const music = {
  nowPlayingItem: songItem(), isPlaying: false, currentPlaybackTime: 15.2, currentPlaybackDuration: 75, volume: .6, shuffleMode: 0, repeatMode: 0,
  addEventListener(name, callback) { listeners.set(name, [...(listeners.get(name) || []), callback]); },
  removeEventListener(name, callback) { listeners.set(name, (listeners.get(name) || []).filter(value => value !== callback)); },
  async play() { this.isPlaying = true; emit('playbackStateDidChange'); },
  async pause() { this.isPlaying = false; emit('playbackStateDidChange'); },
  async seekToTime(value) { this.currentPlaybackTime = value; emit('playbackTimeDidChange'); },
  async skipToNextItem() { track = (track + 1) % titles.length; this.nowPlayingItem = songItem(); this.currentPlaybackTime = 0; emit('nowPlayingItemDidChange'); },
  async skipToPreviousItem() { track = (track + titles.length - 1) % titles.length; this.nowPlayingItem = songItem(); this.currentPlaybackTime = 0; emit('nowPlayingItemDidChange'); },
};
window.MusicKit = { getInstance: () => music, PlayerRepeatMode: { none: 0, one: 1, all: 2 }, PlayerShuffleMode: { off: 0, songs: 1 } };
setInterval(() => { if (music.isPlaying) music.currentPlaybackTime = Math.min(75, music.currentPlaybackTime + .1); }, 100);

const fixtureLyrics = (id) => ({
  type: id === '3' ? 'None' : id === '2' ? 'Line' : 'Word', provider: 'kpoe', metadata: { source: 'YouLy+ Demo' },
  data: texts.map((text, index) => ({ text, translatedText: ['The evening breeze crosses the sea', 'Moonlight falls on your shoulders', 'We follow the light of the stars'][index % 3], startTime: 1 + index * 4.6, endTime: 5 + index * 4.6, duration: 4, element: { singer: index === 6 ? 'v2' : 'v1' }, syllabus: [...text].map((word, i) => ({ text: word, time: Math.round((1 + index * 4.6 + i * .42) * 1000), duration: 420 })) })),
});
window.browser = {
  runtime: { getURL: extensionURL, async sendMessage(message) {
    if (message.type === 'FETCH_LYRICS' || message.type === 'SWITCH_LYRICS_PROVIDER') return message.songInfo?.appleId === '4' ? { success: false } : { success: true, lyrics: fixtureLyrics(message.songInfo?.appleId), availableProviders: ['kpoe', 'lrclib'] };
    if (message.type === 'GET_LYRICS_OFFSET') return { offsetMs: storedSettings[`lyplusApplePlayerOffset_${message.songInfo?.appleId}`] || 0 };
    if (message.type === 'SAVE_LYRICS_OFFSET') { storedSettings[`lyplusApplePlayerOffset_${message.songInfo?.appleId}`] = message.offsetMs; return { success: true }; }
    if (message.type === 'GET_AVAILABLE_PROVIDERS') return { availableProviders: ['kpoe', 'lrclib'] };
    return { success: false };
  } },
  storage: { local: { async get(defaults) { return { ...defaults, ...storedSettings }; }, async set(values) {
    const changes = Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { oldValue: storedSettings[key], newValue }]));
    Object.assign(storedSettings, values); storageListeners.forEach(callback => callback(changes, 'local'));
  } }, onChanged: { addListener(callback) { storageListeners.push(callback); } } },
};
const open = () => {
  if (document.querySelector('article')) return;
  const modal = document.createElement('article'); modal.dataset.testid = 'lyrics-fullscreen-modal';
  modal.innerHTML = '<div class="preview-native"><h1>Apple Music 原生界面占位</h1><p>返回 AMLL 可恢复自定义播放器</p><button type="button" data-testid="close-button">关闭播放器</button></div>';
  modal.querySelector('button').onclick = () => modal.remove(); document.body.appendChild(modal);
};
document.getElementById('preview-open').onclick = open;
open();
const manifest = await fetch(extensionURL('manifest.json')).then(response => response.json());
const scripts = manifest.content_scripts.find(entry => entry.matches.some(match => match.includes('music.apple.com'))).js;
for (const path of scripts) {
  await new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = extensionURL(path); script.onload = resolve; script.onerror = reject; document.head.appendChild(script); });
}
