# Apple TV 风格界面改造

> 2026-10-25 更新：Android TV 已按用户提供的视觉参考改为顶部横向导航、全幅主视觉、左下影片操作和横向海报片架（build 2161208），并修复搜索输入法收起与焦点交还。当前实现及运行证据见 `android-tv/README.md`、`design-qa.md` 和 `artifacts/tv-reference-ui-20261025/`。以下左侧导航描述属于此前 Apple TV 风格阶段；Apple 原生端本轮未改动。

本轮将幕里 的桌面、Android 手机/平板、独立电视客户端、iPhone/iPad 与 tvOS 界面统一到 Apple TV 的内容优先设计方向，保留幕里 品牌及现有播放能力。

## 调研依据

- [Apple TV 官方视觉改版介绍](https://www.apple.com/newsroom/2025/06/apple-tv-brings-a-beautiful-redesign-and-enhanced-home-entertainment-experience/)：影片画面占据主视觉，导航与播放控件使用收敛的透明材质。
- [Apple HIG：Designing for tvOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-tvos)：为大屏观看距离和方向输入设计布局。
- [Apple HIG：Focus and selection](https://developer.apple.com/design/human-interface-guidelines/focus-and-selection/)：明确区分焦点与选择，保持方向操作路径。
- [Apple TV app 导航说明](https://support.apple.com/guide/tvapp/navigate-the-apple-tv-app-atvb14e9d4d5/web)：侧栏组织导航，内容区按主题浏览。

资料通过官方页面搜索索引核对。Apple 域名正文抓取受本次工具地址解析限制，未完成官方截图的逐屏比对。本实现参考其页面结构与设计语言，具体尺寸为本项目的工程选择；未使用 Apple 标识、专有图片或字体，也不声称像素级复刻。2025 年官方 Liquid Glass 改版作为可核对的材质参考，不将 tvOS 26 称为当前最新版。

## 页面与交互

| 范围 | 实现 |
| --- | --- |
| 导航 | 电脑与电视采用侧栏；手机采用底部标签；平板按可用宽度适配。保留搜索、分类、直播、历史、下载和设置入口。 |
| 首页 | 真实影片大幅推荐、手动切换精选、继续观看、横向内容架、个人片单。上游没有封面时使用占位或现有装饰背景。 |
| 片库与搜索 | 分类页保留纵向结果与完整筛选；内容架支持触摸、翻页按钮和方向键。片名始终可读。 |
| 详情 | 大幅渐隐背景、大标题、白色主操作、片单、来源与选集、演职员与关联内容。评分只显示上游真实值。 |
| 播放 | 白色播放键与进度、黑灰透明控件、选集/倍速面板，保留原解码、手势、换源、全屏、画中画和断点逻辑。 |
| 辅助页面 | 设置、历史、下载、直播、关于与错误页使用统一表面、圆角、字体和主次层级。 |

基础画布 `#08090b`，表面 `#111114`，正文 `#f5f5f7`；局部玻璃材质用于导航、弹层与播放器。保留桌面浅色主题偏好。Web、iOS/tvOS 支持减少动态效果；Web 为减少透明度偏好提供实色背景。

Web 方向键可在侧栏与首页主操作、上下内容架及同架卡片之间移动。关闭搜索、详情或工具面板后恢复焦点。继续沿用原有导航历史与滚动恢复标记。

## 代码入口

- React / Electron：[统一样式](../src/app/tv-interface.css)、[侧栏与搜索](../src/components/header.tsx)、[首页主视觉](../src/components/cinematic-home.tsx)、[内容架](../src/components/content-rail.tsx)、[播放器样式](../src/app/player.css)。
- Android：[电视页面](../android-tv/app/src/main/java/org/kongwotv/tv/MainActivity.java)、[手机/平板界面](../android-tv/app/src/main/java/org/kongwotv/tv/MobileUi.java)、[共享视觉与焦点](../android-tv/app/src/main/java/org/kongwotv/tv/TvUi.java)。
- Apple 原生：[页面](../apple/Sources/Views.swift)、[视觉与焦点](../apple/Sources/Platform.swift)、[手机播放器](../apple/Sources/MobilePlayer.swift)、[电视播放器](../apple/Sources/TVPlayer.swift)。

macOS / Windows 桌面复用 React 界面，经原有 Next standalone 构建与 Electron staging 流程载入。Apple 原生工程仍为 iOS 与 tvOS 两个目标。

## 本轮结果

- React / Electron：602 项现有单测通过；TypeScript、ESLint、正式 standalone 构建及桌面 staging 通过。正式资源的 31 项界面检查通过，覆盖 1440px 桌面、834px 平板、390px / 320px 手机、1920px 大屏，以及浅色主题和减少动态效果。
- 桌面播放：复用现有本地 12 秒 HLS 测试，12 项渲染层检查通过，包含解码、暂停、拖动提交/取消、倍速、长按、换集、网页全屏、缩放模式与直播切换。采用 `--renderer-only`；系统原生全屏与真实窗口失焦两项未执行，不能将 [播放器结果](../artifacts/tv-interface/player/result.json) 的 `rendererPassed: true` 解释为完整 OS 验收。
- Android：手机/平板与电视 debug APK 均构建成功，两个 flavor 共 52 项单测通过；lint 各 0 errors、25 warnings，具体类别记录在 Android 验证清单中。
- Apple：iOS 与 tvOS Release arm64 设备目标在禁签名条件下构建成功，现有离线 RepositorySmoke 通过。保留 AppIntents 元数据提取跳过警告，未扩展工程目标或修改播放模型。

## 验证方式

```sh
npm run typecheck
npm run lint
npm test
# 本地界面服务启动后执行，复用 desktop 内现有 Electron：
node scripts/verify-tv-interface.cjs
# 停止开发服务后构建桌面使用的服务：
DOCKER_BUILD=1 npm run build
npm --prefix desktop run prepare:server
```

[界面验证脚本](../scripts/verify-tv-interface.cjs) 使用独立的临时浏览器配置。第一张在线首页截图使用实际数据；名称带 `fixtures` 的截图使用明确标注的界面测试条目，只检查布局、片单、筛选、搜索与焦点，不代表真实第三方内容。不会修改用户浏览器的数据。

界面证据保存在 [artifacts/tv-interface](../artifacts/tv-interface/)。Android 双 flavor debug 构建、52 项单测与 lint 的结果见 [验证清单](../android-tv/build-evidence/apple-tv-ui/validation.json)。iOS / tvOS 的无签名设备构建记录见 [iOS 日志](../apple/build-evidence/build-ios.log)、[tvOS 日志](../apple/build-evidence/build-tvos.log)，离线数据模型检查见 [smoke 日志](../apple/build-evidence/apple-tv-ui-smoke.log)。

Android / Apple 原生端本轮完成编译验证，未将旧版截图作为新界面运行证据。电视遥控、原生动画、音视频输出及 PiP 仍需实际设备验收。Apple 产物未签名，安装仍需对应签名条件；本轮未发布客户端。
