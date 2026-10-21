# YouLy+ Apple Music

为 Apple Music 网页提供 AMLL 全屏播放器、逐字歌词、多来源 TTML、本地歌词和翻译/音译。本分支仅支持 [Apple Music 网页](https://music.apple.com/)。

## 安装与更新

需要 Node.js 及 npm。在项目目录运行：

```sh
npm ci
npm run package:chrome
```

在 Chrome / Edge 扩展管理页开启开发者模式，加载 `dist/youlyplus-amll-chrome`。请先关闭其他版本的 YouLy+，避免重复注入。更新源码后重新运行上述打包命令，再重载扩展并刷新 Apple Music 网页。

`bundle.ps1`（PowerShell 7）或 `bundle.sh` 在同一次构建后生成 Chrome 和 Firefox 压缩包，共用 `scripts/package-chrome.mjs` 的包装规则。Firefox 包保留作为兼容出口，实际浏览器功能由用户手动验证。

## 功能

- 使用本地 AMLL 的播放器、歌词、背景、播放控制和自动横竖布局；播放仍由网页现有 MusicKit 实例负责。
- 歌词按 **AMLL TTML DB → LunaBeat → AmLyrics → Apple Music 原生** 获取。前三个来源可调整顺序，Apple Music 固定为最终回退。
- 从播放器菜单导入当前歌曲的 TTML，按 Apple Music ID 保存并优先在自动模式中使用。设置页管理本地歌词；旧版已导入记录继续兼容。
- 下载当前歌曲的原生 TTML，支持离线提取、LLM 翻译和独立翻译轴写回。
- 保留歌词自带翻译与音译；机器翻译仅作用于没有自带翻译轴的 Apple Music 原生外文歌词。
- 支持 Google、Gemini、OpenRouter、DeepL、自定义兼容接口的 LLM 翻译，以及离线/在线音译。
- 持久化显示模式、背景、按歌曲保存的来源与偏移；支持全播放器字体/字体文件导入、歌名地区修正、浏览器全屏与原生播放器回退。
- AMLL 在扩展 iframe 中隔离渲染，提供按需卡顿诊断与报告导出。

使用方法及手动检查见 [播放器指南](docs/applemusic-amll-testing.md)，离线翻译见 [TTML 翻译说明](docs/ttml-translation.md)。设置保存后会应用到当前歌曲；翻译服务、模型、提示词和目标语言的改变使用独立缓存。扩展总开关需要刷新网页时，设置页会提供提示。

## 开发与目录

```sh
npm run dev           # 本地模拟预览，不播放真实音频
npm run build         # 构建 TTML 解析器与 AMLL 播放器
npm run package:chrome
```

| 目录 | 职责 |
| --- | --- |
| `src/inject/applemusic` | 页面内 MusicKit 控制与原生歌词/歌曲信息获取 |
| `src/modules/applemusic` | 内容脚本与扩展播放器桥接 |
| `src/modules/lyrics` | 歌词、翻译与音译状态协调 |
| `src/background` | 扩展 Service Worker：歌词源、存储、翻译与离线音译 |
| `ui/applemusic-player` | 播放器集成源码 |
| `vendor/amll` | 固定版本的 AMLL 源码及本地补丁说明 |
| `src/vendor` | 由构建生成的播放器与解析器产物 |

设置默认值集中在 `src/lib/defaultSettings.js`。不需要部署独立服务端。`tests/` 保留开发回归材料；功能验证由用户手动进行，构建成功不代表真实 Apple Music 会话已验证。

## 来源与许可

本项目基于 [ibratabian17/YouLyPlus](https://github.com/ibratabian17/YouLyPlus)，播放器基于 [AMLL](https://github.com/amll-dev/applemusic-like-lyrics)。感谢原项目、歌词数据库和各依赖的贡献者。

本分支整体使用 **AGPL-3.0-only**。完整协议见 [LICENSE](LICENSE)，原 YouLy+ 的 MIT 版权与许可及其他第三方声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。当前分支源码与问题反馈分别位于 [Zennmn/YouLyPlus](https://github.com/Zennmn/YouLyPlus) 和 [Issues](https://github.com/Zennmn/YouLyPlus/issues)。
