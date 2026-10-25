// ==================================================================================================
// SETTINGS MANAGEMENT
// ==================================================================================================

import { PROVIDERS } from '../constants.js';
import '../../lib/defaultSettings.js';

const defaults = globalThis.LYPLUS_DEFAULT_SETTINGS;

export class SettingsManager {
  static async get(keys) {
    if (typeof browser !== 'undefined' && browser.storage?.local) {
      return browser.storage.local.get(keys);
    }
    return new Promise((resolve, reject) => chrome.storage.local.get(keys, result => {
      if (chrome.runtime?.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result);
    }));
  }

  static async set(values) {
    if (typeof browser !== 'undefined' && browser.storage?.local) return browser.storage.local.set(values);
    return new Promise((resolve, reject) => chrome.storage.local.set(values, () => {
      if (chrome.runtime?.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    }));
  }

  static async getLyricsSettings() {
    const settings = await this.get({
      'appleMusicLyricsProviderOrder': defaults.appleMusicLyricsProviderOrder,
      'cacheStrategy': defaults.cacheStrategy
    });
    settings.cacheStrategy = settings.cacheStrategy === 'none' ? 'none' : 'bounded';
    return settings;
  }

  static async getTranslationSettings() {
    const settings = await this.get({
      'cacheStrategy': defaults.cacheStrategy,
      'translationProvider': defaults.translationProvider || PROVIDERS.GOOGLE,
      'romanizationProvider': defaults.romanizationProvider || PROVIDERS.OFFLINE,
      'transliterationTargetScript': defaults.transliterationTargetScript,
      'geminiApiKey': defaults.geminiApiKey,
      'geminiModel': defaults.geminiModel,
      'geminiRomanizationModel': defaults.geminiRomanizationModel,
      'overrideTranslateTarget': defaults.overrideTranslateTarget,
      'customTranslateTarget': defaults.customTranslateTarget,
      'overrideGeminiPrompt': defaults.overrideGeminiPrompt,
      'customGeminiPrompt': defaults.customGeminiPrompt,
      'overrideGeminiRomanizePrompt': defaults.overrideGeminiRomanizePrompt,
      'customGeminiRomanizePrompt': defaults.customGeminiRomanizePrompt,
      'openRouterApiKey': defaults.openRouterApiKey,
      'customLLMBaseUrl': defaults.customLLMBaseUrl,
      'customLLMApiKey': defaults.customLLMApiKey,
      'customLLMModel': defaults.customLLMModel,
      'openRouterModel': defaults.openRouterModel,
      'deeplApiKey': defaults.deeplApiKey
    });
    settings.cacheStrategy = settings.cacheStrategy === 'none' ? 'none' : 'bounded';
    return settings;
  }
}
