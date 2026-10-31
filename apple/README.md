# 幕里 · Apple 原生客户端 2.16.12（build 2161207）

本目录是可独立编译的 SwiftUI iPhone / iPad / Apple TV 客户端。应用通过 URLSession 直接访问点播接口和直播订阅；iOS 与 tvOS 均使用 AVPlayer、AVPlayerLayer 和自定义播放控件，tvOS 使用公开焦点、方向键及播放 / 暂停命令，不依赖电脑、Web 服务、Node.js 或 Android 程序。

部署目标为 iOS / iPadOS 16.0+、tvOS 17.0+。设备目标为 arm64。本目录现有工程只含这两个原生目标；macOS / Windows 电脑客户端由项目的桌面端实现，本轮不新增原生 macOS 目标。

品牌显示名称统一为「幕里」，采用已确认的黑白标识。主屏幕图标、应用内设置和 Apple TV 侧栏使用相同图形。应用 ID、`KongwoTV.xcodeproj`、Scheme、Swift 类型和本机数据键保持原有技术标识，保证签名与数据兼容；当前构建产物名称为 `幕里.app`。历史构建证据保留当时的版本、路径和名称，不代表本轮已重新签名或安装。

本次品牌验证已通过 Xcode 27.1 的 iOS / tvOS Release arm64 设备编译（两端 build 2161207），Bundle 显示名、名称和可执行名均为「幕里」，8 张品牌 PNG 均为黑白。详见 [品牌验证结果](build-evidence/muli-rebrand-build7-20261021-121234-662841-results.json)、[iOS 编译日志](build-evidence/muli-rebrand-20261021-120603-137024-ios-release.log) 与 [tvOS 编译日志](build-evidence/muli-rebrand-build7-20261021-121155-705584-tvos-release.log)。已在 `dist/muli-2.16.12-build7/` 生成新名称且标明“需签名”的设备 IPA；未签名、未进行真机安装或播放验收。

## Apple TV 视觉方向

