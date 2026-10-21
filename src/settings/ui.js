import {
    loadSettings,
    saveSettings,
    updateSettings,
    getSettings,
    defaultSettings,
    pickSettings,
    updateCacheSize,
    clearCache,
    setupSettingsMessageListener,
    getLocalLyricsList,
    deleteLocalLyrics,
    getDictionaryStatus,
    downloadDictionary,
    deleteDictionary
} from '../lib/settingsManager.js';
import { initRipple, initSwitches, createSvgIcon } from '../lib/uiUtils.js';
import { APPLE_LYRICS_ORDER, APPLE_LYRICS_NAMES, normalizeAppleLyricsOrder } from '../lib/appleLyricsSources.js';
import { CustomLLMProvider, customLLMEndpoint } from '../background/services/translation/providers/CustomLLMProvider.js';
import { playerFontFamily } from '../lib/playerFont.js';
import { createImportedFontLoader, importPlayerFont, deleteImportedFont } from '../lib/importedPlayerFont.js';

const $ = id => document.getElementById(id);
const t = (key, fallback = '', substitutions) => {
    try {
        return (typeof msg === 'function' ? msg(key, substitutions) : '') || fallback;
    } catch {
        return fallback;
    }
};

let currentSettings = getSettings();
let draggedItem = null;
let draggedTouchItem = null;
const statusTimers = new Map();
const RESTART_REQUIRED_KEYS = new Set(['isEnabled', 'appleMusicAMLL']);
const TRANSLATION_STATUS = 'translation-save-status';
const PLAYBACK_STATUS = 'playback-save-status';
const ADVANCED_STATUS = 'advanced-save-status';
const FAILURE_MESSAGE = ['msgSettingsSaveFailed', 'Could not save settings. Try again.'];

const ICONS = {
    drag: 'M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
    delete: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
    music: 'M12 3v10.55A4 4 0 1 0 14 17V7h5V3h-7z'
};

const DEEPL_SUPPORTED_CODES = new Set([
    '', 'ace', 'af', 'sq', 'ar', 'an', 'hy', 'as', 'ay', 'az', 'ba', 'eu', 'be', 'bn', 'bho', 'bs', 'br',
    'bg', 'my', 'yue', 'ca', 'ceb', 'zh-CN', 'zh-TW', 'hr', 'cs', 'da', 'fa-AF', 'nl', 'en',
    'eo', 'et', 'fi', 'fr', 'gl', 'ka', 'de', 'el', 'gn', 'gu', 'ht', 'ha', 'he', 'hi', 'hu', 'is', 'ig', 'id', 'ga', 'it', 'ja', 'jv', 'pam',
    'kk', 'gom', 'ko', 'ku', 'ckb', 'ky', 'la', 'lv', 'ln', 'lt', 'lmo', 'lb', 'mk', 'mai', 'mg',
    'ms', 'ml', 'mt', 'mi', 'mr', 'mn', 'ne', 'no', 'oc', 'om', 'pag', 'ps', 'fa', 'pl', 'pt',
    'pa', 'qu', 'ro', 'ru', 'sa', 'sr', 'st', 'scn', 'sk', 'sl', 'es', 'su', 'sw', 'sv', 'tl', 'tg', 'ta', 'tt', 'te', 'th', 'ts', 'tn', 'tr', 'tk', 'uk',
    'ur', 'uz', 'vi', 'cy', 'wo', 'xh', 'yi', 'zu'
]);

function showStatus(elementId, message, isError = false) {
    const element = $(elementId);
    if (!element) return;
    clearTimeout(statusTimers.get(elementId));
    element.textContent = message;
    element.classList.toggle('error', isError);
    element.setAttribute('role', isError ? 'alert' : 'status');
    if (message) {
        statusTimers.set(elementId, setTimeout(() => {
            if (element.textContent === message) element.textContent = '';
        }, isError ? 6000 : 3500));
    }
}

function setHidden(id, hidden) {
    const element = $(id);
    if (!element) return;
    element.hidden = hidden;
    if (hidden) element.setAttribute('hidden', '');
    else element.removeAttribute('hidden');
}

