# 幕里四端产品逻辑、闭环与 UI 审核

日期：2026-10-23（北京时间）。本轮在现有工作区直接修复已核实的问题，保留原有未提交改动，未发布、安装设备或提升版本号。

整体结构已有推荐、搜索、播放、资料库和设置入口。主要缺口集中在内容身份、续播状态、错误恢复和异步任务结束后的状态一致性；这些问题会导致播错同名影片、丢失进度、无法继续下载或页面误报。已修复本轮确认的问题，并补回归。原生端的视觉与交互结论来自源码和设备目标编译，不能等同真机验收。

## 审核路径与结果

| 步骤 | 路径 | 当前结论及证据 |
| --- | --- | --- |
| 1 | 首页推荐 → 分类/列表 | 页面结构正常；响应式、浅色和减少动态效果通过。Android 分类误判、同名不同年去重、超过 120 条结果缺少后续入口已修复。 |
| 2 | 搜索 → 来源结果 | 真实“三体”搜索返回结果；修复来源缓存串身份、流中断误报空结果、重复搜索不能重试、无来源无直接行动入口。失败态回归通过。 |
| 3 | 推荐/搜索 → 详情 → 匹配来源 | 实测 2025《生日快乐》原先提供 2007 同名片；现排除明确年份/身份冲突。Apple/Android 详情接口严格匹配请求 ID。加载、查找、续播、下一集、重播文案对应实际动作。 |
| 4 | 播放 → 切集/换源/回退 → 返回 | 真实“三体”已显示视频帧及 43:42 片长，返回详情显示“继续观看 · 第 1 集”。受控本地 HLS 的 12 项渲染层检查通过。修复旧事件串写、元数据过早导致续播失效、自动连播竞争、代理重建丢进度。 |
| 5 | 首页继续观看 / 历史 → 再次观看 | 按影片和剧集保存；看完到下一集/末集重播；显式 0 秒覆盖残留断点；直连分享可从历史再打开。历史清空、撤销、返回刷新和确认层残留修复。 |
| 6 | 下载 → 暂停/继续/取消/失败 | 空态入口正常；修复保存目标串任务、无法继续、刷新后假下载中、取消误报成功、并发越界与迟到缓存写入。下载状态和网络/缓存回归通过；本轮未验收真实大文件保存对话框。 |
| 7 | 设置 / 确认弹窗 / 跨弹层导航 | Tab/Escape 只作用最上层，关闭归还焦点；详情转设置期间保留滚动锁，最后弹层关闭恢复滚动。跨弹层和浏览器返回的 3 项补充回归通过。 |
| 8 | 直播 / 关于 / 客户端启动退出 | 直播目录与控件回归、关于署名通过；桌面启动就绪前和并发激活不再重复建窗，失败统一提示退出。长期 IPTV、实际遥控、系统全屏仍需设备验收。 |

## 关键修复位置

- 详情身份、续播主动作：`src/lib/detail-playback.ts`、`src/components/detail-modal.tsx`、`src/components/cinematic-home.tsx`。
- 搜索与错误恢复：`src/app/page.tsx`、`src/lib/client-api.ts`、`src/app/api/search/route.ts`。
- 播放状态：`src/app/watch/page.tsx`、`src/components/player-shell.tsx`、`src/components/switch-source.tsx`、`src/lib/db.ts`。
- 下载生命周期：`src/components/download-manager.tsx`、`src/lib/m3u8-downloader.ts`、`src/lib/download-saver.ts`。
- 弹层与设计一致性：`src/components/confirm-dialog.tsx`、`src/components/drawer.tsx`、`src/components/use-focus-trap.ts`、`src/components/use-body-scroll-lock.ts`、`src/components/header.tsx`、`src/app/tv-interface.css`。
- 桌面启动：`desktop/main.cjs`；离线竞态回归：`desktop/scripts/lifecycle-test.cjs`。
- 原生具体修复与文件列表见 [Apple 审核记录](../apple/build-evidence/product-audit-20261023.md) 与 [Android 审核记录](../android-tv/verification/product-audit-20261023.md)。
- 完整共享逻辑问题表见 [播放、搜索与下载记录](product-audit-2026-10-23-web-logic.md)。

## UI 与规范

沿用现有黑白品牌、深色内容画布、内容架、浅色外观选项及各端原生导航。主要修改状态语义、失败后的行动入口、选集和继续观看标识、触控目标、弹层焦点与滚动行为，没有重做既有视觉方向。设置中的广告过滤和视频缓存说明已改为面向用户的作用、异常处理和本机存储说明，移除不影响使用决策的内部技术术语。

