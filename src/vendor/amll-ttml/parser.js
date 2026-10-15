const NS = {
  TT: "http://www.w3.org/ns/ttml",
  TTM: "http://www.w3.org/ns/ttml#metadata",
  ITUNES: "http://music.apple.com/lyric-ttml-internal",
  AMLL: "http://www.example.com/ns/amll",
  XML: "http://www.w3.org/XML/1998/namespace",
  TTS: "http://www.w3.org/ns/ttml#styling"
};
const Elements = {
  Head: "head",
  Body: "body",
  Div: "div",
  P: "p",
  Title: "title",
  Name: "name",
  Meta: "meta",
  ITunesMetadata: "iTunesMetadata",
  Songwriters: "songwriters",
  Songwriter: "songwriter",
  Translation: "translation",
  Translations: "translations",
  Transliteration: "transliteration",
  Transliterations: "transliterations",
  Text: "text",
  ParserError: "parsererror",
  Agent: "agent"
};
const Attributes = {
  Timing: "timing",
  Id: "id",
  Key: "key",
  Value: "value",
  Lang: "lang",
  For: "for",
  SongPart: "songPart",
  SongPartKebab: "song-part",
  Begin: "begin",
  End: "end",
  Role: "role",
  Type: "type",
  Ruby: "ruby",
  Obscene: "obscene",
  EmptyBeat: "empty-beat"
};
const QualifiedAttributes = {
  AmllObscene: "amll:obscene",
  AmllEmptyBeat: "amll:empty-beat",
  TtsRuby: "tts:ruby"
};
const Values = {
  Word: "Word",
  Line: "Line",
  MimeXML: "application/xml",
  MusicName: "musicName",
  Artists: "artists",
  Album: "album",
  ISRC: "isrc",
  TTMLAuthorGithub: "ttmlAuthorGithub",
  TTMLAuthorGithubLogin: "ttmlAuthorGithubLogin",
  NCMMusicId: "ncmMusicId",
  QQMusicId: "qqMusicId",
  SpotifyId: "spotifyId",
  AppleMusicId: "appleMusicId",
  RoleBg: "x-bg",
  RoleTranslation: "x-translation",
  RoleRoman: "x-roman",
  Group: "group",
  Other: "other",
  AgentDefault: "v1",
  RubyContainer: "container",
  RubyBase: "base",
  RubyTextContainer: "textContainer",
  RubyText: "text",
  TimingMode: "timingMode",
  Language: "language"
};
var NodeType = /* @__PURE__ */ ((NodeType2) => {
  NodeType2[NodeType2["ELEMENT_NODE"] = 1] = "ELEMENT_NODE";
  NodeType2[NodeType2["ATTRIBUTE_NODE"] = 2] = "ATTRIBUTE_NODE";
  NodeType2[NodeType2["TEXT_NODE"] = 3] = "TEXT_NODE";
  NodeType2[NodeType2["CDATA_SECTION_NODE"] = 4] = "CDATA_SECTION_NODE";
  NodeType2[NodeType2["ENTITY_REFERENCE_NODE"] = 5] = "ENTITY_REFERENCE_NODE";
  NodeType2[NodeType2["ENTITY_NODE"] = 6] = "ENTITY_NODE";
  NodeType2[NodeType2["PROCESSING_INSTRUCTION_NODE"] = 7] = "PROCESSING_INSTRUCTION_NODE";
  NodeType2[NodeType2["COMMENT_NODE"] = 8] = "COMMENT_NODE";
  NodeType2[NodeType2["DOCUMENT_NODE"] = 9] = "DOCUMENT_NODE";
  NodeType2[NodeType2["DOCUMENT_TYPE_NODE"] = 10] = "DOCUMENT_TYPE_NODE";
  NodeType2[NodeType2["DOCUMENT_FRAGMENT_NODE"] = 11] = "DOCUMENT_FRAGMENT_NODE";
  NodeType2[NodeType2["NOTATION_NODE"] = 12] = "NOTATION_NODE";
  return NodeType2;
})(NodeType || {});
class TTMLParser {
  domParser;
  static TIME_REGEX = /^(?:(?:(?<hours>\d+):)?(?<minutes>\d+):)?(?<seconds>\d+(?:\.\d+)?)$/;
  static LEADING_SPACE_REGEX = /^\s/;
  static TRAILING_SPACE_REGEX = /\s$/;
  static MULTI_SPACE_REGEX = /\s+/g;
  normalizeText(text, trim = true) {
    if (!text) return "";
    const normalized = text.replace(TTMLParser.MULTI_SPACE_REGEX, " ");
    return trim ? normalized.trim() : normalized;
  }
  /**
   * 构造一个 TTML 解析器实例
   *
   * @param options 生成器配置选项
   *
   * 在 Node.js 环境下必须注入 `domParser` 实例（例如用 `@xmldom/xmldom` 等）
   */
  constructor(options) {
    if (options?.domParser) {
      this.domParser = options.domParser;
    } else if (typeof DOMParser !== "undefined") {
      this.domParser = new DOMParser();
    } else {
      throw new Error(
        "No DOMParser found. If you are running in Node.js, please inject a DOMParser (e.g., @xmldom/xmldom)."
      );
    }
  }
  /**
   * 解析 TTML 字符串的静态便捷方法
   * @param xmlStr 需要解析的 TTML XML 字符串
   * @param options 解析器配置选项，用于注入 DOM 依赖
   * @returns 解析后的结构化 TTML 数据结构
   * @throws 当输入的 XML 字符串格式无效时抛出异常
   */
  static parse(xmlStr, options) {
    const instance = new TTMLParser(options);
    return instance.parse(xmlStr);
  }
  /**
   * 解析 TTML 字符串
   * @param xmlStr 需要解析的 TTML XML 字符串
   * @returns 解析后的结构化 TTML 数据结构
   * @throws 当输入的 XML 字符串格式无效时抛出异常
   */
  parse(xmlStr) {
    if (!xmlStr || typeof xmlStr !== "string") {
      throw new Error("TTMLParser: Input must be a valid XML string.");
    }
    const doc = this.domParser.parseFromString(xmlStr, Values.MimeXML);
    const { metadata, sidecar } = this.parseHead(doc);
    const parserError = doc.getElementsByTagName(Elements.ParserError)[0];
    if (parserError) {
      throw new Error(
        `TTMLParser: XML parsing error: ${parserError.textContent}`
      );
    }
    const result = {
      metadata,
      lines: []
    };
    const root = doc.documentElement;
    if (root) {
      const lang = this.getAttr(root, NS.XML, Attributes.Lang);
      if (lang) {
        result.metadata.language = lang;
      }
      const timing = this.getAttr(root, NS.ITUNES, Attributes.Timing);
      if (timing && timing === Values.Word || timing === Values.Line) {
        result.metadata.timingMode = timing;
      }
    }
    this.parseBody(doc, result, sidecar);
    result.metadata.timingMode ??= this.inferTimingMode(result.lines);
    if (result.metadata.platformIds) {
      result.metadata.platformIds = this.sortPlatformIds(
        result.metadata.platformIds
      );
    }
    return result;
  }
  inferTimingMode(lines) {
    const hasWordTiming = lines.some(
      (line) => (line.words?.length ?? 0) > 1 || (line.backgroundVocal?.words?.length ?? 0) > 1
    );
    return hasWordTiming ? "Word" : "Line";
  }
  sortPlatformIds(platformIds) {
    const preferredOrder = [
      "ncmMusicId",
      "qqMusicId",
      "spotifyId",
      "appleMusicId"
    ];
    const orderedPlatformIds = {};
    for (const key of preferredOrder) {
      if (platformIds[key]) {
        orderedPlatformIds[key] = platformIds[key];
      }
    }
    for (const key of Object.keys(platformIds)) {
      if (!orderedPlatformIds[key]) {
        orderedPlatformIds[key] = platformIds[key];
      }
    }
    return orderedPlatformIds;
  }
  parseHead(doc) {
    const head = doc.getElementsByTagName(Elements.Head)[0];
    const resultMeta = {
      title: [],
      artist: [],
      album: [],
      isrc: [],
      authorIds: [],
      authorNames: [],
      songwriters: [],
      agents: {},
      rawProperties: {}
    };
    const sidecar = {};
    if (!head) {
      return { metadata: resultMeta, sidecar };
    }
    this.parseTTMElements(head, resultMeta);
    this.parseAMLLMeta(head, resultMeta);
    this.parseiTunesExtensions(head, resultMeta, sidecar);
    this.deduplicateMetadata(resultMeta);
    return { metadata: resultMeta, sidecar };
  }
  deduplicateMetadata(meta) {
    const dedupe = (arr) => arr ? Array.from(new Set(arr)) : [];
    meta.title = dedupe(meta.title);
    meta.artist = dedupe(meta.artist);
    meta.album = dedupe(meta.album);
    meta.isrc = dedupe(meta.isrc);
    meta.authorIds = dedupe(meta.authorIds);
    meta.authorNames = dedupe(meta.authorNames);
    meta.songwriters = dedupe(meta.songwriters);
    if (meta.platformIds) {
      for (const key of Object.keys(meta.platformIds)) {
        if (meta.platformIds[key]) {
          meta.platformIds[key] = dedupe(meta.platformIds[key]);
        }
      }
    }
    if (meta.rawProperties) {
      for (const key of Object.keys(meta.rawProperties)) {
        if (meta.rawProperties[key]) {
          meta.rawProperties[key] = dedupe(meta.rawProperties[key]);
        }
      }
    }
  }
  parseTTMElements(head, meta) {
    const titles = head.getElementsByTagNameNS(NS.TTM, Elements.Title);
    if (titles.length > 0 && titles[0].textContent) {
      meta.title?.push(titles[0].textContent.trim());
    }
    const agents = Array.from(
      head.getElementsByTagNameNS(NS.TTM, Elements.Agent)
    );
    for (const agent of agents) {
      const id = this.getAttr(agent, NS.XML, Attributes.Id);
      if (!id) continue;
      const type = this.getAttr(
        agent,
        NS.TTM,
        Attributes.Type,
        Attributes.Type
      );
      const names = agent.getElementsByTagNameNS(NS.TTM, Elements.Name);
      const agentObj = {
        id
      };
      if (type) {
        agentObj.type = type;
      }
      if (names.length > 0 && names[0].textContent) {
        const rawName = names[0].textContent.trim();
        if (rawName.length > 0) {
          agentObj.name = rawName;
        }
      }
      meta.agents ??= {};
      meta.agents[id] = agentObj;
    }
  }
  parseAMLLMeta(head, meta) {
    const metas = Array.from(
      head.getElementsByTagNameNS(NS.AMLL, Elements.Meta)
    );
    const validMetas = metas.filter((el) => {
      return this.getAttr(el, NS.AMLL, Attributes.Key) && this.getAttr(el, NS.AMLL, Attributes.Value);
    });
    for (const el of validMetas) {
      const key = this.getAttr(el, NS.AMLL, Attributes.Key);
      const value = this.getAttr(el, NS.AMLL, Attributes.Value)?.trim();
      if (!key || !value) continue;
      switch (key) {
        case Values.MusicName:
          meta.title?.push(value);
          break;
        case Values.Artists:
          meta.artist?.push(value);
          break;
        case Values.Album:
          meta.album?.push(value);
          break;
        case Values.ISRC:
          meta.isrc?.push(value);
          break;
        case Values.TTMLAuthorGithub:
          meta.authorIds?.push(value);
          break;
        case Values.TTMLAuthorGithubLogin:
          meta.authorNames?.push(value);
          break;
        case Values.NCMMusicId:
        case Values.QQMusicId:
        case Values.SpotifyId:
        case Values.AppleMusicId:
          meta.platformIds ??= {};
          (meta.platformIds[key] ??= []).push(value);
          break;
        default:
          meta.rawProperties ??= {};
          (meta.rawProperties[key] ??= []).push(value);
          break;
      }
    }
  }
  extractSubContent(base, lang, ignoreWords = false) {
    const result = {};
    const mainText = this.normalizeText(base.text);
    const hasMainWords = !ignoreWords && base.words && base.words.length > 0;
    if (mainText || hasMainWords) {
      const main = { text: mainText };
      if (lang) main.language = lang;
      if (hasMainWords) {
        const isZeroFallback = base.words?.length === 1 && base.words?.[0].startTime === 0 && base.words?.[0].endTime === 0;
        if (!isZeroFallback) main.words = base.words;
      }
      result.main = main;
    }
    if ("backgroundVocal" in base && base.backgroundVocal) {
      const bgVocal = base.backgroundVocal;
      const bgText = this.normalizeText(bgVocal.text);
      const hasBgWords = !ignoreWords && bgVocal.words && bgVocal.words.length > 0;
      if (bgText || hasBgWords) {
        const bg = { text: bgText };
        if (lang) bg.language = lang;
        if (hasBgWords) {
          const isZeroFallback = bgVocal.words?.length === 1 && bgVocal.words?.[0].startTime === 0 && bgVocal.words?.[0].endTime === 0;
          if (!isZeroFallback) bg.words = bgVocal.words;
        }
        result.bg = bg;
      }
    }
    return result;
  }
  parseiTunesExtensions(head, meta, sidecar) {
    const iTunesMetas = Array.from(
      head.getElementsByTagName(Elements.ITunesMetadata)
    );
    if (iTunesMetas.length === 0) return;
    for (const iTunesMeta of iTunesMetas) {
      const songwritersContainer = iTunesMeta.getElementsByTagName(
        Elements.Songwriters
      )[0];
      if (songwritersContainer) {
        const writers = Array.from(
          songwritersContainer.getElementsByTagName(Elements.Songwriter)
        );
        for (const writer of writers) {
          const name = writer.textContent?.trim();
          if (name) {
            meta.songwriters?.push(name);
          }
        }
      }
      const processEntries = (containerTagName, itemTagName, type) => {
        const container = iTunesMeta.getElementsByTagName(containerTagName)[0];
        if (!container) return;
        const items = Array.from(container.getElementsByTagName(itemTagName));
        for (const item of items) {
          const lang = this.getAttr(item, NS.XML, Attributes.Lang);
          const textNodes = Array.from(
            item.getElementsByTagName(Elements.Text)
          );
          for (const textNode of textNodes) {
            const forId = textNode.getAttribute(Attributes.For);
            const parsedContent = this.parseCommonContent(textNode);
            if (forId) {
              const subContents = this.extractSubContent(
                parsedContent,
                lang,
                false
              );
              sidecar[forId] ??= {};
              if (subContents.main) {
                (sidecar[forId][type] ??= []).push(subContents.main);
              }
              if (subContents.bg) {
                const bgType = type === "translations" ? "bgTranslations" : "bgRomanizations";
                (sidecar[forId][bgType] ??= []).push(subContents.bg);
              }
            }
          }
        }
      };
      processEntries(
        Elements.Translations,
        Elements.Translation,
        "translations"
      );
      processEntries(
        Elements.Transliterations,
        Elements.Transliteration,
        "romanizations"
      );
    }
  }
  parseTime(timeStr) {
    if (!timeStr) return 0;
    const cleanStr = timeStr.trim();
    if (cleanStr.length === 0) return 0;
    if (cleanStr.endsWith("s")) {
      const seconds = Number(cleanStr.slice(0, -1));
      if (Number.isNaN(seconds)) {
        return 0;
      }
      return Math.round(seconds * 1e3);
    }
    const match = cleanStr.match(TTMLParser.TIME_REGEX);
    if (match?.groups) {
      const { seconds, minutes, hours } = match.groups;
      const secNum = Number(seconds);
      const minNum = minutes ? parseInt(minutes, 10) : 0;
      const hrNum = hours ? parseInt(hours, 10) : 0;
      if (!Number.isNaN(secNum) && !Number.isNaN(minNum) && !Number.isNaN(hrNum)) {
        const totalSeconds = hrNum * 3600 + minNum * 60 + secNum;
        return Math.round(totalSeconds * 1e3);
      }
    }
    return 0;
  }
  parseBody(doc, result, sidecar) {
    const body = doc.getElementsByTagName(Elements.Body)[0];
    if (!body) return;
    const childNodes = Array.from(body.childNodes);
    let currentBlockIndex = 0;
    for (const node of childNodes) {
      if (node.nodeType !== NodeType.ELEMENT_NODE) continue;
      const el = node;
      const tagName = el.localName || el.tagName.toLowerCase().split(":").pop();
      if (tagName === Elements.Div) {
        currentBlockIndex++;
        const songPart = this.getAttr(el, NS.ITUNES, Attributes.SongPartKebab) || this.getAttr(el, NS.ITUNES, Attributes.SongPart);
        const pNodes = el.getElementsByTagNameNS(NS.TT, Elements.P);
        const pList = pNodes.length > 0 ? Array.from(pNodes) : Array.from(el.getElementsByTagName(Elements.P));
        for (const p of pList) {
          this.processLineElement(
            p,
            result.lines,
            sidecar,
            songPart,
            currentBlockIndex
          );
        }
      } else if (tagName === Elements.P) {
        currentBlockIndex++;
        this.processLineElement(
          el,
          result.lines,
          sidecar,
          void 0,
          currentBlockIndex
        );
      }
    }
  }
  processLineElement(p, lines, sidecar, songPart, blockIndex) {
    const id = this.getAttr(p, NS.ITUNES, Attributes.Key);
    if (!id) return;
    const baseContent = this.parseCommonContent(p);
    const line = {
      id,
      ...baseContent
    };
    if (songPart) line.songPart = songPart;
    if (blockIndex !== void 0) line.blockIndex = blockIndex;
    const agentId = this.getAttr(p, NS.TTM, Elements.Agent);
    if (agentId) line.agentId = agentId;
    const externalData = sidecar[id];
    if (externalData) {
      if (externalData.translations) {
        (line.translations ??= []).push(...externalData.translations);
      }
      if (externalData.romanizations) {
        (line.romanizations ??= []).push(...externalData.romanizations);
      }
      if (externalData.bgTranslations && line.backgroundVocal) {
        (line.backgroundVocal.translations ??= []).push(
          ...externalData.bgTranslations
        );
      }
      if (externalData.bgRomanizations && line.backgroundVocal) {
        (line.backgroundVocal.romanizations ??= []).push(
          ...externalData.bgRomanizations
        );
      }
    }
    lines.push(line);
  }
  parseCommonContent(element) {
    const beginAttr = this.getAttr(
      element,
      NS.XML,
      Attributes.Begin,
      Attributes.Begin
    );
    const endAttr = this.getAttr(
      element,
      NS.XML,
      Attributes.End,
      Attributes.End
    );
    const originalStartTime = this.parseTime(beginAttr);
    const originalEndTime = this.parseTime(endAttr);
    const state = this.extractNodeState(element);
    if (state.backgroundVocal) {
      if (state.bgTranslations.length > 0) {
        (state.backgroundVocal.translations ??= []).push(
          ...state.bgTranslations
        );
      }
      if (state.bgRomanizations.length > 0) {
        (state.backgroundVocal.romanizations ??= []).push(
          ...state.bgRomanizations
        );
      }
    }
    this.finalizeWords(state.words);
    const { startTime, endTime } = this.calculateTimeRange(
      originalStartTime,
      originalEndTime,
      state.words,
      state.backgroundVocal
    );
    const cleanFullText = this.normalizeText(state.fullText);
    const hasTimeAttrs = beginAttr !== null || endAttr !== null;
    this.applyFallbackWord(
      state.words,
      cleanFullText,
      hasTimeAttrs,
      originalStartTime,
      originalEndTime,
      startTime,
      endTime
    );
    return this.buildLyricBase(state, cleanFullText, startTime, endTime);
  }
  extractNodeState(element) {
    const state = {
      fullText: "",
      words: [],
      translations: [],
      romanizations: [],
      bgTranslations: [],
      bgRomanizations: [],
      backgroundVocal: void 0
    };
    const childNodes = Array.from(element.childNodes);
    for (const node of childNodes) {
      if (node.nodeType === NodeType.TEXT_NODE) {
        this.processTextNode(state, node);
      } else if (node.nodeType === NodeType.ELEMENT_NODE) {
        this.processElementNode(state, node);
      }
    }
    return state;
  }
  calculateTimeRange(originalStart, originalEnd, words, bgVocal) {
    let startTime = originalStart;
    let endTime = originalEnd;
    const timedElements = [...words];
    if (bgVocal) {
      timedElements.push(bgVocal);
    }
    if (timedElements.length > 0) {
      let minChildStart = Infinity;
      let maxChildEnd = 0;
      for (const el of timedElements) {
        if (el.startTime < minChildStart) minChildStart = el.startTime;
        if (el.endTime > maxChildEnd) maxChildEnd = el.endTime;
      }
      if (startTime === 0 || minChildStart > 0 && minChildStart < startTime) {
        startTime = minChildStart === Infinity ? 0 : minChildStart;
      }
      if (endTime === 0 || maxChildEnd > endTime) {
        endTime = maxChildEnd;
      }
    }
    return { startTime, endTime };
  }
  applyFallbackWord(words, cleanText, hasTimeAttrs, origStart, origEnd, calcStart, calcEnd) {
    if (words.length === 0 && cleanText.length > 0 && hasTimeAttrs) {
      words.push({
        text: cleanText,
        startTime: origStart > 0 ? origStart : calcStart,
        endTime: origEnd > 0 ? origEnd : calcEnd,
        endsWithSpace: false
      });
    }
  }
  buildLyricBase(state, cleanText, startTime, endTime) {
    return {
      text: cleanText,
      startTime,
      endTime,
      words: state.words.length > 0 ? state.words : void 0,
      translations: state.translations.length > 0 ? state.translations : void 0,
      romanizations: state.romanizations.length > 0 ? state.romanizations : void 0,
      backgroundVocal: state.backgroundVocal
    };
  }
  processTextNode(state, node) {
    const rawText = node.textContent || "";
    const isFormatting = rawText.includes("\n");
    if (isFormatting && rawText.trim().length === 0) return;
    const normalizedText = this.normalizeText(rawText, false);
    state.fullText += normalizedText;
    if (!isFormatting && normalizedText.length > 0 && normalizedText.trim().length === 0) {
      if (state.words.length > 0) {
        state.words[state.words.length - 1].endsWithSpace = true;
      }
    }
  }
  processElementNode(state, el) {
    const role = this.getAttr(el, NS.TTM, Attributes.Role);
    const rubyAttr = this.getAttr(
      el,
      NS.TTS,
      Attributes.Ruby,
      QualifiedAttributes.TtsRuby
    );
    if (rubyAttr === Values.RubyContainer) {
      this.processRubyElement(state, el);
      return;
    }
    switch (role) {
      case Values.RoleBg:
        state.backgroundVocal = this.parseBackgroundVocal(el);
        break;
      case Values.RoleTranslation: {
        const translation = this.parseInlineSubContent(el);
        if (translation) {
          if (translation.main) state.translations.push(translation.main);
          if (translation.bg) state.bgTranslations.push(translation.bg);
        }
        break;
      }
      case Values.RoleRoman: {
        const romanization = this.parseInlineSubContent(el);
        if (romanization) {
          if (romanization.main) state.romanizations.push(romanization.main);
          if (romanization.bg) state.bgRomanizations.push(romanization.bg);
        }
        break;
      }
      default:
        this.processWordElement(state, el);
        break;
    }
  }
  processRubyElement(state, containerEl) {
    const obsceneAttr = this.getAttr(
      containerEl,
      NS.AMLL,
      Attributes.Obscene,
      QualifiedAttributes.AmllObscene
    );
    const isObscene = obsceneAttr === "true";
    const emptyBeatAttr = this.getAttr(
      containerEl,
      NS.AMLL,
      Attributes.EmptyBeat,
      QualifiedAttributes.AmllEmptyBeat
    );
    let emptyBeat;
    if (emptyBeatAttr) {
      const parsedBeat = parseInt(emptyBeatAttr, 10);
      if (!Number.isNaN(parsedBeat)) {
        emptyBeat = parsedBeat;
      }
    }
    let baseText = "";
    const rubyTags = [];
    const childNodes = Array.from(containerEl.childNodes);
    for (const node of childNodes) {
      if (node.nodeType !== NodeType.ELEMENT_NODE) continue;
      const childEl = node;
      const childRubyAttr = this.getAttr(
        childEl,
        NS.TTS,
        Attributes.Ruby,
        QualifiedAttributes.TtsRuby
      );
      if (childRubyAttr === Values.RubyBase) {
        baseText = this.normalizeText(childEl.textContent, false);
      } else if (childRubyAttr === Values.RubyTextContainer) {
        const textNodes = Array.from(childEl.childNodes);
        for (const textNode of textNodes) {
          if (textNode.nodeType !== NodeType.ELEMENT_NODE) continue;
          const tNode = textNode;
          const tAttr = this.getAttr(
            tNode,
            NS.TTS,
            Attributes.Ruby,
            QualifiedAttributes.TtsRuby
          );
          if (tAttr === Values.RubyText) {
            const begin = this.getAttr(
              tNode,
              NS.XML,
              Attributes.Begin,
              Attributes.Begin
            );
            const end = this.getAttr(
              tNode,
              NS.XML,
              Attributes.End,
              Attributes.End
            );
            const text = this.normalizeText(tNode.textContent, false).trim();
            if (text && begin && end) {
              rubyTags.push({
                text,
                startTime: this.parseTime(begin),
                endTime: this.parseTime(end)
              });
            }
          }
        }
      }
    }
    if (!baseText) return;
    state.fullText += baseText;
    let startTime = 0;
    let endTime = 0;
    if (rubyTags.length > 0) {
      startTime = Math.min(...rubyTags.map((t) => t.startTime));
      endTime = Math.max(...rubyTags.map((t) => t.endTime));
    }
    const cleanBaseText = baseText.trim();
    if (cleanBaseText.length > 0) {
      const endsWithSpace = TTMLParser.TRAILING_SPACE_REGEX.test(baseText);
      const startsWithSpace = TTMLParser.LEADING_SPACE_REGEX.test(baseText);
      if (startsWithSpace && state.words.length > 0) {
        state.words[state.words.length - 1].endsWithSpace = true;
      }
      state.words.push({
        text: cleanBaseText,
        startTime,
        endTime,
        ruby: rubyTags.length > 0 ? rubyTags : void 0,
        endsWithSpace,
        obscene: isObscene ? true : void 0,
        emptyBeat
      });
    }
  }
  processWordElement(state, el) {
    const wBegin = this.getAttr(el, NS.XML, Attributes.Begin, Attributes.Begin);
    const wEnd = this.getAttr(el, NS.XML, Attributes.End, Attributes.End);
    const obsceneAttr = this.getAttr(
      el,
      NS.AMLL,
      Attributes.Obscene,
      QualifiedAttributes.AmllObscene
    );
    const isObscene = obsceneAttr === "true";
    const emptyBeatAttr = this.getAttr(
      el,
      NS.AMLL,
      Attributes.EmptyBeat,
      QualifiedAttributes.AmllEmptyBeat
    );
    let emptyBeat;
    if (emptyBeatAttr) {
      const parsedBeat = parseInt(emptyBeatAttr, 10);
      if (!Number.isNaN(parsedBeat)) {
        emptyBeat = parsedBeat;
      }
    }
    const rawWText = el.textContent || "";
    const normalizedWText = this.normalizeText(rawWText, false);
    state.fullText += normalizedWText;
    if (wBegin && wEnd) {
      const isFormatting = rawWText.includes("\n");
      let startsWithSpace = false;
      let endsWithSpace = false;
      if (!isFormatting) {
        startsWithSpace = TTMLParser.LEADING_SPACE_REGEX.test(normalizedWText);
        endsWithSpace = TTMLParser.TRAILING_SPACE_REGEX.test(normalizedWText);
      }
      const cleanText = normalizedWText.trim();
      if (startsWithSpace && state.words.length > 0) {
        state.words[state.words.length - 1].endsWithSpace = true;
      }
      if (cleanText.length > 0) {
        state.words.push({
          text: cleanText,
          startTime: this.parseTime(wBegin),
          endTime: this.parseTime(wEnd),
          endsWithSpace,
          obscene: isObscene ? true : void 0,
          emptyBeat
        });
      }
    }
  }
  parseBackgroundVocal(el) {
    const parsed = this.parseCommonContent(el);
    const { backgroundVocal, ...bgVocal } = parsed;
    bgVocal.text = bgVocal.text.replace(/^[(（]+/, "").replace(/[)）]+$/, "");
    if (bgVocal.words && bgVocal.words.length > 0) {
      bgVocal.words[0].text = bgVocal.words[0].text.replace(/^[(（]+/, "").trimStart();
      const lastIdx = bgVocal.words.length - 1;
      bgVocal.words[lastIdx].text = bgVocal.words[lastIdx].text.replace(/[)）]+$/, "").trimEnd();
    }
    return bgVocal;
  }
  parseInlineSubContent(el) {
    const lang = this.getAttr(el, NS.XML, Attributes.Lang);
    const parsed = this.parseCommonContent(el);
    const content = this.extractSubContent(parsed, lang, true);
    if (content.main || content.bg) {
      return content;
    }
    return null;
  }
  finalizeWords(words) {
    if (words.length === 0) return [];
    words[0].text = words[0].text.trimStart();
    const lastIdx = words.length - 1;
    words[lastIdx].text = words[lastIdx].text.trimEnd();
    words[lastIdx].endsWithSpace = false;
    return words;
  }
  getAttr(element, ns, localName, fallbackAttrName) {
    const val = element.getAttributeNS(ns, localName);
    if (val) return val;
    if (fallbackAttrName) {
      const fallbackVal = element.getAttribute(fallbackAttrName);
      if (fallbackVal) return fallbackVal;
    }
    if (element.hasAttributes()) {
      const attributes = Array.from(element.attributes);
      for (const attr of attributes) {
        const attrLocalName = attr.localName || attr.nodeName.split(":").pop();
        if (attrLocalName === localName) {
          return attr.value;
        }
      }
    }
    return null;
  }
}
function toAmllLyrics(result, options) {
  const amllLines = [];
  const convertToAmllLine = (source, isBG, isDuet) => {
    let amllWords = [];
    if (source.words && source.words.length > 0) {
      amllWords = source.words.map((w) => {
        const amllWord = {
          startTime: w.startTime,
          endTime: w.endTime,
          word: w.text + (w.endsWithSpace ? " " : ""),
          romanWord: "",
          obscene: w.obscene,
          emptyBeat: w.emptyBeat
        };
        if (w.ruby && w.ruby.length > 0) {
          amllWord.ruby = w.ruby.map((r) => ({
            startTime: r.startTime,
            endTime: r.endTime,
            word: r.text
          }));
        }
        return amllWord;
      });
    } else {
      amllWords = [
        {
          startTime: source.startTime,
          endTime: source.endTime,
          word: source.text,
          romanWord: ""
        }
      ];
    }
    let transText = "";
    if (source.translations && source.translations.length > 0) {
      const targetTrans = options?.translationLanguage && source.translations.find(
        (t) => t.language === options.translationLanguage
      ) || source.translations[0];
      transText = targetTrans.text;
    }
    let romanText = "";
    let romanWords;
    if (source.romanizations && source.romanizations.length > 0) {
      const targetRoman = options?.romanizationLanguage && source.romanizations.find(
        (r) => r.language === options.romanizationLanguage
      ) || source.romanizations[0];
      romanWords = targetRoman.words;
      if (!romanWords || romanWords.length === 0) {
        romanText = targetRoman.text;
      }
    }
    if (romanWords && amllWords.length > 0) {
      alignRomanization(amllWords, romanWords);
    }
    return {
      words: amllWords,
      translatedLyric: transText,
      romanLyric: romanText,
      isBG,
      isDuet,
      startTime: source.startTime,
      endTime: source.endTime
    };
  };
  let lastPersonAgentId = null;
  let lastPersonIsDuet = false;
  for (const line of result.lines) {
    const agentId = line.agentId || Values.AgentDefault;
    const agent = result.metadata.agents?.[agentId];
    const isGroup = agent?.type === Values.Group;
    const isOther = agent?.type === Values.Other;
    let currentIsDuet = false;
    if (isGroup) {
      currentIsDuet = false;
    } else {
      if (lastPersonAgentId === null) {
        currentIsDuet = !!isOther;
        lastPersonAgentId = agentId;
        lastPersonIsDuet = currentIsDuet;
      } else if (lastPersonAgentId === agentId) {
        currentIsDuet = lastPersonIsDuet;
      } else {
        currentIsDuet = !lastPersonIsDuet;
        lastPersonAgentId = agentId;
        lastPersonIsDuet = currentIsDuet;
      }
    }
    const amllMain = convertToAmllLine(line, false, currentIsDuet);
    amllLines.push(amllMain);
    if (line.backgroundVocal) {
      const simpleBg = convertToAmllLine(
        line.backgroundVocal,
        true,
        currentIsDuet
      );
      amllLines.push(simpleBg);
    }
  }
  const amllMetadata = [];
  const meta = result.metadata;
  if (meta.title) amllMetadata.push([Values.MusicName, meta.title]);
  if (meta.artist) amllMetadata.push([Values.Artists, meta.artist]);
  if (meta.album) amllMetadata.push([Values.Album, meta.album]);
  if (meta.isrc) amllMetadata.push([Values.ISRC, meta.isrc]);
  if (meta.authorIds)
    amllMetadata.push([Values.TTMLAuthorGithub, meta.authorIds]);
  if (meta.authorNames)
    amllMetadata.push([Values.TTMLAuthorGithubLogin, meta.authorNames]);
  if (meta.language) amllMetadata.push([Values.Language, [meta.language]]);
  if (meta.timingMode)
    amllMetadata.push([Values.TimingMode, [meta.timingMode]]);
  if (meta.songwriters)
    amllMetadata.push([Elements.Songwriters, meta.songwriters]);
  if (meta.platformIds) {
    if (meta.platformIds.ncmMusicId)
      amllMetadata.push([Values.NCMMusicId, meta.platformIds.ncmMusicId]);
    if (meta.platformIds.qqMusicId)
      amllMetadata.push([Values.QQMusicId, meta.platformIds.qqMusicId]);
    if (meta.platformIds.spotifyId)
      amllMetadata.push([Values.SpotifyId, meta.platformIds.spotifyId]);
    if (meta.platformIds.appleMusicId)
      amllMetadata.push([Values.AppleMusicId, meta.platformIds.appleMusicId]);
  }
  if (meta.rawProperties) {
    for (const [key, value] of Object.entries(meta.rawProperties)) {
      amllMetadata.push([key, value]);
    }
  }
  return {
    lines: amllLines,
    metadata: amllMetadata
  };
}
function alignRomanization(amllWords, romanWords) {
  let romanSearchStartIndex = 0;
  const MIN_IOU_THRESHOLD = 0.1;
  const FAST_TRACK_TOLERANCE_MS = 2;
  for (let i = 0; i < amllWords.length; i++) {
    const main = amllWords[i];
    const mainEndTime = main.endTime;
    let maxIou = 0;
    let bestMatchIndex = -1;
    let isFastTrackMatched = false;
    let j = romanSearchStartIndex;
    while (j < romanWords.length) {
      const sub = romanWords[j];
      if (Math.abs(main.startTime - sub.startTime) <= FAST_TRACK_TOLERANCE_MS) {
        main.romanWord = sub.text;
        romanSearchStartIndex = j + 1;
        isFastTrackMatched = true;
        break;
      }
      const subEndTime = sub.endTime;
      const overlapStart = Math.max(main.startTime, sub.startTime);
      const overlapEnd = Math.min(mainEndTime, subEndTime);
      const intersection = Math.max(0, overlapEnd - overlapStart);
      if (intersection > 0) {
        const unionStart = Math.min(main.startTime, sub.startTime);
        const unionEnd = Math.max(mainEndTime, subEndTime);
        const unionDuration = Math.max(1, unionEnd - unionStart);
        const iou = intersection / unionDuration;
        if (iou > maxIou) {
          maxIou = iou;
          bestMatchIndex = j;
        }
      }
      if (sub.startTime >= mainEndTime) {
        break;
      }
      j++;
    }
    if (!isFastTrackMatched && bestMatchIndex !== -1 && maxIou >= MIN_IOU_THRESHOLD) {
      main.romanWord = romanWords[bestMatchIndex].text;
      romanSearchStartIndex = bestMatchIndex + 1;
    }
  }
}
export {
  TTMLParser,
  toAmllLyrics
};
