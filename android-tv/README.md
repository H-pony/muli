# 幕里 Android

独立运行的 Java / AndroidX Media3 客户端，提供电视版和手机 / 平板版。应用直接访问内置采集接口与直播地址，不依赖电脑上的 Next.js 服务，也不需要网页访问密码。

| Flavor | 适用设备 | 应用标签 | applicationId |
| --- | --- | --- | --- |
| `tv` | 小米电视、Android 电视、盒子 | 幕里 | `org.kongwotv.tv` |
| `mobile` | Android 手机、平板 | 幕里 | `org.kongwotv.mobile` |

两个版本均为 `versionName 2.16.12`；电视版与手机 / 平板版均为 `versionCode 2161209`。支持 Android 5.0（API 21）及以上；Java namespace 为 `org.kongwotv.tv`。使用设备自带的媒体解码器，没有 ABI 限制。

本次由「空我TV」更名为「幕里」，统一使用黑白幕布标识；沿用现有 `org.kongwotv` 包名、签名和本机数据标识。使用同一签名的对应 flavor APK 覆盖安装，可保留观看记录、进度与偏好。更早的 `org.libretv.tv` 是独立应用，其数据不会自动迁移。详细步骤见 [安卓安装说明](./小米电视安装说明.md)。

## 使用

电视版按用户提供的参考图采用顶部横向导航，提供「首页」「直播」「搜索」「资料库」「设置」。首页使用 `#0D1117` 底色、全幅电影背景、左下影片信息与白色播放按钮，下方衔接横向海报片架。1920×1080 下主视觉约占屏高 75%，保留首屏片架预览；内容与控件保留约 80px 水平安全边距。遥控器左右切换导航，向下进入内容区，焦点以缩放、白色亮边或白底标识。

首页主视觉提供手动切换与分页标记，使用真实影片、简介及独立高清横图；「立即播放」实时读取详情并播放，「查看影片详情」进入原详情与选集流程。精选入口在 `app/src/tv/assets/home-featured.json`，只引用当前来源配置中存在的接口；三部首批电影已核实来源 ID、年份、豆瓣 ID 与 HLS 清单。横图身份仍统一使用根目录 `shared/artwork-catalog.json`；三张已核实的 3840×2160 原始 JPEG 随 tv flavor 保存，首屏不依赖 CDN。原图未重新编码，沿用有界解码与内存缓存；关闭高清图片后仍显示来源海报。其他影片继续使用正式横图查询与原海报回退，不加入凭据。上游详情与精选身份不一致时停止关联，提示从搜索确认；横图失败回退真实原海报。来源接口与实际播放仍受上游可用性影响。

首页海报片架继续显示聚合目录和本机观看进度，不生成评分、会员状态或用户头像。搜索或直播筛选按输入法搜索 / 完成、回车或页面搜索按钮提交后，关闭键盘并把焦点移到搜索按钮；向左可重新进入输入框。回车抬起与长按重复事件不会再次提交。

电视播放器顶部保留返回、片名和更多；底部使用白色细进度条与半透明黑灰控制面板，排列播放 / 暂停、下一集、播放时间、倍速、选集和画面设置。白色焦点与轻微缩放明确标识当前操作，顶部与底部的焦点路径固定；普通缓冲不会擅自弹出控制栏。播放时无操作约 6 秒收起控制，暂停时保留控制。

- 控制栏隐藏时，确定键直接播放 / 暂停；点播左右键快进 / 快退 10 秒，上 / 下键调出工具栏。控制栏显示时左右键移动按钮焦点，上键可进入进度条；进度条上的左右键调整实际播放时间。
- 菜单键打开右侧选集面板，当前项高亮并获得初始焦点；再次按菜单或返回关闭面板。普通返回依次关闭面板、收起控制栏、离开播放，顶部返回按钮可直接离开。
- 正常倍速提供 0.5 / 0.75 / 1 / 1.25 / 1.5 / 2 / 3 倍，直接控制 ExoPlayer 并保存至电视本机设置；切集与恢复播放会延续倍率。
- 更多 / 画面面板提供实际的适应画面、铺满屏幕、上一集与返回换源。铺满会按比例裁切边缘；关闭面板时同步返回原按钮焦点，快速连续遥控不会被旧回调抢走焦点。
- 直播隐藏不可用的进度条与倍速，固定正常速度；选集入口改为频道。控制隐藏时上下键换台，菜单键选择频道。