新增 [产品与交互规范](product-design-standards.md)，明确身份规则、状态闭环、按钮文案、主次层级、焦点、触屏目标、响应式和验收边界。此为项目约定，不声称已通过完整 WCAG 或各平台所有规范认证。

## 验证

| 检查 | 结果 |
| --- | --- |
| 共享 TypeScript/服务端单测 | 46 文件、657 项通过 |
| TypeScript / ESLint / diff 空白检查 | 通过；共享代码 lint 0 警告 |
| Next standalone 正式构建与桌面 staging | 通过；桌面服务资源重新从当前源码生成 |
| 界面流程与布局 | 42 项通过，含 320/390/834/1440/1920 宽度、浅色与减少动态效果 |
| 桌面真实 Chromium 媒体解码 | 本地 12 秒 HLS，12/12 项渲染层检查通过；不是完整操作系统验收 |
| 桌面启动生命周期 | 3 项真实入口 + mock Electron/OS 竞态测试通过 |
| Android 手机/平板与电视 | 各 72 项单测通过，两份 debug APK 构建通过；lint 各 0 错误、24 个现有类别警告 |
| Apple iPhone/iPad 与 Apple TV | RepositorySmoke、ArtworkSmoke 离线通过；两种 Release arm64 设备目标无签名构建成功 |

根证据目录为 `artifacts/product-audit-20261023/`，包含单测、lint、类型、正式构建、staging、界面与媒体结果。界面自动化使用独立临时 profile，带 `fixtures` 的图和场景为明确标记的受控数据。用户现有客户端资料没有被清空。

桌面播放器原始 `player/result.json` 保持 `scope=renderer-only`、`rendererPassed=true`、`passed=false`、`fullAcceptancePassed=false`；系统原生全屏和真实窗口失焦两项未执行，没有把渲染层通过改写成整机验收。

## 本轮截图与逐步观察

### 1. 首页

推荐与内容架可用，布局层级保持一致；下图为本轮实际数据。

![首页](../artifacts/product-audit-20261023/01-home-before.png)

### 2. 搜索与失败恢复

真实搜索能区分同名不同年；失败场景现在提供重新搜索与管理来源，不再伪装为无结果。下图为受控失败回归。

![搜索失败恢复](../artifacts/product-audit-20261023/ui-production/search-error-fixtures.png)

### 3. 详情身份

审核前实际 2025 年影片下出现 2007 年来源；修复后排除冲突并说明未找到匹配来源。后图为受控年份冲突回归。

![修复前同名来源冲突](../artifacts/product-audit-20261023/03-source-results-before.png)

![修复后明确说明未匹配](../artifacts/product-audit-20261023/ui-production/wrong-year-recovery-fixtures.png)

### 4. 播放与返回

本轮真实媒体已呈现视频帧；返回后详情主按钮对应实际断点。截图只能证明该时刻成功显示，不能证明所有来源长期可用。

![真实媒体播放](../artifacts/product-audit-20261023/06-playback-current.png)

![返回后继续观看](../artifacts/product-audit-20261023/07-detail-resume-after.png)

### 5. 历史

历史条目显示真实保存位置，取消清空后仍保留记录和焦点。下图为隔离 profile 的受控历史。

![历史](../artifacts/product-audit-20261023/ui-production/history-fixtures.png)

### 6. 下载

下载入口和空态可达；暂停、失败、取消及并发以受控逻辑测试验证，未将空态截图当作下载实测。

![下载空态](../artifacts/product-audit-20261023/08-downloads-after.png)

### 7. 设置与窄屏详情

设置分组和详情操作在窄屏可见，无横向溢出；键盘焦点、返回和滚动释放有独立回归。

![窄屏设置](../artifacts/product-audit-20261023/ui-production/settings-phone-fixtures.png)

![窄屏详情](../artifacts/product-audit-20261023/ui-production/detail-phone-fixtures.png)

### 8. 直播与关于

目录和导航可用，署名保留。频道截图使用受控目录；长时间直播、真机画中画和遥控器未验收。

![直播目录](../artifacts/product-audit-20261023/ui-production/live-fixtures.png)

## 剩余验收边界

本轮没有安装新版本、发布正式包或操作开发者签名。Apple 产物未签名，不能直接安装；Android 是 debug 验证构建。Windows 没有实机运行，新源码的 Apple/Android 触摸、遥控器、VoiceOver、画中画、音视频输出、横竖屏和外部来源长时间播放尚未完成本轮设备验收。真实保存对话框与大文件落盘也不在下载 mock 结果范围内。
