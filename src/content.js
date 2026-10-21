let contentStarted = false;

function initializeLyricsPlus() {
    if (!contentStarted) {
        contentStarted = true;
        window.addEventListener('message', event => {
            if (event.source !== window || event.origin !== window.location.origin || !currentSettings.isEnabled) return;
            if (event.data?.type !== 'LYPLUS_SONG_CHANGED') return;
            const song = event.data.songInfo;
            if (song?.appleId && song.title?.trim() && song.artist?.trim()) {
                fetchAndDisplayLyrics(song, true).catch(error => console.warn('YouLy+:', error));
            }
        });
    }
    injectDOMScript();
    window.initializeLyricsPlusPlatform?.();
}

loadSettings(() => { if (currentSettings.isEnabled) initializeLyricsPlus(); });
window.addEventListener('YOUPLUS_SETTINGS_UPDATED', () => {
    if (currentSettings.isEnabled) initializeLyricsPlus();
});
