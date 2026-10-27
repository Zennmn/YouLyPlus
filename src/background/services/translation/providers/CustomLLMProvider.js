import { TranslationProvider } from '../TranslationProvider.js';
import { createTranslationPrompt } from '../prompts.js';

export function customLLMEndpoint(value) {
    const url = new URL(String(value || '').trim());
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error('Enter an HTTP(S) API base URL without credentials or query parameters.');
    }
    const path = url.pathname.replace(/\/+$/, '');
    url.pathname = path.endsWith('/chat/completions') ? path : `${path || '/v1'}/chat/completions`;
    return url;
}

export function resolveLLMThinkingFormat(settings = {}) {
    if (['deepseek', 'openrouter', 'none'].includes(settings.llmThinkingFormat)) {
        return settings.llmThinkingFormat;
    }
    let hostname = '';
    try { hostname = new URL(String(settings.customLLMBaseUrl || '').trim()).hostname; } catch (_) {}
    if (hostname === 'openrouter.ai' || hostname.endsWith('.openrouter.ai')) return 'openrouter';
    if (hostname === 'deepseek.com' || hostname.endsWith('.deepseek.com')
        || /deepseek/i.test(String(settings.customLLMModel || '')) || settings.llmThinkingEnabled === true) {
        return 'deepseek';
    }
    return 'none';
}

export function buildLLMThinkingParameters(settings = {}, format = resolveLLMThinkingFormat(settings)) {
    if (format === 'none') return {};
    const enabled = settings.llmThinkingEnabled === true;
    const effort = ['low', 'high', 'max'].includes(settings.llmThinkingEffort)
        ? settings.llmThinkingEffort : 'high';
    if (format === 'openrouter') {
        return { reasoning: { enabled, exclude: true, ...(enabled ? { effort } : {}) } };
    }
    if (format === 'deepseek') {
        return {
            thinking: { type: enabled ? 'enabled' : 'disabled' },
            ...(enabled ? { reasoning_effort: effort } : {})
        };
    }
    return {};
}

export class CustomLLMProvider extends TranslationProvider {
    async translate(texts, targetLang, songInfo = {}) {
        if (!texts.length) return [];
        const endpoint = customLLMEndpoint(this.settings.customLLMBaseUrl);
        const model = this.settings.customLLMModel?.trim();
        if (!model) throw new Error('Set the third-party LLM model name in Settings.');
        const permissions = globalThis.browser?.permissions || globalThis.chrome?.permissions;
        if (permissions && !await permissions.contains({ origins: [`${endpoint.origin}/*`] })) {
            throw new Error('Authorize the API address using the connection test in Settings.');
        }
        const controller = new AbortController();
        const thinkingEnabled = this.settings.llmThinkingEnabled === true;
        const timer = setTimeout(() => controller.abort(), thinkingEnabled ? 180000 : 60000);
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (this.settings.customLLMApiKey?.trim()) headers.Authorization = `Bearer ${this.settings.customLLMApiKey.trim()}`;
            const prompt = createTranslationPrompt(this.settings, texts, targetLang, songInfo)
                + `\n\nINPUT LINES:\n${JSON.stringify(texts)}\nReturn only JSON: {"translated_lyrics": [one translated string for each input line]}. Keep exactly ${texts.length} lines in order.`;
            const requestBody = { model, stream: false, messages: [
                { role: 'system', content: 'Translate song lyrics. Return only the requested JSON, with one string per input line.' },
                { role: 'user', content: prompt },
            ], ...buildLLMThinkingParameters(this.settings) };
            const response = await fetch(endpoint.href, {
                method: 'POST', headers, credentials: 'omit', redirect: 'error', signal: controller.signal,
                body: JSON.stringify(requestBody),
            });
            if (!response.ok) throw new Error(`Third-party LLM HTTP ${response.status}`);
            const data = await response.json();
            const content = data.choices?.[0]?.message?.content;
            if (typeof content !== 'string') throw new Error('The API response has no message content.');
            const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
            let parsed;
            try { parsed = JSON.parse(cleaned); } catch (_) { throw new Error('The LLM did not return valid translation JSON.'); }
            const lines = Array.isArray(parsed) ? parsed : parsed.translated_lyrics;
            if (!Array.isArray(lines) || lines.length !== texts.length || lines.some(x => typeof x !== 'string')) {
                throw new Error('The LLM translation line count or format does not match the input.');
            }
            return lines;
        } finally { clearTimeout(timer); }
    }
}
