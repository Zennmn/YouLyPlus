# 测试新版 Apple Music 播放器

Chrome / Edge 可直接加载已经构建好的 `dist/youlyplus-amll-chrome` 目录。

1. 暂时关闭商店版 YouLy+，避免多个版本同时注入。
2. 在浏览器扩展管理页面开启开发者模式，选择“加载已解压的扩展”，选择上述目录。
3. 刷新 Apple Music 网页，播放歌曲并打开展开／全屏歌词播放页。

播放器直接使用本地 AMLL 的 PrebuiltLyricPlayer、布局、图标和组件 CSS。
Apple Music 四源的 TTML 使用同一份本地 AMLL TTMLParser / toAmllLyrics：保留 v1/v2 演唱者分侧、group/other 类型规则、x-bg 和声的独立时间与翻译/音译。逐字音译按 AMLL 使用 romanWord，不额外重复整行；关闭逐字后保留行音译及和声身份。中文简化和重复副轴清理仍在显示阶段执行。
额外的翻译、来源、偏移和原生播放器回退操作位于已有的“…”菜单入口。

如果更新过代码，运行 `npm run package:chrome`，再重新加载扩展并刷新网页。
本地模拟预览可运行 `npm run dev`；它不播放真实音频。

当前已通过生产构建和 78 项自动测试，包含不经过开发服务器的生产脚本启动检查。实际 Apple Music 登录后的播放、网页 DOM
兼容性及 AirPlay 支持情况，由用户进行联调；AirPlay 取决于浏览器是否提供对应能力。

歌词时间通过 Jotai 订阅直接送入 AMLL 核心，避免逐帧 React 重渲染和反复绑定歌词事件；播放状态快照不再重复应用设置或为单纯时间变化广播全量控制状态。模拟 144/240Hz 时间输入验证逐帧转发及 seek/卸载清理，但这不是用户真实网页 FPS 测量。AMLL 的原有逐字遮罩、弹簧、模糊视觉不变；歌词动画走浏览器 requestAnimationFrame，背景单独维持原有帧率/轻量设置。

用户实页Performance录制确认主要耗时为浏览器Layerize与样式更新，MusicKit内置ResizeObserver polyfill会在DOM变化后读取offsetWidth并触发样式计算。AMLL就绪后，原生全屏播放器的视觉子树改为display:none，不再只是visibility:hidden，以排除被遮住界面的布局/合成开销；切回原生或卸载AMLL时移除标记并恢复原样。未修改MusicKit播放实例或AMLL核心动画。该修改对真实帧率和总Layerize耗时的收益，仍需在同一歌曲更新后采样确认。

继续隔离整页渲染：AMLL原组件现在在扩展自己的iframe文档运行，父Apple Music页只挂载固定大小的iframe并转发播放/歌词/菜单消息，不再加载AMLL React/CSS。这样Apple文档级监听器不会观察到歌词内部的逐帧DOM变化。播放仍使用已有MusicKit实例，来源/翻译/偏移/背景保存与原生回退沿用已有逻辑。仅传视觉设置和歌曲显示字段，不向iframe传LLM密钥或MusicKit凭据；校验双方窗口/来源/每次挂载channel并限制调用方法。12秒未就绪回退原生；关闭播放器移除frame并清理监听。诊断报告context.renderDocument为extension-frame-v1。当前仅验证桥接与本地交互，不将模拟页表现宣称为Chrome登录实页帧率改善。

排查真实卡顿：重新加载扩展并刷新 Apple Music，在实际卡顿的歌曲全屏播放器“…”菜单点击“卡顿诊断（20 秒）”，保持前台播放，不切歌、不拖进度。20秒后菜单自动显示采集完成，点击“导出诊断报告”下载 JSON。报告采集帧回调间隔、播放时间输入、AMLL核心同步计算耗时和浏览器可用的长任务/长动画帧，包含配置与数值，不采集歌词、网页URL或账户/翻译凭据。平时不采集，不增加观察器或额外动画循环，不改变动画效果。暂停、隐藏、切歌、重新加载歌词、设置变化会提前结束并保留部分报告；关闭播放器会清理采集。报告保留在当前播放器内存，导出后可发回分析。

报告中的回调Hz不是显示器刷新率或实际呈现FPS；核心方法耗时包含嵌套调用、只测同步JS。若时间同步和核心耗时正常但仍视觉卡顿，需进一步用Chrome Performance录制定位绘制/合成/GPU或其他页面代码。诊断入口与导出流程已在本地模拟页验证，模拟页数据不能代表已登录Apple Music扩展环境；仍需用户实页报告才能判断现场原因。

Apple Music 歌词按 **AMLL TTML DB → LunaBeat → AmLyrics → Apple Music 原生歌词** 依次尝试，前一个没有可用歌词或请求失败才进入下一个。按 Apple Music ID 精确匹配，AmLyrics 也匹配 alternateIds；更新后不沿用之前的外部源缓存。已有其他平台的歌词设置不受影响。

