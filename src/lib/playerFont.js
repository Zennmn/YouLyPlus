// Quote family names as literals; preserve CSS generic families as keywords.
const generic = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'fangsong']);
export function playerFontFamily(value) {
    if (typeof value !== 'string') return '';
    return value.slice(0, 500).split(/[,，]/).map(name => {
        name = name.trim().replace(/^(["'])(.*)\1$/, '$2').trim();
        if (!name || /[;{}\r\n\\]/.test(name)) return '';
        return generic.has(name.toLowerCase()) ? name.toLowerCase() : JSON.stringify(name);
    }).filter(Boolean).join(', ');
}