const controlBindings = [
    { id: 'enabled', key: 'isEnabled', type: 'checkbox', statusId: PLAYBACK_STATUS },
    { id: 'apple-music-amll', key: 'appleMusicAMLL', type: 'checkbox', statusId: PLAYBACK_STATUS },
    { id: 'apple-music-background', key: 'appleMusicAMLLBackground', type: 'checkbox', statusId: PLAYBACK_STATUS },
    { id: 'apple-music-display-mode', key: 'appleMusicDisplayMode', type: 'value', statusId: PLAYBACK_STATUS },
    { id: 'apple-title-correction', key: 'appleMusicTitleCorrection', type: 'value', statusId: PLAYBACK_STATUS },
    { id: 'wordByWord', key: 'wordByWord', type: 'checkbox', statusId: PLAYBACK_STATUS },
    { id: 'larger-text-mode', key: 'largerTextMode', type: 'value', statusId: PLAYBACK_STATUS },
    { id: 'hide-phoneticdup', key: 'hidePhoneticDup', type: 'checkbox', statusId: PLAYBACK_STATUS },
    { id: 'lightweight', key: 'lightweight', type: 'checkbox', statusId: PLAYBACK_STATUS },
    { id: 'translation-provider', key: 'translationProvider', type: 'value', statusId: TRANSLATION_STATUS },
    { id: 'custom-translate-target', key: 'customTranslateTarget', type: 'value', statusId: TRANSLATION_STATUS },
    { id: 'gemini-api-key', key: 'geminiApiKey', type: 'value', statusId: TRANSLATION_STATUS, delay: 500 },
    { id: 'gemini-model', key: 'geminiModel', type: 'value', statusId: TRANSLATION_STATUS },
    { id: 'openrouter-api-key', key: 'openRouterApiKey', type: 'value', statusId: TRANSLATION_STATUS, delay: 500 },
    { id: 'openrouter-model', key: 'openRouterModel', type: 'value', statusId: TRANSLATION_STATUS, delay: 500 },
    { id: 'custom-llm-url', key: 'customLLMBaseUrl', type: 'value', statusId: TRANSLATION_STATUS, delay: 500 },
    { id: 'custom-llm-key', key: 'customLLMApiKey', type: 'value', statusId: TRANSLATION_STATUS, delay: 500 },
    { id: 'custom-llm-model', key: 'customLLMModel', type: 'value', statusId: TRANSLATION_STATUS, delay: 500 },
    { id: 'deepl-api-key', key: 'deeplApiKey', type: 'value', statusId: TRANSLATION_STATUS, delay: 500 },
    { id: 'romanization-provider', key: 'romanizationProvider', type: 'value', statusId: TRANSLATION_STATUS },
    { id: 'transliteration-target', key: 'transliterationTargetScript', type: 'value', statusId: TRANSLATION_STATUS },
    { id: 'gemini-romanization-model', key: 'geminiRomanizationModel', type: 'value', statusId: TRANSLATION_STATUS },
    { id: 'override-gemini-prompt', key: 'overrideGeminiPrompt', type: 'checkbox', statusId: TRANSLATION_STATUS },
    { id: 'custom-gemini-prompt', key: 'customGeminiPrompt', type: 'value', statusId: TRANSLATION_STATUS, delay: 500 },
    { id: 'override-gemini-romanize-prompt', key: 'overrideGeminiRomanizePrompt', type: 'checkbox', statusId: TRANSLATION_STATUS },
    { id: 'custom-gemini-romanize-prompt', key: 'customGeminiRomanizePrompt', type: 'value', statusId: TRANSLATION_STATUS, delay: 500 },
    { id: 'cache-strategy', key: 'cacheStrategy', type: 'value', statusId: ADVANCED_STATUS }
];

function failureStatusFor(key) {
    if (['cacheStrategy'].includes(key)) return ADVANCED_STATUS;
    if (/^(translationProvider|romanizationProvider|transliterationTargetScript|gemini|openRouter|customLLM|deepl|overrideGemini|customGemini|customTranslateTarget)/.test(key)) return TRANSLATION_STATUS;
    return PLAYBACK_STATUS;
}

function notifySaveFailure(key) {
    showStatus(failureStatusFor(key), t(...FAILURE_MESSAGE), true);
}

async function persistControl(control) {
    try {
        await saveSettings();
        const message = control.statusId === TRANSLATION_STATUS
            ? t('msgTranslationSettingsSaved', 'Translation settings saved and applied to the Apple Music player.')
            : control.statusId === ADVANCED_STATUS
                ? t('msgAdvancedSettingsSaved', 'Settings saved.')
                : t('msgPlaybackSettingsSaved', 'Playback settings saved and applied to Apple Music.');
        showStatus(control.statusId, message, false);
        if (RESTART_REQUIRED_KEYS.has(control.key)) showReloadNotification(control.key);
    } catch {
        notifySaveFailure(control.key);
    }
}

function debounceTask(task, delay) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => task(...args), delay);
    };
}

function bindSettingControls() {
    for (const control of controlBindings) {
        const element = $(control.id);
        if (!element) continue;
        const eventName = control.type === 'checkbox' || element.tagName === 'SELECT' ? 'change' : 'input';
        const stage = () => {
            const value = control.type === 'checkbox' ? element.checked : element.value;
            currentSettings = updateSettings({ [control.key]: value });
            applyConditionalVisibility(control.key === 'romanizationProvider');
        };
        if (control.delay) {
            const persistLater = debounceTask(() => persistControl(control), control.delay);
            element.addEventListener(eventName, () => {
                stage();
                persistLater();
            });
        } else {
            element.addEventListener(eventName, () => {
                stage();
                persistControl(control);
            });
        }
    }
}

function setValue(id, value) {
    const element = $(id);
    if (element) element.value = value ?? '';
}

function setChecked(id, value) {
    const element = $(id);
    if (element) element.checked = !!value;
}

