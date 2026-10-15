// ==================================================================================================
// SETTINGS MANAGEMENT
// ==================================================================================================

import { PROVIDERS } from '../constants.js';

export class SettingsManager {
  static async get(keys) {
    if (typeof browser !== 'undefined' && browser.storage?.local) {
      return browser.storage.local.get(keys);
    }
    return new Promise(resolve => chrome.storage.local.get(keys, resolve));
  }

  static async set(values) {
    if (typeof browser !== 'undefined' && browser.storage?.local) return browser.storage.local.set(values);
    return new Promise((resolve, reject) => chrome.storage.local.set(values, () => {
      if (chrome.runtime?.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    }));
  }

  static async getLyricsSettings() {
    return this.get({
      'lyricsProviderOrder': 'kpoe,lrcred,unison,lrclib',
      'appleMusicLyricsProviderOrder': 'amll,lunabeat,amlyrics,applemusic',
      'lyricsSourceOrder': 'apple,lyricsplus,qq,musixmatch,musixmatch-word',
      'customKpoeUrl': '',
      'cacheStrategy': 'aggressive',
      'preferUnisonVideo': false
    });
  }

  static async getTranslationSettings() {
    return this.get({
      'translationProvider': PROVIDERS.GOOGLE,
      'romanizationProvider': PROVIDERS.OFFLINE,
      'transliterationTargetScript': 'latin',
      'geminiApiKey': '',
      'geminiModel': 'gemini-pro',
      'geminiRomanizationModel': 'gemini-pro',
      'overrideTranslateTarget': false,
      'customTranslateTarget': '',
      'overrideGeminiPrompt': false,
      'customGeminiPrompt': '',
      'overrideGeminiRomanizePrompt': false,
      'customGeminiRomanizePrompt': '',
      'openRouterApiKey': '',
      'customLLMBaseUrl': '',
      'customLLMApiKey': '',
      'customLLMModel': '',
      'openRouterModel': 'google/gemini-2.0-flash-001',
      'deeplApiKey': ''
    });
  }
}