解码优先级、未知地址格式回退、HTTP / TLS 错误提示与重试 / 换源、断点、自动下一集和直播恢复继续使用原播放流程。

手机 / 平板版采用相同黑灰影院风格，底部提供「首页」「搜索」「直播」「资料库」「设置」，首页使用通栏真实影片海报、大标题、白色播放操作、横向海报片架与带本机进度的继续观看卡片。按屏幕宽度调整推荐、海报和频道列数，电影 / 剧集 / 综艺等分类仍可在搜索页筛选。详情以真实海报、片名、简介和来源展示，不生成评分。播放器竖屏为 16:9 视频加详情 / 选集，横屏为沉浸全屏；顶部返回与片名，底部白色进度条、播放、时间、倍速、选集和全屏，左侧提供屏幕锁定。横滑预览时间，松手跳转；左半屏上下滑动调节当前窗口的实际亮度，右半屏上下滑动调节设备媒体音量。单击显示 / 隐藏控制，双击播放 / 暂停，播放中长按临时进入至少 2 倍速，松手或取消后恢复原倍率。正常倍速支持 0.5–3 倍并记忆；直播不显示进度与倍速。锁屏阻止误触手势和旋转，轻触画面可再次显示解锁按钮。亮度在离开播放器或进入后台时恢复原窗口设置，长按倍率在取消、多指、换集和离屏时还原。

首页缓存已取得的影片目录，联网刷新失败时保留缓存，并始终提供内置直播入口。选集、播放进度和观看记录保存在当前应用的本机数据中。

## 搜索结果过滤（build9）

电视与安卓手机 / 平板共用搜索仓储，现在与现有电脑搜索接口保持一致：仅当影片标题包含字面“电影解说”时不展示该结果。过滤发生在逐源解析和数量限制前，并覆盖多源合并与旧发现缓存恢复；不删除观看历史，也不根据分类、简介或备注误伤正常片名。已加入“周星驰”演员查询下正片与“功夫足球电影解说”相邻返回的回归。

本次 signed APK 的版本代码为 2161209；验证及当前上游数据的限制见根目录 `artifacts/search-title-filter-20261025/`。Apple 原生端同步修复其共用搜索链路；电脑端原有同规则未更换。

## 高清详情横图（build6）

手机、平板和独立电视的详情使用独立 `Backdrop` 元数据，`cover` 继续用于原来源海报。Gradle 直接将根目录 [共享片目与 TMDB 资源](../shared/artwork-catalog.json) 加入 assets，不维护 Android 独立片目副本。当前共享目录包含 8 条已核实电影 / 剧集，无需 TMDB 凭据即可命中。匹配要求至少一个已知稳定 ID 命中且已知其他 ID 不冲突，或精确规范化片名与年份；年份、电影 / 剧集类型冲突以及同名歧义均保留原封面，无年份且无稳定 ID 时不猜测。

两端设置均有「高清图片 / TMDB」：可关闭高清横图，也可选填自己的 TMDB API Key（v3）或 API Read Access Token。凭据仅保存在应用私有设置中，输入框不会回显已存凭据，也不写日志或导出；应用禁用备份，并显式将该设置文件排除于 Android 12+ 云备份及设备迁移。设置中保留官方 TMDB 标识、链接与声明。客户端不含共享 API 密钥，也不在运行时抓取 TMDB 网页。