function updateUI(settings) {
    currentSettings = { ...defaultSettings, ...pickSettings(settings) };
    setChecked('enabled', currentSettings.isEnabled);
    setChecked('apple-music-amll', currentSettings.appleMusicAMLL !== false);
    setChecked('apple-music-background', currentSettings.appleMusicAMLLBackground !== false);
    setValue('apple-music-display-mode', ['none', 'translate', 'romanize', 'both'].includes(currentSettings.appleMusicDisplayMode) ? currentSettings.appleMusicDisplayMode : 'none');
    setValue('apple-title-correction', ['off', 'original', 'cn', 'jp'].includes(currentSettings.appleMusicTitleCorrection) ? currentSettings.appleMusicTitleCorrection : 'off');
    setChecked('wordByWord', currentSettings.wordByWord);
    setValue('larger-text-mode', currentSettings.largerTextMode === 'romanization' ? 'romanization' : 'lyrics');
    setChecked('hide-phoneticdup', currentSettings.hidePhoneticDup);
    setChecked('lightweight', currentSettings.lightweight);
    setValue('translation-provider', currentSettings.translationProvider || 'google');
    ensureTargetOption(currentSettings.customTranslateTarget);
    setValue('custom-translate-target', currentSettings.customTranslateTarget || '');
    setValue('gemini-api-key', currentSettings.geminiApiKey);
    setValue('gemini-model', currentSettings.geminiModel || 'gemini-flash-lite-latest');
    setValue('openrouter-api-key', currentSettings.openRouterApiKey);
    setValue('openrouter-model', currentSettings.openRouterModel);
    setValue('custom-llm-url', currentSettings.customLLMBaseUrl);
    setValue('custom-llm-key', currentSettings.customLLMApiKey);
    setValue('custom-llm-model', currentSettings.customLLMModel);
    setValue('deepl-api-key', currentSettings.deeplApiKey);
    setValue('romanization-provider', currentSettings.romanizationProvider || 'offline');
    setValue('transliteration-target', currentSettings.transliterationTargetScript || 'latin');
    setValue('gemini-romanization-model', currentSettings.geminiRomanizationModel || 'gemini-flash-latest');
    setChecked('override-gemini-prompt', currentSettings.overrideGeminiPrompt);
    setValue('custom-gemini-prompt', currentSettings.customGeminiPrompt);
    setChecked('override-gemini-romanize-prompt', currentSettings.overrideGeminiRomanizePrompt);
    setValue('custom-gemini-romanize-prompt', currentSettings.customGeminiRomanizePrompt);
    setValue('cache-strategy', currentSettings.cacheStrategy || 'aggressive');

    for (const id of ['gemini-api-key', 'openrouter-api-key', 'deepl-api-key', 'custom-llm-key']) {
        const input = $(id);
        if (input) input.type = 'password';
    }

    previewPlayerFont(currentSettings.appleMusicPlayerFont);
    applyConditionalVisibility(true);
    populateDraggableProviders();
    populateLocalLyricsList();
    updateCacheSize();
}

function ensureTargetOption(value) {
    const select = $('custom-translate-target');
    if (!select || !value) return;
    if (!Array.from(select.options).some(option => option.value === value)) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        select.appendChild(option);
    }
}

function updateTargetLanguageOptionsForProvider() {
    const provider = $('translation-provider')?.value;
    const select = $('custom-translate-target');
    if (!select) return;
    const isDeepL = provider === 'deepl' || provider === 'deepl-keyless';
    let selectedValid = false;
    for (const option of Array.from(select.options)) {
        if (!option.value) {
            option.hidden = false;
            continue;
        }
        const supported = !isDeepL || DEEPL_SUPPORTED_CODES.has(option.value);
        option.hidden = !supported;
        if (option.value === select.value && supported) selectedValid = true;
    }
    if (isDeepL && select.value && !selectedValid) {
        select.value = '';
        currentSettings = updateSettings({ customTranslateTarget: '' });
        saveSettings().catch(() => notifySaveFailure('customTranslateTarget'));
        showStatus(TRANSLATION_STATUS, t('msgTargetResetForDeepL', 'Target language reset to Auto because DeepL does not support the previous selection.'), false);
    }
}

function applyConditionalVisibility(refreshDictionaries = false) {
    const translation = $('translation-provider')?.value || currentSettings.translationProvider;
    const romanization = $('romanization-provider')?.value || currentSettings.romanizationProvider;
    const translationGemini = translation === 'gemini';
    const translationOpenRouter = translation === 'openrouter';
    const romanizationGemini = romanization === 'gemini';
    const romanizationOpenRouter = romanization === 'openrouter';
    const translationAI = translationGemini || translationOpenRouter;
    const romanizationAI = romanizationGemini || romanizationOpenRouter;

    setHidden('gemini-settings-category', !(translationGemini || romanizationGemini));
    setHidden('gemini-translation-model-group', !translationGemini);
    setHidden('openrouter-settings-category', !(translationOpenRouter || romanizationOpenRouter));
    setHidden('custom-llm-settings-category', translation !== 'customllm');
    setHidden('deepl-settings-category', translation !== 'deepl');
    setHidden('override-gemini-prompt-group', !translationAI);
    setHidden('custom-gemini-prompt-group', !(translationAI && $('override-gemini-prompt')?.checked));
    setHidden('override-gemini-romanize-prompt-group', !romanizationAI);
    setHidden('custom-gemini-romanize-prompt-group', !(romanizationAI && $('override-gemini-romanize-prompt')?.checked));
    setHidden('gemini-romanization-model-group', !romanizationGemini);
    setHidden('offline-japanese-dict-group', romanization !== 'offline');
    setHidden('offline-arabic-dict-group', romanization !== 'offline');

    const target = $('transliteration-target');
    if (target) target.disabled = !romanizationAI;
    setHidden('transliteration-target-note', romanizationAI);
    if (!romanizationAI && currentSettings.transliterationTargetScript && currentSettings.transliterationTargetScript !== 'latin') {
        currentSettings = updateSettings({ transliterationTargetScript: 'latin' });
        setValue('transliteration-target', 'latin');
        saveSettings().catch(() => notifySaveFailure('transliterationTargetScript'));
    }

    updateTargetLanguageOptionsForProvider();
    updateGroupRounding();
    if (romanization === 'offline' && refreshDictionaries) {
        updateDictionaryStatus('japanese');
        updateDictionaryStatus('arabic');
    }
}

