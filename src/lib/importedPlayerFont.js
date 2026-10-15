export const FONT_FILE_LIMIT = 64 * 1024 * 1024;

function database() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('YouLyPlayerFonts', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('fonts', { keyPath: 'id' });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}
async function transaction(mode, action) {
    const db = await database();
    try {
        return await new Promise((resolve, reject) => {
            const tx = db.transaction('fonts', mode);
            const request = action(tx.objectStore('fonts'));
            tx.oncomplete = () => resolve(request.result);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('Font storage interrupted'));
        });
    } finally { db.close(); }
}
export const readImportedFont = id => transaction('readonly', store => store.get(id));
export const deleteImportedFont = id => transaction('readwrite', store => store.delete(id));

export async function importPlayerFont(file) {
    if (!file || !/\.(ttf|otf|woff2?)$/i.test(file.name)) throw new Error('FONT_FORMAT');
    if (!file.size || file.size > FONT_FILE_LIMIT) throw new Error('FONT_SIZE');
    const buffer = await file.arrayBuffer();
    const id = crypto.randomUUID();
    const family = `YouLyImported_${id.replaceAll('-', '')}`;
    // Decode before saving, so a failed import never replaces the working font.
    await new FontFace(family, buffer).load();
    await transaction('readwrite', store => store.put({ id, family, buffer }));
    return { id, name: file.name, size: buffer.byteLength };
}

export function createImportedFontLoader(onChange, onError = () => {}, dependencies = {}) {
    const read = dependencies.read || readImportedFont;
    const fonts = dependencies.fonts || document.fonts;
    const Face = dependencies.FontFace || FontFace;
    let revision = 0, key, face, disposed = false;
    return {
        async update(metadata, fallback = '') {
            const next = metadata?.id || '';
            if (disposed || (next && key === next)) return;
            key = next;
            const current = ++revision;
            if (!next) {
                if (face) fonts.delete(face);
                face = null;
                onChange(fallback);
                return;
            }
            try {
                const record = await read(next);
                if (!record || !/^[\w-]+$/.test(record.family)) throw new Error('FONT_MISSING');
                const loaded = await new Face(record.family, record.buffer).load();
                if (disposed || current !== revision) return;
                fonts.add(loaded);
                if (face) fonts.delete(face);
                face = loaded;
                onChange(`"${record.family}"`);
            } catch (error) {
                if (disposed || current !== revision) return;
                if (face) fonts.delete(face);
                face = null;
                onChange(fallback);
                onError(error);
            }
        },
        dispose() { disposed = true; revision++; if (face) fonts.delete(face); face = null; },
    };
}
