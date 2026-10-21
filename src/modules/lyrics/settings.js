const pBrowser = typeof browser !== 'undefined' ? browser : chrome;
const defaultSettings = globalThis.LYPLUS_DEFAULT_SETTINGS;
let currentSettings = { ...defaultSettings };

function loadSettings(callback) {
    return storageLocalGet(defaultSettings).then(items => {
        currentSettings = { ...defaultSettings, ...items };
        callback?.();
    }).catch(error => {
        console.warn('YouLy+: could not load settings', error);
        callback?.();
    });
}

function updateSettings(values = {}) {
    const changedSettings = {};
    for (const [key, value] of Object.entries(values)) {
        if (!Object.hasOwn(defaultSettings, key)) continue;
        const next = value === undefined ? defaultSettings[key] : value;
        if (JSON.stringify(currentSettings[key]) !== JSON.stringify(next)) changedSettings[key] = next;
    }
    const changedKeys = Object.keys(changedSettings);
    if (!changedKeys.length) return;
    currentSettings = { ...currentSettings, ...changedSettings };
    window.dispatchEvent(new CustomEvent('YOUPLUS_SETTINGS_UPDATED', {
        detail: { settings: currentSettings, changedKeys }
    }));
}

pBrowser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const values = {};
    for (const [key, change] of Object.entries(changes)) {
        if (Object.hasOwn(defaultSettings, key)) values[key] = change.newValue;
    }
    updateSettings(values);
});
