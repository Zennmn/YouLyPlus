// Content scripts use the same extension message catalog as settings and the popup.
function getUserLanguage() {
    return (globalThis.browser || globalThis.chrome)?.i18n?.getUILanguage() || navigator.language || 'en';
}

function t(key, substitutions) {
    return (globalThis.browser || globalThis.chrome)?.i18n?.getMessage(key, substitutions) || '';
}