配置个人凭据后仅访问固定 `https://api.themoviedb.org/3`：带点的 JWT 使用 Bearer，其余使用 `api_key`；搜索结果必须原名或译名精确匹配、年份与类型一致，多个候选或多页结果均拒绝猜测。带 IMDb 标识时额外使用正式 `external_ids` 接口核对。横图只接受合法 hash 路径、1.5–2.4 比例、至少 1280×720，优先无字及足够清晰的图。API 响应最多 512 KiB，短连接 / 读取超时，单次查询总期限约 7 秒；元数据成功缓存 24 小时、失败 10 分钟，凭据摘要隔离失败缓存，并发同查询去重。查询在独立工作线程运行，关闭详情或切换影片会取消旧回调。

背景按实际视图 / 显示像素及堆预算解码，最长边不超过 3840、输出不超过约 8.3MP；低内存设备降至最长 1280、约 0.92MP 并使用 RGB565。背景缓存独立、按堆大小控制且最多 40MiB（系统报告低内存或 memory class 小于 128MiB 时最多 6MiB），海报仍使用独立的 480×720 采样和缓存。原有背景下载 6MiB、海报 3MiB 上限保留，较大的原始图会回退到当前影片原封面；升级图片请求保留已显示内容，失败时重新请求同一影片的封面。

## 构建

需要 JDK 17、Android SDK 35、build-tools 35.0.0 与 Gradle 8.9。首次获取依赖需要访问 Google Maven / Maven Central；缓存齐备后可给下列命令加 `--offline`。

1. 设置 `JAVA_HOME`、`ANDROID_HOME`，或在本目录创建 `local.properties` 并填写 `sdk.dir=/你的/Android/SDK`。
2. 如使用本地 Maven 镜像，可设置 `KONGWOTV_BUILD_MAVEN`。
3. 在本目录执行所需构建命令。

调试包与单元测试：

```sh
./gradlew :app:testTvDebugUnitTest :app:testMobileDebugUnitTest :app:assembleTvDebug :app:assembleMobileDebug
```

调试包分别位于 `app/build/outputs/apk/tv/debug/app-tv-debug.apk` 和 `app/build/outputs/apk/mobile/debug/app-mobile-debug.apk`。

签名 release 包、对应单元测试与完整 Android lint：

```sh
./gradlew :app:testTvReleaseUnitTest :app:testMobileReleaseUnitTest :app:lintTvRelease :app:lintMobileRelease :app:assembleTvRelease :app:assembleMobileRelease
```

release 包分别位于 `app/build/outputs/apk/tv/release/幕里-AndroidTV-2.16.12.apk` 和 `app/build/outputs/apk/mobile/release/幕里-Android-2.16.12.apk`。更名前的 build6 历史交付为 [手机 / 平板签名 APK](../dist/artwork-2.16.12-build6/空我TV-Android-2.16.12-build6.apk) 和 [独立 Android TV 签名 APK](../dist/artwork-2.16.12-build6/空我TV-AndroidTV-2.16.12-build6.apk)，这些历史文件与验证证据保留原名，不覆盖旧包。

发布构建沿用本机已有签名配置。新环境请参考 [签名配置模板](./signing.properties.example) 创建私有配置；保留 `.signing` 与签名配置文件，才能制作相同签名的后续更新。真实密钥、密码与 SDK 本机路径不随源码包分发。

## 幕里品牌更名验证

两个 flavor 均已完成新名称、应用内字标和统一黑白图标替换。各 54 项既有 release 单测通过，共 108 项；两端 release lint 均为 0 错误、25 条警告；签名 release 和 Instrumentation 测试 APK 均成功构建。APK 的应用标签、包名和版本已核对，五种密度启动图标、应用内标识及电视横幅共 7 张图均与生成资源逐像素一致，签名证书与更名前的 build6 交付相同。