function updateGroupRounding() {
    document.querySelectorAll('.settings-group').forEach(group => {
        const items = Array.from(group.children).filter(child => child.classList.contains('setting-item') && !child.hidden);
        group.querySelectorAll('.setting-item').forEach(item => item.classList.remove('is-first-visible', 'is-last-visible', 'is-only-visible'));
        if (items.length === 1) items[0].classList.add('is-only-visible');
        if (items.length > 1) {
            items[0].classList.add('is-first-visible');
            items[items.length - 1].classList.add('is-last-visible');
        }
    });
}

function currentProviderOrder() {
    return normalizeAppleLyricsOrder(currentSettings.appleMusicLyricsProviderOrder);
}

function createProviderRow(name) {
    const row = document.createElement('div');
    row.className = 'draggable-source-item';
    row.dataset.provider = name;
    row.draggable = name !== 'applemusic';
    row.setAttribute('aria-label', APPLE_LYRICS_NAMES[name] || name);

    if (name !== 'applemusic') {
        const handle = createSvgIcon(ICONS.drag);
        handle.classList.add('drag-handle');
        row.appendChild(handle);
    }

    const label = document.createElement('span');
    label.className = 'source-name';
    label.textContent = APPLE_LYRICS_NAMES[name] || name;
    row.appendChild(label);

    if (name === 'applemusic') {
        const pinned = document.createElement('span');
        pinned.className = 'source-meta';
        pinned.textContent = t('sourceNativePinned', 'Always used as the final fallback');
        row.appendChild(pinned);
    } else {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'm3-button icon remove-source-button';
        remove.title = t('titleRemoveSource', 'Remove item');
        remove.setAttribute('aria-label', remove.title);
        remove.appendChild(createSvgIcon(ICONS.delete));
        remove.addEventListener('click', event => {
            event.stopPropagation();
            removeProvider(name);
        });
        row.appendChild(remove);
    }
    return row;
}

function populateDraggableProviders() {
    const list = $('provider-order-draggable');
    const select = $('available-providers-dropdown');
    const addButton = $('add-provider-button');
    if (!list || !select) return;
    const active = currentProviderOrder();
    list.replaceChildren(...active.map(createProviderRow));

    const missing = APPLE_LYRICS_ORDER.filter(name => !active.includes(name));
    select.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.disabled = true;
    placeholder.selected = true;
    placeholder.textContent = missing.length
        ? t('placeholderSelectSource', 'Select source…')
        : t('msgAllSourcesAdded', 'All sources added');
    select.appendChild(placeholder);
    for (const name of missing) {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = APPLE_LYRICS_NAMES[name] || name;
        select.appendChild(option);
    }
    if (addButton) addButton.disabled = missing.length === 0;
    updateGroupRounding();
}

async function saveProviderOrder(order = null) {
    const list = $('provider-order-draggable');
    const providers = order || Array.from(list?.children || []).map(item => item.dataset.provider);
    const normalized = normalizeAppleLyricsOrder(providers);
    currentSettings = updateSettings({ appleMusicLyricsProviderOrder: normalized.join(',') });
    try {
        await saveSettings();
        populateDraggableProviders();
        showStatus('source-order-status', t('msgSourceOrderSaved', 'Lyrics source order saved.'), false);
        return true;
    } catch {
        showStatus('source-order-status', t('msgSourceOrderSaveFailed', 'Could not save the lyric source order.'), true);
        return false;
    }
}

async function addProvider() {
    const select = $('available-providers-dropdown');
    const name = select?.value;
    if (!name) {
        showStatus('add-provider-status', t('msgSelectSource', 'Please select a source to add.'), true);
        return;
    }
    const next = [...currentProviderOrder().filter(item => item !== 'applemusic'), name, 'applemusic'];
    if (await saveProviderOrder(next)) {
        showStatus('add-provider-status', t('msgSourceAdded', '"$NAME$" added.', [APPLE_LYRICS_NAMES[name] || name]), false);
    }
}

async function removeProvider(name) {
    if (name === 'applemusic') return;
    const next = currentProviderOrder().filter(item => item !== name && item !== 'applemusic');
    next.push('applemusic');
    if (await saveProviderOrder(next)) {
        showStatus('add-provider-status', t('msgSourceRemoved', '"$NAME$" removed.', [APPLE_LYRICS_NAMES[name] || name]), false);
    }
}

function getDragAfterElement(container, y) {
    return [...container.querySelectorAll('.draggable-source-item:not(.dragging)')].reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        return offset < 0 && offset > closest.offset ? { offset, element: child } : closest;
    }, { offset: -Infinity }).element;
}