“…”菜单中的歌词源可查看当前来源并手动切换。LunaBeat 和 AmLyrics 的索引缓存 6 小时；“重新加载歌词”会强制检查源和索引更新。原生歌词晚到不会替换已经采用的前三个源。

播放器菜单会记住翻译/音译模式（包括原文关闭状态）与动态背景开关，刷新或重新打开后恢复。手动歌词源和偏移按 Apple Music 歌曲 ID 保存，切歌后互不影响，同一首再播放时恢复；选择“自动”可清除该歌的手动来源偏好，恢复四源优先级。保存的源暂时不可用会回退其他源。偏移立即提交后台存储，支持恢复旧版本偏移与记住归零；不受歌词缓存格式版本变化影响。此前从未写入存储的模式/来源需要更新后重新选择一次。

首次下载 LunaBeat / AmLyrics 索引的缓存写入不再当作用户设置变化，避免重新触发上一首歌曲的请求而取消当前加载。回归测试覆盖上一首仍有缓存、当前源回退尚未完成时的首次索引写入。

Apple Music 播放器会在本地将中文原词和中文译文转为简体，逐字时间与伴唱标记保持不变；原词转简体后与中文副轴内容相同时去掉重复副轴（忽略标点和空白差异）。没有副轴时直接转换原词。外文原词、日文原词不作中文转换，外文歌的中文译文保留并转简体；粤语等不同内容的中文转述也保留。转换仅影响显示，原始歌词缓存保留。

Apple Music 原生源的逐字和普通歌词均参考 AMDL 的获取方法：请求歌曲详情 `songs/{id}?l=...&include=lyrics,syllable-lyrics&extend=ttmlLocalizations`。优先读取 `relationships["syllable-lyrics"].data[0].attributes.ttmlLocalizations`，其次读取该关系的 `ttml`，缺少逐字歌词时读取 `relationships.lyrics.data[0].attributes.ttml`。请求在网页内使用当前 MusicKit Token 与已有登录 Cookie，凭据不传给外部歌词源。测试原生源时可在播放器“…”菜单中手动选择 Apple Music。

原生歌词语言优先使用设置中的翻译目标，其次使用浏览器语言，中文补全为 `zh-Hans-CN` / `zh-Hant-TW` 等标签，不再随 Apple Music 网页语言变化。修改翻译目标后刷新网页，使原生请求重新使用新语言。开启“翻译”或“双语/音译”显示模式时，TTML 自带译文可立即显示，翻译服务失败不会隐藏已有译文；关闭翻译显示仍会隐藏译文。

播放器“…”菜单中的“下载 AM 原生 TTML”可保存当前歌曲的 Apple Music 原始 `.ttml` 文件，文件名包含歌手、歌名和 Apple Music ID。即使当前显示第三方源也可下载，不会切换歌词源。优先复用已获取的原生文件，没有时通过现有登录会话重新获取，保留 AM 返回的逐字/逐行时间及自带翻译，不加入机器翻译或显示阶段的繁简转换。获取期间切歌会取消本次下载；未获取到原生 TTML 时显示提示，不用第三方歌词代替。

源说明：[AMLL TTML DB](https://github.com/amll-dev/amll-ttml-db)、[LunaBeat 接入文档](https://github.com/2755337087/ttml-hub/blob/main/docs/integration.md)、[AmLyrics](https://github.com/Zennmn/am-lyrics)。

Apple Music 的机器/AI翻译仅在使用原生歌词源、完全没有自带翻译轴且歌曲判定为外文时允许；只要存在翻译轴，无论语言是否匹配、是否翻译完整，都只显示自带译文，不补译，也不读取旧机翻缓存。AMLL、LunaBeat、AmLyrics只显示自带译文，不调用机翻服务，也不读取旧机翻缓存。翻译到中文时逐句跳过中文原句和无文字行，无待翻译句子时不请求服务。语言识别和音译功能沿用现有逻辑；歌词源顺序仍为AMLL → LunaBeat → AmLyrics → Apple Music原生（第三方顺序可按设置调整）。

在扩展设置的“来源”页，音乐平台默认选中 Apple Music，展示 AMLL / LunaBeat / AmLyrics / Apple Music。前三个源可拖动排序、移除或添加，Apple Music 固定在最后回退；修改会保存并用于实际取词。YouTube Music / Tidal 的来源可通过平台下拉框单独查看。

第三方 LLM：在“翻译 → 翻译提供商”选择“第三方 LLM（兼容 Chat Completions）”，填写 API 地址、API Key 和模型 ID。支持基础地址（如 `https://example.com/v1`）或完整 `/chat/completions` 地址，支持无需 Key 的本地服务。点击“授权此地址并测试连接”授予该服务地址的访问权限，并用一行示例文本测试；测试成功后即可用于外文歌词翻译。当前接入为 Chat Completions 格式，不适用于只提供其他原生协议的接口。密钥只发往所填地址，接口报错时保留错误，不静默切换到 Google。