本轮同时修正一处既有测试与共享数据的漂移：共享片目已有 8 条，完整解析检查不再写死为 7 条，而是核对共享 JSON 条目总数，其余身份、年份和字段检查保留。本轮未安装设备或重新进行播放、遥控与触摸运行验收。证据见 [验证清单](../artifacts/brand-muli/android/validation.json)、[最终构建日志](../artifacts/brand-muli/android/build.log) 和 [品牌资源预览](../artifacts/brand-muli/android/asset-preview.png)；历史验证目录保留原样。

## build6 验证

两个 flavor 的 `testTvReleaseUnitTest` / `testMobileReleaseUnitTest` 各 54 项通过（各新增 28 项横图回归），总计 108 项；两端 release lint 均为 0 错误、25 条既有类别警告；两个签名 release 与 Android 自带 Instrumentation 测试 APK 均成功构建。签名 v1 / v2 验证通过，版本、7 条共享片目及官方 PNG 在两个 APK 内与根目录逐字节一致。完整构建见 [最终构建日志](../artifacts/artwork-build6/android/final-build.log)，交付大小与校验和见 [APK 清单](../artifacts/artwork-build6/android/delivery-apks.json)。

在全新数据的临时手机 API30 与独立 Android TV API34 模拟器上运行正式签名 APK，从真实 360 资源（影片 ID 4342）读取《燃烧女子的肖像》2019 详情，命中共享 TMDB531428 并实际下载 CDN 横图。手机与电视实际背景解码分别为 1678×944 / 1700×956；强制图片连接失败后，同一背景控件均恢复原来源 270×360 封面。原始画面见 [手机详情](../artifacts/artwork-build6/android/phone-details.png)、[手机回退](../artifacts/artwork-build6/android/phone-fallback.png)、[电视详情](../artifacts/artwork-build6/android/tv-details.png) 与 [电视回退](../artifacts/artwork-build6/android/tv-fallback.png)。设置中的可选输入、TMDB 官方声明和标识也在实际界面验证。

这轮未操作真机，也没有重新验收播放器、实体平板或 4K 实体显示设备。4K / 低内存尺寸预算由单测覆盖，运行截图来自 1080p 级模拟器。当前没有真实 TMDB 凭据，正式 API 的鉴权与候选响应仅通过注入响应测试，不称为已经联网鉴权验证；无凭据的共享片目与 CDN 下载已真实联网验证。公开来源和 CDN 可用性仍受网络与上游影响。

## Apple TV 风格 UI 验证（历史阶段）

该 UI 阶段只调整 TV 和手机 / 平板界面与播放器视觉，保留原聚合、搜索、来源、播放、断点、遥控及手势流程。双 flavor debug 单测各 26 项、合计 52 项通过；`lintTvDebug` 与 `lintMobileDebug` 均为 0 错误、25 条警告；`assembleTvDebug` 与 `assembleMobileDebug` 均成功。警告涉及清单兼容性、国际化、launcher 图标、程序化控件构造器及保留的未使用资源等。

本机验证使用已有缓存的 JDK 17 / SDK 35 / Gradle 8.9 离线执行；wrapper 尝试重新下载 Gradle 发行版后已停止，改用同版本缓存工具完成。完整结果见 [当前 UI 验证清单](./build-evidence/apple-tv-ui/validation.json) 与 [最终构建日志](./build-evidence/apple-tv-ui/verification-final.log)。该 UI 阶段没有发布、安装、组装 release 或修改签名，也没有重新进行真机 / 模拟器运行验收；下面的 build5 运行记录与截图是历史证据，不代表当前新 UI 的运行截图。

## 运行验证（历史 build5）

已有仓储单元测试覆盖 M3U、点播返回、播放地址解析、去重与查询编码。运行验证另外使用 Android 自带 Instrumentation，对真正的签名 release APK 检查品牌、遥控器 / 触摸导航、详情弹窗、本地 HTTP 视频解码、ASCII User-Agent、暂停、快进与切集，无需安装新的测试框架。