function bindProviderOrderInteractions() {
    const list = $('provider-order-draggable');
    if (!list || list.dataset.bound) return;
    list.dataset.bound = 'true';

    list.addEventListener('dragstart', event => {
        const item = event.target.closest('.draggable-source-item');
        if (!item || item.dataset.provider === 'applemusic') return event.preventDefault();
        draggedItem = item;
        item.classList.add('dragging');
        event.dataTransfer?.setData('text/plain', item.dataset.provider);
    });
    list.addEventListener('dragover', event => {
        if (!draggedItem) return;
        event.preventDefault();
        const after = getDragAfterElement(list, event.clientY);
        if (after) list.insertBefore(draggedItem, after);
        else {
            const native = list.querySelector('[data-provider="applemusic"]');
            if (native) list.insertBefore(draggedItem, native);
            else list.appendChild(draggedItem);
        }
    });
    list.addEventListener('dragend', () => {
        if (draggedItem) draggedItem.classList.remove('dragging');
        draggedItem = null;
        saveProviderOrder();
    });

    list.addEventListener('touchstart', event => {
        const handle = event.target.closest('.drag-handle');
        const item = handle?.closest('.draggable-source-item');
        if (!item) return;
        event.preventDefault();
        draggedTouchItem = item;
        item.classList.add('dragging');
    }, { passive: false });
    list.addEventListener('touchmove', event => {
        if (!draggedTouchItem) return;
        event.preventDefault();
        const touch = event.targetTouches[0];
        const after = getDragAfterElement(list, touch.clientY);
        if (after) list.insertBefore(draggedTouchItem, after);
        else {
            const native = list.querySelector('[data-provider="applemusic"]');
            if (native) list.insertBefore(draggedTouchItem, native);
            else list.appendChild(draggedTouchItem);
        }
    }, { passive: false });
    list.addEventListener('touchend', () => {
        if (draggedTouchItem) draggedTouchItem.classList.remove('dragging');
        draggedTouchItem = null;
        saveProviderOrder();
    });
}

async function populateLocalLyricsList() {
    const list = $('local-lyrics-list');
    if (!list) return;
    list.replaceChildren();
    const empty = document.createElement('p');
    empty.className = 'helper-text';
    empty.textContent = t('msgNoLocalLyrics', 'No local TTML imports yet.');
    list.appendChild(empty);

    try {
        const entries = await getLocalLyricsList();
        if (!Array.isArray(entries) || entries.length === 0) return;
        empty.hidden = true;
        for (const entry of entries) {
            const info = entry.songInfo || {};
            const row = document.createElement('div');
            row.className = 'draggable-source-item local-lyrics-item';
            row.dataset.songId = entry.songId || '';

            const icon = createSvgIcon(ICONS.music);
            icon.classList.add('local-lyrics-icon');
            row.appendChild(icon);

            const copy = document.createElement('div');
            copy.className = 'local-lyrics-copy';
            const title = document.createElement('span');
            title.className = 'source-name';
            title.textContent = [info.title || info.name || entry.songId, info.artist].filter(Boolean).join(' — ');
            copy.appendChild(title);
            const metaText = [info.album, entry.songId].filter(Boolean).join(' · ');
            if (metaText) {
                const meta = document.createElement('span');
                meta.className = 'source-meta';
                meta.textContent = metaText;
                copy.appendChild(meta);
            }
            row.appendChild(copy);

            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'm3-button icon remove-source-button';
            remove.title = t('titleDeleteLocalLyrics', 'Delete local lyrics');
            remove.setAttribute('aria-label', remove.title);
            remove.appendChild(createSvgIcon(ICONS.delete));
            remove.addEventListener('click', async () => {
                const songName = title.textContent;
                if (!window.confirm(t('confirmDeleteLyrics', 'Delete local lyrics for "$NAME$"?', [songName]))) return;
                remove.disabled = true;
                try {
                    await deleteLocalLyrics(entry.songId);
                    showStatus('local-lyrics-status', t('msgLocalLyricsDeleted', 'Local lyrics deleted.'), false);
                    await populateLocalLyricsList();
                } catch (error) {
                    remove.disabled = false;
                    showStatus('local-lyrics-status', t('msgDeleteError', 'Could not delete local lyrics: $ERROR$', [String(error?.message || error)]), true);
                }
            });
            row.appendChild(remove);
            list.appendChild(row);
        }
    } catch (error) {
        empty.hidden = false;
        empty.textContent = t('msgErrorLoadingLocalLyrics', 'Could not load local lyrics: $ERROR$', [String(error?.message || error)]);
    }
}

const fontInput = $('player-font-file');
const importFontButton = $('import-player-font');
const resetFontButton = $('reset-player-font');
const fontStatus = $('player-font-status');
const fontPreviewLoader = createImportedFontLoader(family => {
    const preview = $('player-font-preview');
    if (preview) preview.style.fontFamily = family || 'inherit';
}, () => {
    if (fontStatus) fontStatus.textContent = t('msgPlayerFontLoadFailed', 'Unable to load the font. Please import the file again.');
});

function previewPlayerFont(value) {
    const metadata = getSettings().appleMusicPlayerFontFile;
    if (fontStatus) fontStatus.textContent = metadata?.name || t('msgPlayerFontDefault', 'Using default font');
    fontPreviewLoader.update(metadata, playerFontFamily(value));
}

if (importFontButton && fontInput) {
    importFontButton.addEventListener('click', () => fontInput.click());
    fontInput.addEventListener('change', async () => {
        const file = fontInput.files?.[0];
        if (!file) return;
        const previous = {
            appleMusicPlayerFont: getSettings().appleMusicPlayerFont,
            appleMusicPlayerFontFile: getSettings().appleMusicPlayerFontFile
        };
        importFontButton.disabled = resetFontButton.disabled = true;
        if (fontStatus) {
            fontStatus.classList.remove('error');
            fontStatus.textContent = t('msgPlayerFontImporting', 'Importing font…');
        }
        let imported;
        try {
            imported = await importPlayerFont(file);
            currentSettings = updateSettings({ appleMusicPlayerFont: '', appleMusicPlayerFontFile: imported });
            await saveSettings();
            previewPlayerFont('');
            if (fontStatus) fontStatus.textContent = t('msgPlayerFontImported', 'Font imported and applied to the Apple Music player.');
            if (previous.appleMusicPlayerFontFile?.id) deleteImportedFont(previous.appleMusicPlayerFontFile.id).catch(() => {});
        } catch (error) {
            if (imported) {
                currentSettings = updateSettings(previous);
                deleteImportedFont(imported.id).catch(() => {});
                saveSettings().catch(() => {});
            }
            if (fontStatus) {
                fontStatus.classList.add('error');
                fontStatus.textContent = t(error?.message === 'FONT_SIZE' ? 'msgPlayerFontSize' : 'msgPlayerFontImportFailed', 'Unable to import this font. Choose a valid font file; the previous font is kept.');
            }
        } finally {
            importFontButton.disabled = resetFontButton.disabled = false;
            fontInput.value = '';
        }
    });
}