界面采用 Apple TV app 的侧栏、内容主视觉、继续观看与横向内容架组织方式，参考 [Apple TV app 导航说明](https://support.apple.com/guide/tvapp/navigate-the-apple-tv-app-atvb14e9d4d5/web)、[tvOS 设计指南](https://developer.apple.com/design/human-interface-guidelines/designing-for-tvos)、[焦点与选择](https://developer.apple.com/design/human-interface-guidelines/focus-and-selection/) 与 [动态效果](https://developer.apple.com/design/human-interface-guidelines/motion)。这是项目自身内容与操作的视觉重构，不引入 Apple 品牌资源或虚构影视评分。

首页主视觉取实际推荐的首部影片，继续观看来自本机真实历史，内容架按原有推荐顺序展示。底部标签与电视侧栏保留“推荐 / 搜索 / 直播 / 历史 / 设置”的原有入口；主视觉的“查看影片”进入详情，详情的“立即播放”沿用真实选集动作。详情先显示该影片真实封面，再以独立任务匹配并验证横向高清背景；失败时保留封面。播放、线路、选集和重试行为沿用原实现。共享主题位于 [Platform.swift](Sources/Platform.swift)；tvOS 导航及页面、iPhone / iPad 的底部标签与自适应页面位于 [Views.swift](Sources/Views.swift)。

## 交付与安装边界

本轮将 iPhone / iPad 与 Apple TV 的浏览页面和自定义播放器统一为 Apple TV 风格：深色 `#08090b / #111114`、中性灰材质、系统字体、白色主播放按钮、真实影片主视觉与横向内容架。tvOS 使用侧边主导航，iPhone / iPad 保留底部标签；遥控焦点以白色亮边和轻微放大呈现，并遵循系统“减少动态效果”。版本保持 `2.16.12`，iOS / tvOS 构建号均为 `2161207`。品牌更新不签名、不安装、不覆盖已连接设备。

| 设备目标 | 本地设备构建目录 | 安装条件 |
| --- | --- | --- |
| iPhone / iPad | [.build/iOS/Build/Products/Release-iphoneos/幕里.app](.build/iOS/Build/Products/Release-iphoneos/幕里.app) | 应用 ID `org.kongwotv.ios`；需匹配应用 ID、目标设备和系统的有效签名及描述文件 |
| Apple TV | [.build/tvOS/Build/Products/Release-appletvos/幕里.app](.build/tvOS/Build/Products/Release-appletvos/幕里.app) | 应用 ID `org.kongwotv.appletv`；自定义电视播放器设备构建，安装需 tvOS 对应签名及描述文件 |

本轮两个设备构建关闭签名，不能直接安装到普通实体设备。未签名 `.ipa` 归档仍需重新签名，不能称为可直接安装的成品。主交付流程负责集中打包；本轮不发布、不生成 App Store / TestFlight / Ad Hoc 包，不交付模拟器程序。

如需实体设备安装，在具备相应 Apple 开发者签名条件后，用 Xcode 打开 [KongwoTV.xcodeproj](KongwoTV.xcodeproj)，选择对应 Scheme，在 Signing & Capabilities 选择自己的团队及匹配的描述文件，再连接设备构建安装。Development 或 Ad Hoc 包仅适用于描述文件登记的设备；证书与描述文件的到期时间决定安装有效期。本轮未使用 `-allowProvisioningUpdates`，未注册应用或设备，未向 Apple Developer Portal 写入数据。

## 搜索结果过滤修复（2026-10-25）

iPhone / iPad 与 Apple TV 共用的原生搜索仓储，已同步现有手机搜索规则：搜索结果中标题含“电影解说”的条目会在数量限制前剔除，多源及旧结果合并时再次清洗；不按影片分类、简介或备注做此项屏蔽。首页推荐缓存与观看历史保持原行为。离线回归包含演员“周星驰”搜索中的正片与同名解说版，以及全部解说为空和前 60 条均为解说的情况。

两个设备目标均已关闭签名进行编译检查，日志位于根目录 `artifacts/search-title-filter-20261025/`。未向实体 Apple 设备安装；现有已安装客户端需要经过有效签名的新版才会采用修复。

## 高清详情背景（build 2161206）

iPhone / iPad 与 Apple TV 详情共用独立的 [BackdropArtwork.swift](Sources/BackdropArtwork.swift)、[BackdropRepository.swift](Sources/BackdropRepository.swift) 和 [ArtworkViews.swift](Sources/ArtworkViews.swift)。海报 `cover` 继续用于列表、历史和回退；没有给持久化 `Film` 增加字段。详情可补充稳定 ID 线索，背景任务独立于片源详情和播放；先显示封面，高清图片下载、真实尺寸检查和解码全部成功后才替换。换片、取消与离屏都校验当前请求身份，离屏释放解码图片。

工程直接将根目录 [artwork-catalog.json](../shared/artwork-catalog.json) 和 [tmdb-logo.png](../shared/tmdb-logo.png) 加入两个目标的 Bundle resources；不在本目录复制维护。构建与源码交付时必须保留 `apple/` 和 `shared/` 的同级目录关系。片目 JSON 允许额外字段；它只覆盖明确列出的已核实作品，不代表全片库免凭据。

匹配优先使用已提供的 TMDB / IMDb / 豆瓣稳定 ID：至少一个目录已知 ID 必须命中，目录已记录的其他 ID 不得冲突，目录未记录的可选 ID 不算冲突；仅提供未知 ID 且没有已知 ID 命中时回退。没有稳定 ID 时必须为规范化精确片名加严格年份；类型、年份或已知 ID 冲突、多个匹配、无年份且无稳定 ID 都保留封面。未配置凭据时不发 TMDB 搜索请求。配置后仅向 `https://api.themoviedb.org/3` 发正式 API 请求，通过 `/search/movie`、`/search/tv` 或 `/search/multi` 精确核对片名 / 原片名、年份与类型，再取 `/movie|tv/{id}/images?include_image_language=null,zh,en` 的真正 backdrops。最多读取 3 页搜索结果，超过此范围直接回退。

图片只接受固定 `https://image.tmdb.org/t/p/original` 域名的合法 hash 路径，宽高至少 1280×720、比例 1.5–2.4；优先无字、至少 1920 宽和像素更充足的图。网络请求 6 秒超时、资源总时限 10 秒，JSON 上限 2 MiB、图像上限 24 MiB；拒绝重定向，校验实际图像尺寸并按最长边 3840 像素解码。元数据和图像均查询去重；内存缓存成功 24 小时、失败 10 分钟，最多保留两张成功解码图片，应用重启后缓存重新建立。

“设置 → 高清背景图”可开关高清背景，并保存 / 更新 / 移除你自己的 TMDB v3 API Key 或读取令牌。含点的 JWT 使用 Bearer，v3 key 使用官方 `api_key` 参数；凭据仅存入本机 Keychain 的 `AfterFirstUnlockThisDeviceOnly` 项，不同步、不进入 UserDefaults、Film、历史、缓存键或日志。[TMDBCredentialStore.swift](Sources/TMDBCredentialStore.swift) 实现安全存储。来源区展示官方 logo、链接及声明：

> This product uses the TMDB API but is not endorsed or certified by TMDB.

本轮没有 TMDB 凭据，没有查找或嵌入第三方 key，没有抓取 TMDB 网页，也没有执行真实凭据下的 API 联调。已在本机 iPhone / iPad 调试模拟器中用真实 360 来源详情和真实 TMDB CDN 加载《燃烧女子的肖像》2019，实际解码 3840×2160；设备安装与实机效果由后续验收确认。

## Apple TV 播放器

[TVPlayer.swift](Sources/TVPlayer.swift) 仅在 tvOS 编译，是全屏 AVPlayerLayer 视频与自定义覆盖控件：

- 顶栏为返回、片名、当前剧集 / 线路及更多设置；底部为白色细进度条、缓冲范围、白色主播放 / 暂停、下一集、实际播放时间、倍速、选集 / 选台。焦点使用白色亮边与轻微缩放，当前选项以中性灰材质标识；系统启用“减少动态效果”时关闭焦点缩放。
- 控件约 4 秒后自动隐藏，条件为当前播放中、无缓冲 / 错误、无菜单、无进度预览且未启用 VoiceOver。任何控件操作或焦点变化重新计时；菜单、暂停及预览期间保持显示。
- 隐藏控件时按确认或上下方向键显示控件；左右方向键开始时间预览。焦点位于进度条时，左右每次调整 10 秒，按确认提交跳转；返回取消，不提前 seek。预览绑定开始时的剧集身份，换集、后台或离屏会清理。
- 遥控器播放 / 暂停键始终绑定真实 AVPlayer 播放状态。结束后再次播放会从头重播；断点续播、自动下一集、选集切换及错误重试沿用原播放模型。
- 返回键分层处理：关闭菜单、取消时间预览、隐藏控件、退出播放。顶栏返回和“返回原页面换源”会回到实际进入播放器的页面。
- 倍速为 `0.5 / 0.75 / 1 / 1.25 / 1.5 / 2 / 3×`，保存到本机。暂停恢复、断点恢复、下一集及重试均按选定倍率播放，避免 `play()` 将 TV 倍率重置为 1×。
- 选集 / 选台抽屉显示请求中实际的项目，当前项高亮；仅在直播请求确实有多个频道时显示选台。直播固定 1×，隐藏不可用的进度、总时长、倍速、下一集及自动连播设置。
- 更多设置提供实际的适应 / 铺满（AVPlayerLayer.videoGravity）、自动连播开关、重新连接、返回原页面换源和遥控器说明。铺满会裁切边缘；电视音量由遥控器音量键及实际输出设备控制。
- 通过公开 AVPictureInPictureController(playerLayer:) 保留画中画，仅在系统实际可用或已在画中画时显示入口。显式退出会停止画中画并释放播放资源。画中画、遥控焦点和实际音视频输出仍需 Apple TV 硬件验收。

## 手机和平板界面

- 主页、搜索、详情、直播、历史与设置共享中性深色背景、灰白文字、圆角海报与胶囊按钮；首页使用真实推荐海报的大幅主视觉、继续观看和推荐内容架。详情先显示封面，再独立加载并验证高清横向背景，保留大标题与白色主播放操作。
- iPhone 使用底部标签，搜索海报网格和首页操作适配窄屏；iPad 使用更宽内容区域及自适应网格。首页双操作在空间不足时纵向排列。竖向窗口默认 16:9 视频加详情与选集，横向窗口默认沉浸播放；iPad 宽竖屏详情与选集并排。
- 播放界面为黑底、返回与片名、更多、左侧锁定，底部白色主播放 / 暂停、下一集、时间、白色细进度、倍速、选集及全屏；HUD 使用系统灰色材质。横屏返回先退出全屏，再返回才离开播放。控件显隐与侧抽屉遵循“减少动态效果”。
- 更多设置提供适应 / 铺满、返回原页面换源、手势说明及系统实际可用时的画中画；正常倍率为 0.5–3×，直播固定 1×。

| 手机操作 | 实际行为 |
| --- | --- |
| 单击画面 | 显示 / 隐藏控制；VoiceOver 开启时保留可访问控件 |
| 双击画面 | 播放 / 暂停，单击等待双击识别失败 |
| 水平拖动 | 预览目标时间，正常单指松手才 seek |
| 左侧上下滑动 | 调整播放窗口所在实际屏幕的亮度 |
| 右侧上下滑动 | 公开 MPVolumeView / UISlider 调节系统音量，HUD 读取实际 outputVolume |
| 播放中长按 | 临时使用 max(2, 原倍率)，松手恢复；暂停时长按不启动播放 |
| 左侧锁定 | 屏蔽其他播放手势、控制与竖屏详情，仅保留解锁 |

手机拖动会锁定方向和左右区域；多指、系统取消、换集、窗口变化及离屏会清理临时状态。取消不提交 seek，未完成的亮度 / 音量拖动恢复到拖动前值；后台和退出恢复进入前亮度。iPad 多任务窗口、外接屏幕与系统旋转策略可能限制方向，外部音频输出可能限制音量调节。

## 数据与原有功能

- 首页并发聚合启用的点播源，逐源显示真实状态，成功推荐缓存在本机；搜索按片名聚合多个来源。
- 详情加载简介、播放线路和集数，优先列出 HLS 线路；播放支持断点续播、自动下一集与后台音频。
- 直播自带频道快照、分组、搜索和在线订阅更新，更新失败保留已有目录。
- 本机保存最多 80 条观看记录，可继续播放、删除或清空；设置中可开关来源、自动下一集，并查看来源与许可证。
- tvOS 使用侧栏主导航，首页为大幅影片主视觉、继续观看与横向推荐架；搜索保留海报网格，设置改为分组面板。页面与播放器焦点统一使用白色亮边，减少动态效果开启时不放大。播放器原有遥控、时间预览和播放状态行为保留。

AVPlayer 需要源站提供 Apple 平台兼容的媒体格式；普通网页播放地址、DRM、防盗链或不兼容编码可能无法播放，可返回详情切换线路或搜索其他来源。直播可能受 IPv6、地区或时效限制。HTTP 节目源所需 ATS 例外保留在应用配置中。

## 使用 Xcode 构建

打开 [KongwoTV.xcodeproj](KongwoTV.xcodeproj)，选择 `KongwoTV-iOS` 或 `KongwoTV-tvOS`。正常构建不需要 XcodeGen、CocoaPods、Swift Package 下载或 Python 图像库。在仓库根目录运行：

```bash
# 默认只构建两个设备目标，明确关闭签名
python3 apple/tools/build.py

# 可选开发验证，不属于默认交付
python3 apple/tools/build.py --simulators --test
```

[build.py](tools/build.py) 使用系统 xcodebuild 和 Python 标准库，保存构建日志。直接命令与脚本设置相同：

```bash
xcodebuild -project apple/KongwoTV.xcodeproj \
  -scheme KongwoTV-iOS -configuration Release \
  -destination 'generic/platform=iOS' \
  -derivedDataPath apple/.build/iOS \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build

xcodebuild -project apple/KongwoTV.xcodeproj \
  -scheme KongwoTV-tvOS -configuration Release \
  -destination 'generic/platform=tvOS' \
  -derivedDataPath apple/.build/tvOS \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build
```

[MobilePlayer.swift](Sources/MobilePlayer.swift) / [MobilePlatform.swift](Sources/MobilePlatform.swift) 仅在 iOS 编译具体实现，[TVPlayer.swift](Sources/TVPlayer.swift) 仅在 tvOS 编译具体实现。三者均加入两个 target 的源码清单，以编译条件隔离。修改列表后可运行 [generate_project.py](tools/generate_project.py) 重新生成工程；生成器自动收集 Swift 源码，同步 iOS / tvOS build `2161207`。

[package.py](tools/package.py) 是历史全平台打包工具，本轮没有运行，避免带入旧模拟器或其他平台产物。

## 本轮验证证据与限制

本轮使用 Xcode `27.1 / 27A9275` 运行 `python3 apple/tools/verify_artwork.py --devices`，两个 Release arm64 设备目标均 `BUILD SUCCEEDED`，签名参数为 `CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO`。[最终验证结果](build-evidence/artwork-build6-20261019-181942-919169-results.json) 记录版本 `2.16.12 / 2161206`、两个 Bundle 内 7 条共享片目与 logo，以及 Release 二进制未包含 DEBUG 预览启动参数。完整日志为 [iOS 设备编译](build-evidence/artwork-build6-20261019-181942-919169-ios-release-device.log) 和 [tvOS 设备编译](build-evidence/artwork-build6-20261019-181942-919169-tvos-release-device.log)。历史证据保留，新日志均使用 `artwork-build6-` 前缀。

现有 [RepositorySmoke.swift](Tests/RepositorySmoke.swift) 与新增 [ArtworkSmoke.swift](Tests/ArtworkSmoke.swift) 均以 `swiftc -parse-as-library` 编译并离线运行，编译 / 运行退出均为 `0`。[原解析器验证](build-evidence/artwork-build6-20261019-181942-919169-repositorysmoke-run.log) 覆盖原 JSON / M3U、播放线路、聚合和历史行为；[背景专项验证](build-evidence/artwork-build6-20261019-181942-919169-artworksmoke-run.log) 的 15 组 PASS 覆盖同名不同年、电影 / 剧集冲突、稳定 ID 的已知 / 未知字段边界、原片名、坏响应和真实坏图片回退、URL / 尺寸拒绝、旧 Film / 历史兼容、缺少凭据零 API 请求、20 并发查询去重、24 小时 / 10 分钟缓存到期、跨页歧义，以及 TV 的官方外部 IMDb 字段。本轮未运行全来源 / 直播网络测试。

通过 [qa_artwork_simulators.py](tools/qa_artwork_simulators.py) 使用已安装 iOS 27.0 运行时创建两个独立命名的临时模拟器：iPhone 18 Pro、iPad Pro 13-inch (M5)。仅 DEBUG 且仅模拟器可通过 `--artwork-qa-detail` 进入 [ArtworkDebugPreview.swift](Sources/ArtworkDebugPreview.swift) 中同一个真实 `DetailView`；页面明确标记“DEBUG · 调试模拟器验证”。真实来源为 360，影片 ID `4342`，详情、简介、1 集选集与播放按钮正常返回；横图来自共享目录匹配与真实 CDN，实际解码 3840×2160；关闭高清时显示真实原封面，无伪造元数据或 API 回应。

| 原生调试验证 | 高清背景 | 关闭高清后的原封面 |
| --- | --- | --- |
| iPhone 18 Pro | [高清截图](build-evidence/artwork-build6-20261019-181343-507708-native-qa-iphone-backdrop-debug-simulator.png) | [原封面截图](build-evidence/artwork-build6-20261019-181343-507708-native-qa-iphone-cover-debug-simulator.png) |
| iPad Pro 13-inch (M5) | [高清截图](build-evidence/artwork-build6-20261019-181343-507708-native-qa-ipad-backdrop-debug-simulator.png) | [原封面截图](build-evidence/artwork-build6-20261019-181343-507708-native-qa-ipad-cover-debug-simulator.png) |

[模拟器验证记录](build-evidence/artwork-build6-20261019-181343-507708-native-qa-results.json) 记录两台临时模拟器均已关闭并删除，未操作其他模拟器或真机，未下载运行时。本机没有 tvOS runtime，因此 tvOS 只完成设备编译、没有运行截图。模拟器程序仅用于验证，不作为交付物；两个设备 `.app` 均未签名，需有效签名后才能安装。真实 TMDB 凭据联调、实机 Keychain、Apple TV 焦点 / 遥控器和实际播放输出仍待设备验收。

## 许可与来源

完整 GNU AGPL v3 许可证保留在 [LICENSE.txt](Resources/LICENSE.txt)。上游作者、真实节目目录与数据源归属保留在 [NOTICE.txt](Resources/NOTICE.txt)，并可在应用“设置 → 来源与开源许可”查看。

应用不提供影视内容托管，不制作或上传影片。请仅访问你有权观看的内容。第三方数据源的内容、版权与可用性由相应提供者负责。
