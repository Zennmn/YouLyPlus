/**
 * Cross-browser i18n helper for YouLy+ extension pages and content contexts.
 * Keep the global t()/msg() API because classic scripts share this file.
 */
(function initYouLyI18n(scope) {
    const i18nApi = scope.browser?.i18n || scope.chrome?.i18n || null;

    function readMessage(key, substitutions) {
        if (!key || !i18nApi?.getMessage) return '';
        try {
            const value = i18nApi.getMessage(key, substitutions);
            return typeof value === 'string' ? value : '';
        } catch {
            return '';
        }
    }

    /**
     * Translate a _locales key.
     * @param {string} key
     * @param {string|string[]|undefined} substitutions
     * @param {string} fallback English fallback used when the key is absent.
     */
    function t(key, substitutions, fallback = '') {
        return readMessage(key, substitutions) || fallback || '';
    }

    // Preserve the original helper contract used by classic content scripts.
    function msg(key, substitutions) {
        return readMessage(key, substitutions);
    }

    function applyI18n(root = scope.document) {
        if (!root?.querySelectorAll) return;
        root.querySelectorAll('[data-i18n]').forEach(element => {
            const translated = readMessage(element.dataset.i18n);
            if (translated) element.textContent = translated;
        });
        root.querySelectorAll('[data-i18n-title]').forEach(element => {
            const translated = readMessage(element.dataset.i18nTitle);
            if (translated) element.title = translated;
        });
        root.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
            const translated = readMessage(element.dataset.i18nPlaceholder);
            if (translated) element.placeholder = translated;
        });
        root.querySelectorAll('[data-i18n-aria-label]').forEach(element => {
            const translated = readMessage(element.dataset.i18nAriaLabel);
            if (translated) element.setAttribute('aria-label', translated);
        });
    }

    function getUserLanguage() {
        return i18nApi?.getUILanguage?.() || scope.navigator?.language || 'en';
    }

    const uiLanguage = getUserLanguage();
    if (uiLanguage && scope.document?.documentElement) {
        scope.document.documentElement.lang = uiLanguage;
    }

    scope.t = t;
    scope.msg = msg;
    scope.getUserLanguage = getUserLanguage;
    scope.applyI18n = applyI18n;

    if (scope.document?.readyState === 'loading') {
        scope.document.addEventListener('DOMContentLoaded', () => applyI18n(), { once: true });
    } else if (scope.document) {
        applyI18n();
    }
})(globalThis);