if (resetFontButton) {
    resetFontButton.addEventListener('click', async () => {
        const previous = {
            appleMusicPlayerFont: getSettings().appleMusicPlayerFont,
            appleMusicPlayerFontFile: getSettings().appleMusicPlayerFontFile
        };
        try {
            currentSettings = updateSettings({ appleMusicPlayerFont: '', appleMusicPlayerFontFile: null });
            await saveSettings();
            previewPlayerFont('');
            if (fontStatus) {
                fontStatus.classList.remove('error');
                fontStatus.textContent = t('msgPlayerFontReset', 'Default player font restored.');
            }
            if (previous.appleMusicPlayerFontFile?.id) deleteImportedFont(previous.appleMusicPlayerFontFile.id).catch(() => {});
        } catch {
            currentSettings = updateSettings(previous);
            if (fontStatus) {
                fontStatus.classList.add('error');
                fontStatus.textContent = t('msgSettingsSaveFailed', 'Could not save settings. Try again.');
            }
        }
    });
}

window.addEventListener('pagehide', () => fontPreviewLoader.dispose(), { once: true });

function bindApiKeyToggle(buttonId, inputId) {
    const button = $(buttonId);
    const input = $(inputId);
    if (!button || !input) return;
    const updateLabel = () => {
        button.textContent = input.type === 'password'
            ? t('buttonShowKey', 'Show')
            : t('buttonHideKey', 'Hide');
    };
    updateLabel();
    button.addEventListener('click', () => {
        input.type = input.type === 'password' ? 'text' : 'password';
        updateLabel();
    });
}
bindApiKeyToggle('toggle-gemini-api-key-visibility', 'gemini-api-key');
bindApiKeyToggle('toggle-openrouter-api-key-visibility', 'openrouter-api-key');
bindApiKeyToggle('toggle-deepl-api-key-visibility', 'deepl-api-key');

async function testCustomLLM() {
    const button = $('test-custom-llm');
    if (!button) return;
    const values = {
        customLLMBaseUrl: $('custom-llm-url')?.value.trim() || '',
        customLLMApiKey: $('custom-llm-key')?.value.trim() || '',
        customLLMModel: $('custom-llm-model')?.value.trim() || ''
    };
    try {
        const endpoint = customLLMEndpoint(values.customLLMBaseUrl);
        if (!values.customLLMModel) throw new Error(t('msgCustomLLMModelRequired', 'Enter a model name.'));
        const api = globalThis.browser || globalThis.chrome;
        if (!api?.permissions) throw new Error(t('msgCustomLLMExtensionRequired', 'This connection test requires the extension context.'));
        button.disabled = true;
        showStatus('custom-llm-status', t('msgCustomLLMTesting', 'Testing connection…'), false);
        currentSettings = updateSettings(values);
        await saveSettings();
        const granted = await api.permissions.request({ origins: [endpoint.origin + '/*'] });
        if (!granted) throw new Error(t('msgCustomLLMPermissionDenied', 'Permission for this API address was not granted.'));
        const result = await new CustomLLMProvider(values).translate(['Hello, world.'], 'zh-CN');
        showStatus('custom-llm-status', t('msgCustomLLMTestSuccess', 'Connection successful:') + ' ' + result[0], false);
        showStatus(TRANSLATION_STATUS, t('msgTranslationSettingsSaved', 'Translation settings saved and applied to the Apple Music player.'), false);
    } catch (error) {
        showStatus('custom-llm-status', t('msgCustomLLMTestFailed', 'Connection failed:') + ' ' + String(error?.message || error), true);
    } finally {
        if (button) button.disabled = false;
    }
}
$('test-custom-llm')?.addEventListener('click', testCustomLLM);

async function updateDictionaryStatus(kind) {
    const statusId = kind === 'japanese' ? 'offline-japanese-dict-status' : 'offline-arabic-dict-status';
    const downloadId = kind === 'japanese' ? 'btn-download-japanese-dict' : 'btn-download-arabic-dict';
    const deleteId = kind === 'japanese' ? 'btn-delete-japanese-dict' : 'btn-delete-arabic-dict';
    const textId = kind === 'japanese' ? 'btn-download-japanese-dict-text' : 'btn-download-arabic-dict-text';
    const status = $(statusId);
    const download = $(downloadId);
    const remove = $(deleteId);
    const downloadText = $(textId);
    if (!status || !download) return;
    try {
        const result = await getDictionaryStatus(kind);
        const fallbackSize = kind === 'japanese' ? '17 MB' : '74.3 MB';
        const size = result?.sizeMB ? result.sizeMB + ' MB' : fallbackSize;
        if (result?.installed) {
            status.textContent = t('dictStatusInstalled', 'Installed (~$SIZE$)', [size]);
            status.classList.add('installed');
            download.hidden = true;
            if (remove) remove.hidden = false;
        } else {
            status.textContent = t('dictStatusNotInstalled', 'Not installed (~$SIZE$)', [fallbackSize]);
            status.classList.remove('installed');
            download.hidden = false;
            download.disabled = false;
            if (downloadText) downloadText.textContent = t('btnDownloadDict', 'Download');
            if (remove) remove.hidden = true;
        }
    } catch {
        status.textContent = t('msgDictionaryUnavailable', 'Unavailable');
        status.classList.remove('installed');
    }
}