```sh
./gradlew :app:assembleTvReleaseAndroidTest :app:assembleMobileReleaseAndroidTest
adb install -r app/build/outputs/apk/tv/release/幕里-AndroidTV-2.16.12.apk
adb install -r app/build/outputs/apk/androidTest/tv/release/app-tv-release-androidTest.apk
adb shell am instrument -w -e profile tv org.kongwotv.tv.test/org.kongwotv.tv.SmokeInstrumentation
```

手机 / 平板使用 mobile 对应的两个 APK，并执行：

```sh
adb shell am instrument -w -e profile phone org.kongwotv.mobile.test/org.kongwotv.tv.SmokeInstrumentation
```

测试视频是本地生成的 H.264 / AAC 测试图与音调，只进入 androidTest APK；详见 [测试素材与命令](./app/src/androidTest/README.md)。

TV build5 的运行回归在 `LibreTV_TV` 本地 AVD（Android 11 / API 30、1920×1080、320 dpi）执行，检查了独立控制层、焦点路径、中心播放 / 暂停、10 秒 seek、从 1x 改为 1.5x 的真实倍率与记忆、适应 / 铺满、选集与倍率保持、直播界面 / 换台和分层返回。测试会等待 Activity / Dialog 的真实窗口焦点后再注入按键，避免将对话框退场动画期间丢失的输入误判为播放器问题。

证据位于 [TV build5 验证清单](./build-evidence/tv-build5/validation.json)、[构建日志](./build-evidence/tv-build5/build.log)、[运行日志](./build-evidence/tv-build5/runtime.log)、[最终 APK 验签](./build-evidence/tv-build5/final-apk-signature.log)。实际截图包括 [播放器](./build-evidence/tv-build5/smoke-tv-build5-tv-player-layout.png)、[倍速](./build-evidence/tv-build5/smoke-tv-build5-tv-speed.png)、[画面设置](./build-evidence/tv-build5/smoke-tv-build5-tv-settings.png)、[选集](./build-evidence/tv-build5/smoke-tv-build5-tv-episodes.png) 和 [直播频道](./build-evidence/tv-build5/smoke-tv-build5-tv-live-channels.png)。

这些是模拟环境中的原生解码和遥控验证，不等同于实体电视验收；直播模式使用本地 MP4 fixture 验证频道交互，没有将公网 HLS 可用性或具体电视硬件解码当作已验证。本轮手机分支完成编译、单测与 lint 守护，原有手机手势检查完整保留，未重新执行手机实机触控验收。

## 来源、图标与许可

- [内置点播与直播配置](./app/src/main/assets/sources.json) 和 [直播频道快照](./app/src/main/assets/channels.m3u) 保存在 APK 中，观看仍需联网，公开来源可能随时间、地区网络或上游策略变化。
- [直播探活工具](./tools/verify_live_sources.py) 与 [媒体片段检查工具](./tools/verify_media_sample.py) 用于联网检查，与离线单元测试独立。
- [图标生成工具](./tools/generate_brand_artwork.py) 复用项目统一的幕里黑白图标，生成 Android 多密度 launcher、应用内标识与 TV banner；[美术署名](./app/src/main/assets/ARTWORK_CREDITS.txt) 保留山湖照片作者、真实来源和 Unsplash 许可。

电影源来源为原 LibreTV 项目旧版代码引用的公开档案：<https://telegra.ph/APIs-08-12>。直播目录来源：<https://github.com/iptv-org/iptv>。原项目为 LibreSpark/LibreTV：<https://github.com/LibreSpark/LibreTV>，原作者和贡献者版权保留。本目录是独立 Android 客户端扩展。

客户端按 AGPL-3.0-or-later 提供源码，完整许可证见 [LICENSE](./LICENSE)，原项目署名见 [NOTICE](./NOTICE)。AndroidX Media3 按 Apache-2.0 提供；Android API 兼容库 desugar_jdk_libs 按 GPL-2.0 with Classpath Exception 提供，完整许可文本保留于 APK 资源中。组件版权和许可仍属于各自作者。
