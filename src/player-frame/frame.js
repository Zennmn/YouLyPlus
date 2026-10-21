(function () {
    const parameters = new URLSearchParams(location.search);
    const channel = parameters.get('channel'), parentOrigin = parameters.get('parentOrigin');
    if (!channel || parent === window || !parentOrigin) return;
    const allowedParent = (() => {
        try {
            const url = new URL(parentOrigin);
            const apple = ['https:', 'http:'].includes(url.protocol) && (url.hostname === 'music.apple.com' || url.hostname.endsWith('.music.apple.com'));
            const localPreview = ['http:', 'https:'].includes(location.protocol) && url.origin === location.origin;
            return url.origin === parentOrigin && (apple || localPreview);
        } catch { return false; }
    })();
    if (!allowedParent) return;
    let player, disposed = false, sequence = 0;
    const pending = new Map();
    const send = message => { if (!disposed) parent.postMessage({ ...message, type: 'LYPLUS_FRAME', channel }, parentOrigin); };
    function action(name, ...args) {
        if (disposed) return Promise.reject(new Error('Player closed'));
        return new Promise((resolve, reject) => {
            const id = ++sequence;
            const timer = setTimeout(() => { pending.delete(id); reject(new Error('Apple Music did not respond')); }, name === 'command' && args[0] === 'nativeTTML' ? 20000 : 15000);
            pending.set(id, { resolve, reject, timer });
            send({ kind: 'action', id, action: name, args });
        });
    }
    // Fire-and-forget actions still consume rejections; commands/settings return
    // their promise to the existing UI for its normal error feedback/rollback.
    const notify = (name, ...args) => { action(name, ...args).catch(error => player?.showToast(error.message)); };
    function displayLyrics(args) {
        const context = args[10];
        args[4] = (...values) => notify('reload', ...values);
        args[5] = (...values) => notify('mode', ...values);
        args[8] = (...values) => notify('provider', ...values);
        args[9] = (...values) => notify('offset', ...values);
        args[10] = () => context;
        player.displayLyrics(...args);
    }
    const methods = new Set(['updateSong', 'displayLyrics', 'updateCurrentTick', 'updatePlayback', 'updateSettings', 'updateDisplayMode', 'setUserOffset', 'setAvailableProviders', 'setVisible', 'setTranslationLoading', 'showToast', 'displaySongNotFound', 'displaySongError', 'cleanupLyrics']);
    function dispose() {
        if (disposed) return;
        player?.dispose();
        disposed = true;
        for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Player closed')); }
        pending.clear();
        window.removeEventListener('message', onMessage);
        document.removeEventListener('keydown', onKeyDown);
    }
    function onMessage(event) {
        const message = event.data;
        if (disposed || event.source !== parent || event.origin !== parentOrigin || message?.type !== 'LYPLUS_FRAME' || message.channel !== channel) return;
        if (message.kind === 'init' && !player) {
            document.documentElement.lang = message.language || 'en';
            player = globalThis.LyPlusAMLL.createPlayer(document.getElementById('player'), {
                renderDocument: 'extension-frame-v1',
                settings: message.settings, translate: key => message.labels?.[key] || '',
                sendCommand: (...args) => action('command', ...args),
                browserFullscreen: async operation => {
                    const runtime = globalThis.browser?.runtime || globalThis.chrome?.runtime;
                    if (!runtime?.sendMessage) throw new Error('Browser fullscreen is unavailable');
                    const result = await runtime.sendMessage({ type: 'BROWSER_FULLSCREEN', operation });
                    if (!result?.success) throw new Error(result?.error || 'Unable to change fullscreen');
                    return result;
                },
                onClose: () => notify('close'), onFallback: () => notify('fallback'),
                onSettingsChange: values => action('settings', values),
                saveOffset: (...args) => notify('offset', ...args), reloadLyrics: (...args) => notify('reload', ...args),
                setDisplayMode: (...args) => notify('mode', ...args),
                switchProvider: (...args) => notify('provider', ...args),
                importTTML: (...args) => action('importTTML', ...args),
                removeLocalTTML: (...args) => action('removeLocalTTML', ...args),
                onReady: () => send({ kind: 'ready' }),
            });
            player.updateSettings(message.settings || {});
        } else if (message.kind === 'call' && player && methods.has(message.method) && Array.isArray(message.args)) {
            try {
                if (message.method === 'displayLyrics') displayLyrics(message.args);
                else player[message.method](...message.args);
            } catch (error) { player.showToast(error?.message || 'Player update failed'); }
        } else if (message.kind === 'result') {
            const item = pending.get(message.id);
            if (!item) return;
            clearTimeout(item.timer); pending.delete(message.id);
            if (message.ok) item.resolve(message.result); else item.reject(Object.assign(new Error(message.error || 'Player action failed'), { code: message.code }));
        } else if (message.kind === 'dispose') dispose();
    }
    function onKeyDown(event) {
        if (event.isComposing || event.keyCode === 229) return;
        if (event.key === 'Escape') { event.preventDefault(); notify('close'); }
    }
    window.addEventListener('message', onMessage);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('pagehide', dispose, { once: true });
})();