async function downloadOfflineDictionary(kind) {
    const isJapanese = kind === 'japanese';
    const confirmKey = isJapanese ? 'confirmDownloadJapaneseDict' : 'confirmDownloadArabicDict';
    if (!window.confirm(t(confirmKey, isJapanese ? 'Download the Japanese dictionary (~17 MB) now?' : 'Download the Arabic model (~74.3 MB) now?'))) return;
    const download = $(isJapanese ? 'btn-download-japanese-dict' : 'btn-download-arabic-dict');
    const status = $(isJapanese ? 'offline-japanese-dict-status' : 'offline-arabic-dict-status');
    const text = $(isJapanese ? 'btn-download-japanese-dict-text' : 'btn-download-arabic-dict-text');
    if (download) download.disabled = true;
    if (status) status.textContent = t('dictStatusDownloading', 'Downloading (~$SIZE$)…', [isJapanese ? '17 MB' : '74.3 MB']);
    if (text) text.textContent = '…';
    try {
        await downloadDictionary(kind);
        await updateDictionaryStatus(kind);
    } catch (error) {
        if (status) status.textContent = t('msgDictionaryDownloadFailed', 'Download failed');
        if (download) download.disabled = false;
        if (text) text.textContent = t('btnDownloadDict', 'Download');
        showStatus(TRANSLATION_STATUS, t('msgDictionaryDownloadFailedDetail', 'Could not download the offline dictionary: $ERROR$', [String(error?.message || error)]), true);
    }
}

async function removeOfflineDictionary(kind) {
    const isJapanese = kind === 'japanese';
    const confirmKey = isJapanese ? 'confirmDeleteJapaneseDict' : 'confirmDeleteArabicDict';
    if (!window.confirm(t(confirmKey, 'Delete this offline dictionary?'))) return;
    const remove = $(isJapanese ? 'btn-delete-japanese-dict' : 'btn-delete-arabic-dict');
    if (remove) remove.disabled = true;
    try {
        await deleteDictionary(kind);
        await updateDictionaryStatus(kind);
    } catch (error) {
        showStatus(TRANSLATION_STATUS, t('msgDictionaryDeleteFailed', 'Could not delete the offline dictionary: $ERROR$', [String(error?.message || error)]), true);
        await updateDictionaryStatus(kind);
    } finally {
        if (remove) remove.disabled = false;
    }
}

$('btn-download-japanese-dict')?.addEventListener('click', () => downloadOfflineDictionary('japanese'));
$('btn-delete-japanese-dict')?.addEventListener('click', () => removeOfflineDictionary('japanese'));
$('btn-download-arabic-dict')?.addEventListener('click', () => downloadOfflineDictionary('arabic'));
$('btn-delete-arabic-dict')?.addEventListener('click', () => removeOfflineDictionary('arabic'));

async function clearCacheTarget(target) {
    try {
        const result = await clearCache(target);
        if (!result?.success) throw new Error(result?.error || 'Unknown error');
        await updateCacheSize();
        showStatus(ADVANCED_STATUS, t('msgCacheCleared', 'Cache cleared successfully!'), false);
    } catch (error) {
        showStatus(ADVANCED_STATUS, t('msgCacheClearFailed', 'Failed to clear cache.') + ' ' + String(error?.message || error), true);
    }
}
$('clear-lyrics-cache')?.addEventListener('click', () => clearCacheTarget('lyrics'));
$('clear-translation-cache')?.addEventListener('click', () => clearCacheTarget('translations'));
$('clear-romanization-cache')?.addEventListener('click', () => clearCacheTarget('romanization'));
$('clear-cache')?.addEventListener('click', () => clearCacheTarget('all'));

function exportSettings() {
    try {
        const settings = pickSettings(getSettings());
        const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'youlyplus-apple-settings-' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        showStatus('config-status', t('msgExportSuccess', 'Settings exported successfully!'), false);
    } catch (error) {
        showStatus('config-status', t('msgExportError', 'Could not export settings: $ERROR$', [String(error?.message || error)]), true);
    }
}

const ENUM_SETTINGS = {
    appleMusicDisplayMode: new Set(['none', 'translate', 'romanize', 'both']),
    appleMusicTitleCorrection: new Set(['off', 'original', 'cn', 'jp']),
    largerTextMode: new Set(['lyrics', 'romanization']),
    translationProvider: new Set(['google', 'gemini', 'openrouter', 'customllm', 'deepl', 'deepl-keyless']),
    romanizationProvider: new Set(['offline', 'google', 'gemini', 'openrouter']),
    transliterationTargetScript: new Set(['latin', 'japanese', 'korean', 'cyrillic', 'devanagari', 'arabic', 'hebrew', 'greek', 'thai']),
    cacheStrategy: new Set(['aggressive', 'moderate', 'none'])
};

function validFontMetadata(value) {
    return value === null || (
        value && typeof value === 'object' && !Array.isArray(value)
        && typeof value.id === 'string' && value.id.length > 0
        && typeof value.name === 'string'
        && Number.isFinite(value.size)
    );
}

