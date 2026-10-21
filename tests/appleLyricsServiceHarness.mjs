globalThis.self = globalThis;

const [
  { LyricsService },
  { SettingsManager },
  { state },
  { lyricsDB, localLyricsDB, offsetsDB },
  { appleMusicLyrics },
] = await Promise.all([
  import('../src/background/core/lyricsService.js'),
  import('../src/background/storage/settings.js'),
  import('../src/background/storage/state.js'),
  import('../src/background/storage/database.js'),
  import('../src/background/services/appleMusicLyricsService.js'),
]);

export function memory(initial = {}) {
  const values = { ...initial };
  return {
    values,
    get: async defaults => ({
      ...defaults,
      ...Object.fromEntries(Object.keys(defaults).filter(key => key in values).map(key => [key, values[key]])),
    }),
    set: async patch => { Object.assign(values, patch); },
  };
}

const defaultResolver = (provider, order) => ({
  provider: provider || order?.[0] || 'amll',
  data: [{ text: 'Lyric' }],
});
const defaultProviderOrder = globalThis.LYPLUS_DEFAULT_SETTINGS.appleMusicLyricsProviderOrder;
const defaultCacheStrategy = globalThis.LYPLUS_DEFAULT_SETTINGS.cacheStrategy;

export function lyricsHarness({
  storage = memory(),
  resolver = defaultResolver,
  oldOffsets = new Map(),
  providerOrder = defaultProviderOrder,
  cacheStrategy = defaultCacheStrategy,
} = {}) {
  const saved = {
    get: SettingsManager.get,
    set: SettingsManager.set,
    getLyricsSettings: SettingsManager.getLyricsSettings,
    databaseGet: lyricsDB.get,
    databaseSet: lyricsDB.set,
    databaseDelete: lyricsDB.delete,
    localGetAll: localLyricsDB.getAll,
    offsetGet: offsetsDB.get,
    rememberNative: appleMusicLyrics.rememberNative,
    provider: appleMusicLyrics.provider,
    resolve: appleMusicLyrics.resolve,
  };
  let order = providerOrder;
  let restored = false;

  SettingsManager.get = async keys => storage.get(keys);
  SettingsManager.set = async values => storage.set(values);
  SettingsManager.getLyricsSettings = async () => ({
    appleMusicLyricsProviderOrder: order,
    cacheStrategy,
  });
  lyricsDB.get = async () => null;
  lyricsDB.set = async () => {};
  lyricsDB.delete = async () => {};
  localLyricsDB.getAll = async () => [];
  offsetsDB.get = async key => oldOffsets.get(key);
  appleMusicLyrics.rememberNative = () => {};
  appleMusicLyrics.provider = async (provider, song, force, options) => resolver(provider, null, { song, force, options });
  appleMusicLyrics.resolve = async (song, force, nextOrder, options) => resolver(null, nextOrder, { song, force, options });
  state.clear();

  return {
    service: LyricsService,
    storage,
    getCached(key) { return state.getCached(key); },
    setProviderOrder(value) { order = value; },
    resetRuntime() {
      state.clear();
      LyricsService.localLyricsRevisions = new Map();
      LyricsService.cacheEpoch = 0;
    },
    restore() {
      if (restored) return;
      restored = true;
      SettingsManager.get = saved.get;
      SettingsManager.set = saved.set;
      SettingsManager.getLyricsSettings = saved.getLyricsSettings;
      lyricsDB.get = saved.databaseGet;
      lyricsDB.set = saved.databaseSet;
      lyricsDB.delete = saved.databaseDelete;
      localLyricsDB.getAll = saved.localGetAll;
      offsetsDB.get = saved.offsetGet;
      appleMusicLyrics.rememberNative = saved.rememberNative;
      appleMusicLyrics.provider = saved.provider;
      appleMusicLyrics.resolve = saved.resolve;
      state.clear();
    },
  };
}
