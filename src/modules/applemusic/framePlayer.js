// Keep the original AMLL UI in its own document. Apple's document-wide observers
// must not see every style/animation mutation made by the lyric renderer.
(function () {
    const visualKeys = ['lightweight', 'appleMusicAMLLBackground', 'appleMusicDisplayMode', 'appleMusicPlayerFont', 'appleMusicPlayerFontFile', 'largerTextMode', 'wordByWord', 'hidePhoneticDup', 'displayMode'];
    const visualSettings = settings => Object.fromEntries(visualKeys.filter(key => settings && key in settings).map(key => [key, settings[key]]));
    const songView = song => Object.fromEntries(['appleId', 'title', 'artist', 'album', 'duration', 'artwork'].filter(key => song && key in song).map(key => [key, song[key]]));
    const labelKeys = [
        'playerClose', 'playerSettings', 'playerDisplay', 'playerOriginal', 'playerTranslation', 'playerRomanization',
        'playerTranslationAndRomanization', 'playerTranslationLoading', 'playerTranslationUnavailable', 'playerTranslationError',
        'playerRomanizationLoading', 'playerRomanizationUnavailable', 'playerRomanizationError', 'playerLyricsSource',
        'playerAutomatic', 'playerSourcePreference', 'playerCurrentSource', 'playerSourceUnavailable', 'playerLyricsOffset',
        'playerAnimatedBackground', 'playerResetOffset', 'playerReloadLyrics', 'playerNativePlayer', 'playerConnecting',
        'playerLoadingLyrics', 'playerSongNotFound', 'playerNotFoundError', 'playerPlaybackCommandFailed', 'playerSettingsSaveFailed',
        'playerFontLoadFailed', 'playerFullscreen', 'playerExitFullscreen', 'playerFullscreenChangeFailed', 'playerExportFailed',
        'playerDownloadNativeTTML', 'playerDownloadingNativeTTML', 'playerNativeTTMLUnavailable', 'playerNativeTTMLSongChanged',
        'playerNativeTTMLFailed', 'playerImportTTML', 'playerImportingTTML', 'playerImportTTMLHint', 'playerImportTTMLSuccess',
        'playerImportTTMLInvalid', 'playerImportTTMLTooLarge', 'playerLocalTTMLSongChanged', 'playerImportTTMLFailed',
        'playerRemoveLocalTTML', 'playerRemovingLocalTTML', 'playerRemoveLocalTTMLSuccess', 'playerRemoveLocalTTMLFailed',
        'playerAdvanced', 'playerDiagnose', 'playerDiagnosing', 'playerDiagnosticReady', 'playerDiagnosticStopped',
        'playerDiagnosticNeedsPlayback', 'playerDiagnosticRate', 'playerDiagnosticSlow', 'playerExportDiagnostics',
        'playerQueue', 'playerQueueLoading', 'playerQueueEmpty', 'playerQueueLoadFailed', 'playerQueueRetry',
        'playerExportNativeTTML', 'playerQueueCurrent', 'playerQueuePlaying', 'playerQueueChanged', 'playerQueuePlayFailed', 'playerQueueControlUnavailable',
        'playerFavorite', 'playerUnfavorite', 'playerFavoriteUpdating', 'playerFavoriteUnavailable',
        'playerFavoriteAdded', 'playerFavoriteRemoved', 'playerFavoriteSongChanged', 'playerFavoriteFailed',
        'playerFavoriteReading', 'playerFavoriteSignIn', 'playerFavoriteLoadFailed',
    ];

    function createPlayer(frame, options = {}) {
        const channel = crypto.randomUUID();
        const frameURL = new URL(pBrowser.runtime.getURL('src/player-frame/index.html'));
        const frameOrigin = `${frameURL.protocol}//${frameURL.host}`;
        frameURL.searchParams.set('channel', channel);
        frameURL.searchParams.set('parentOrigin', window.location.origin);
        let disposed = false, ready = false, lastLyricsArgs;
        const queue = [];
        const send = message => {
            if (!disposed) frame.contentWindow?.postMessage({ ...message, channel, type: 'LYPLUS_FRAME' }, frameOrigin);
        };
        const fail = () => { if (!disposed) options.onFallback?.(); };
        const timeout = setTimeout(fail, 12000);
        function call(method, ...args) {
            if (disposed) return;
            if (ready) { send({ kind: 'call', method, args }); return; }
            // A cold frame needs the latest media sample, never thousands of old ticks.
            if (['updateCurrentTick', 'updatePlayback', 'setVisible', 'setUserOffset', 'setAvailableProviders', 'setTranslationLoading'].includes(method)) {
                const old = queue.findIndex(item => item.method === method);
                if (old !== -1) queue.splice(old, 1);
            }
            queue.push({ kind: 'call', method, args });
        }
        function displayLyrics(...args) {
            lastLyricsArgs = args;
            const payload = args.slice(0, 12).map(value => typeof value === 'function' ? null : value);
            payload[1] = songView(args[1]);
            payload[3] = visualSettings(args[3]);
            payload[10] = args[10]?.(args[1], args[0], args[3]) || {};
            call('displayLyrics', ...payload);
        }
        async function onMessage(event) {
            const message = event.data;
            if (disposed || event.source !== frame.contentWindow || event.origin !== frameOrigin || message?.type !== 'LYPLUS_FRAME' || message.channel !== channel) return;
            if (message.kind === 'ready') {
                if (ready) return;
                ready = true;
                clearTimeout(timeout);
                for (const pending of queue.splice(0)) send(pending);
                options.onReady?.();
                return;
            }
            if (message.kind !== 'action' || !Number.isSafeInteger(message.id) || !Array.isArray(message.args)) return;
            const args = message.args;
            const handlers = {
                command: () => options.sendCommand?.(...args),
                close: () => options.onClose?.(), fallback: () => options.onFallback?.(),
                settings: () => {
                    const values = args[0];
                    if (!values || Object.keys(values).some(key => !['appleMusicAMLLBackground', 'appleMusicDisplayMode'].includes(key))) throw new Error('Invalid player setting');
                    if ('appleMusicAMLLBackground' in values && typeof values.appleMusicAMLLBackground !== 'boolean') throw new Error('Invalid background setting');
                    if ('appleMusicDisplayMode' in values && !['none', 'translate', 'romanize', 'both'].includes(values.appleMusicDisplayMode)) throw new Error('Invalid display mode');
                    return options.onSettingsChange?.(values);
                },
                reload: () => (lastLyricsArgs?.[4] || options.reloadLyrics)?.(...args),
                mode: () => (lastLyricsArgs?.[5] || options.setDisplayMode)?.(...args),
                provider: () => (lastLyricsArgs?.[8] || options.switchProvider)?.(...args),
                offset: () => (lastLyricsArgs?.[9] || options.saveOffset)?.(...args),
                importTTML: () => options.importTTML?.(...args),
                removeLocalTTML: () => options.removeLocalTTML?.(...args),
            };
            if (!Object.hasOwn(handlers, message.action)) return;
            try {
                const result = await handlers[message.action]();
                send({ kind: 'result', id: message.id, ok: true, result });
            } catch (error) {
                send({ kind: 'result', id: message.id, ok: false, error: error?.message || 'Player action failed', code: error?.code });
            }
        }
        function onLoad() {
            if (ready) { fail(); return; } // A reloaded child cannot reuse stale state.
            send({ kind: 'init', language: options.getLanguage?.() || options.language || pBrowser.i18n?.getUILanguage?.() || document.documentElement.lang || navigator.language,
                labels: Object.fromEntries(labelKeys.map(key => [key, options.translate?.(key) || ''])), settings: visualSettings(options.settings) });
        }
        window.addEventListener('message', onMessage);
        frame.addEventListener('load', onLoad);
        frame.addEventListener('error', fail);
        frame.title = 'YouLy+ · AMLL';
        frame.src = frameURL.href;
        return {
            updateSong: info => call('updateSong', songView(info)), displayLyrics,
            updateSettings: next => call('updateSettings', visualSettings(next)),
            updateDisplayMode: (lyrics, mode, settings) => call('updateDisplayMode', lyrics, mode, visualSettings(settings)),
            ...Object.fromEntries(['updateCurrentTick', 'updatePlayback', 'setUserOffset', 'setAvailableProviders', 'setVisible', 'setTranslationLoading', 'showToast', 'displaySongNotFound', 'displaySongError', 'cleanupLyrics'].map(method => [method, (...args) => call(method, ...args)])),
            dispose() {
                if (disposed) return;
                send({ kind: 'dispose' });
                disposed = true;
                clearTimeout(timeout);
                queue.length = 0;
                lastLyricsArgs = undefined;
                window.removeEventListener('message', onMessage);
                frame.removeEventListener('load', onLoad);
                frame.removeEventListener('error', fail);
            },
        };
    }
    globalThis.LyPlusAMLLFrame = { createPlayer };
})();