function sanitizeImportedSettings(values) {
    const picked = pickSettings(values);
    const result = {};
    for (const [key, value] of Object.entries(picked)) {
        if (key === 'appleMusicPlayerFontFile') {
            if (validFontMetadata(value)) result[key] = value === null ? null : {
                id: value.id,
                name: value.name,
                size: value.size
            };
            continue;
        }
        const expected = defaultSettings[key];
        if (expected === null || typeof expected === 'object') continue;
        if (typeof value !== typeof expected) continue;
        if (ENUM_SETTINGS[key] && !ENUM_SETTINGS[key].has(value)) continue;
        result[key] = value;
    }
    return result;
}

function importSettings(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
        try {
            const parsed = JSON.parse(String(reader.result || ''));
            const source = parsed && typeof parsed === 'object' && parsed.settings && typeof parsed.settings === 'object'
                ? parsed.settings
                : parsed;
            const imported = sanitizeImportedSettings(source || {});
            if (!Object.keys(imported).length) throw new Error(t('msgImportNoValidSettings', 'This file contains no supported YouLy+ settings.'));
            currentSettings = updateSettings(imported);
            await saveSettings();
            updateUI(getSettings());
            showStatus('config-status', t('msgImportSuccess', 'Settings imported successfully! Reload required.'), false);
            showReloadNotification();
        } catch (error) {
            showStatus('config-status', t('msgImportError', 'Could not import settings: $ERROR$', [String(error?.message || error)]), true);
        } finally {
            event.target.value = '';
        }
    };
    reader.onerror = () => showStatus('config-status', t('msgFileReadError', 'Could not read the file.'), true);
    reader.readAsText(file);
}

async function queryAppleTabs() {
    const api = globalThis.browser?.tabs || globalThis.chrome?.tabs;
    if (!api?.query) return [];
    try {
        if (globalThis.browser?.tabs) {
            const tabs = await api.query({ url: '*://music.apple.com/*' });
            return Array.isArray(tabs) ? tabs : [];
        }
        return await new Promise(resolve => {
            api.query({ url: '*://music.apple.com/*' }, tabs => resolve(globalThis.chrome?.runtime?.lastError ? [] : Array.isArray(tabs) ? tabs : []));
        });
    } catch {
        return [];
    }
}

async function showReloadNotification(changedKey) {
    if (changedKey && !RESTART_REQUIRED_KEYS.has(changedKey)) return;
    const notification = $('reload-notification');
    if (!notification) return;
    const tabs = await queryAppleTabs();
    notification.style.display = tabs.length ? 'flex' : 'none';
}

async function reloadAppleMusicTabs() {
    const tabs = await queryAppleTabs();
    const api = globalThis.browser?.tabs || globalThis.chrome?.tabs;
    for (const tab of tabs) {
        if (tab.id == null) continue;
        try {
            if (globalThis.browser?.tabs) await api.reload(tab.id);
            else await new Promise(resolve => api.reload(tab.id, resolve));
        } catch {}
    }
    const notification = $('reload-notification');
    if (notification) notification.style.display = 'none';
}

$('reload-button')?.addEventListener('click', reloadAppleMusicTabs);
$('export-settings-button')?.addEventListener('click', exportSettings);
$('import-settings-button')?.addEventListener('click', () => $('import-settings-file')?.click());
$('import-settings-file')?.addEventListener('change', importSettings);
$('refresh-local-lyrics-list')?.addEventListener('click', async () => {
    await populateLocalLyricsList();
    showStatus('local-lyrics-status', t('msgLocalLyricsRefreshed', 'Local TTML library refreshed.'), false);
});
$('add-provider-button')?.addEventListener('click', addProvider);

window.addEventListener('YOUPLUS_SETTINGS_SAVE_FAILED', event => {
    const key = event?.detail?.key || '';
    showStatus(failureStatusFor(key), t(...FAILURE_MESSAGE), true);
});

function initNavigation() {
    document.querySelectorAll('.navigation-drawer .nav-item').forEach(item => {
        item.addEventListener('click', event => {
            event.preventDefault();
            const section = item.dataset.section;
            document.querySelectorAll('.navigation-drawer .nav-item').forEach(other => other.classList.toggle('active', other === item));
            document.querySelectorAll('.settings-card').forEach(card => card.classList.toggle('active', card.id === section));
            if (window.innerWidth <= 768) closeDrawer();
        });
    });

    const menuButton = $('mobile-menu-button');
    const overlay = $('drawer-overlay');
    menuButton?.addEventListener('click', event => {
        event.stopPropagation();
        document.querySelector('.navigation-drawer')?.classList.toggle('open');
        overlay?.classList.toggle('visible');
    });
    overlay?.addEventListener('click', closeDrawer);
}

function closeDrawer() {
    document.querySelector('.navigation-drawer')?.classList.remove('open');
    $('drawer-overlay')?.classList.remove('visible');
}

function setVersion() {
    try {
        const version = globalThis.chrome?.runtime?.getManifest?.().version || 'unknown';
        const element = document.querySelector('.version');
        if (element) element.textContent = t('labelVersion', 'Version $VERSION$', [version]);
    } catch {}
}

document.addEventListener('DOMContentLoaded', async () => {
    initRipple();
    initSwitches();
    initNavigation();
    bindProviderOrderInteractions();
    setVersion();

    const settings = await loadSettings();
    updateUI(settings);
    bindSettingControls();
    setupSettingsMessageListener(updateUI);
});

