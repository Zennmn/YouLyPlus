import {
    loadSettings,
    saveSettings,
    updateSettings,
    updateCacheSize,
    clearCache,
    setupSettingsMessageListener
} from '../lib/settingsManager.js';
import { initRipple, initSwitches, showSnackbar } from '../lib/uiUtils.js';

const t = (key, fallback = '') => {
    try {
        return (typeof msg === 'function' ? msg(key) : '') || fallback;
    } catch {
        return fallback;
    }
};

const controls = [
    { id: 'lyEnabled', key: 'isEnabled', type: 'checkbox' },
    { id: 'appleMusicAMLL', key: 'appleMusicAMLL', type: 'checkbox' },
    { id: 'appleMusicAMLLBackground', key: 'appleMusicAMLLBackground', type: 'checkbox' },
    { id: 'appleMusicDisplayMode', key: 'appleMusicDisplayMode', type: 'value' },
    { id: 'appleMusicTitleCorrection', key: 'appleMusicTitleCorrection', type: 'value' },
    { id: 'largerTextMode', key: 'largerTextMode', type: 'value' },
    { id: 'wordByWord', key: 'wordByWord', type: 'checkbox' },
    { id: 'hidePhoneticDup', key: 'hidePhoneticDup', type: 'checkbox' },
    { id: 'lightweight', key: 'lightweight', type: 'checkbox' }
];

function updatePopupUI(settings) {
    if (!settings) return;
    for (const control of controls) {
        const element = document.getElementById(control.id);
        if (!element) continue;
        if (control.type === 'checkbox') element.checked = !!settings[control.key];
        else element.value = settings[control.key] ?? '';
    }
}

function initTabs() {
    const tabs = document.querySelectorAll('.tab');
    const panels = document.querySelectorAll('.tab-content');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(item => {
                item.classList.toggle('active', item === tab);
                item.setAttribute('aria-selected', item === tab ? 'true' : 'false');
            });
            panels.forEach(panel => panel.classList.toggle('active', panel.id === tab.dataset.tab));
        });
    });
}

function initRowClickListeners() {
    document.querySelectorAll('.setting-item.has-switch').forEach(row => {
        row.addEventListener('click', event => {
            if (event.target.closest('input, button, a, select, .m3-switch')) return;
            const checkbox = row.querySelector('.m3-switch input[type="checkbox"]');
            if (!checkbox) return;
            checkbox.checked = !checkbox.checked;
            checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        });
    });
}

async function savePopupSetting(key, value) {
    updatePopupUI(updateSettings({ [key]: value }));
    try {
        await saveSettings();
        showSnackbar(t('msgSettingsSaved', 'Settings saved. Apple Music lyrics will refresh automatically.'));
    } catch {
        showSnackbar(t('msgSettingsSaveFailed', 'Could not save settings. Try again.'), true);
    }
}

function bindControls() {
    for (const control of controls) {
        const element = document.getElementById(control.id);
        if (!element) continue;
        const eventName = control.type === 'checkbox' || element.tagName === 'SELECT' ? 'change' : 'input';
        element.addEventListener(eventName, () => {
            const value = control.type === 'checkbox' ? element.checked : element.value;
            savePopupSetting(control.key, value);
        });
    }
}

function initCacheControls() {
    document.getElementById('clearCache')?.addEventListener('click', async () => {
        const result = await clearCache('all');
        if (result?.success) {
            showSnackbar(t('msgCacheCleared', 'Cache cleared successfully!'));
            updateCacheSize();
        } else {
            showSnackbar(t('msgCacheClearFailed', 'Failed to clear cache.'), true);
        }
    });

    document.getElementById('refreshCache')?.addEventListener('click', async () => {
        await updateCacheSize();
        showSnackbar(t('msgCacheRefreshed', 'Cache info refreshed.'));
    });
}

window.addEventListener('YOUPLUS_SETTINGS_SAVE_FAILED', () => {
    showSnackbar(t('msgSettingsSaveFailed', 'Could not save settings. Try again.'), true);
});

document.addEventListener('DOMContentLoaded', async () => {
    initRipple();
    initSwitches();
    initTabs();
    initRowClickListeners();
    initCacheControls();
    const settings = await loadSettings();
    updatePopupUI(settings);
    bindControls();
    setupSettingsMessageListener(updatePopupUI);
    await updateCacheSize();
});
