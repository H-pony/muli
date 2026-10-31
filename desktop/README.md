# 幕里桌面客户端

桌面包包含 Electron（Chromium + Node.js）、完整 Next.js standalone 服务、前端静态资源和公开默认源。安装后直接打开应用，无需安装 Node.js、运行 npm 或连接另外部署的幕里服务器。视频、节目单和封面仍通过互联网向各个来源获取。

## 构建

建议在 macOS 上使用 Node.js 24 和 npm 运行，macOS 图标和 DMG 需要系统自带的 `iconutil`、`hdiutil`。桌面工具安装在本目录，不更改根项目依赖。

```bash
# 先在项目根目录生成服务端构建。
DOCKER_BUILD=1 npm run build

# 然后进入 desktop 目录。
npm ci
npm run build

# 也可只打包某个平台。
npm run build:mac
npm run build:win
```

`npm run build` 依次生成 macOS arm64/x64 的 DMG 和 ZIP、Windows x64 的 NSIS 安装程序。本轮输出位于项目根 `dist/muli-2.16.12-build7/`，文件名包含 `2.16.12-build7`。macOS 最低系统版本由当前 Electron 决定（本次使用 Electron 44，支持 macOS 13 及以上）；Windows 需要 Windows 10 或更新系统。

所有平台都包含各自架构的 Electron 运行时。macOS 本机编译出的 sharp、SWC 动态库不会跨平台打入包：staging 要求 `images.unoptimized=true`，正式服务不进行 SWC 编译或 sharp 图片优化，并移除这些可选原生依赖和 `.node`/动态库。之后通过实际 Electron 启动验证正常页面和服务端接口。若以后加入运行时图片优化、动态编译或其他原生 Node 依赖，必须重新提供各平台兼容依赖，不能继续沿用这一裁剪策略。

Windows 可执行文件的图标、版本和产品名使用 `resedit` 在构建后用纯 JavaScript 写入，再生成 NSIS。无需 Wine，也没有关闭 Chromium 的运行时安全沙箱。

build7 已统一为「幕里」与选定的黑白弧形标识。macOS arm64 成品和 x64 成品（在 Apple Silicon 上经 Rosetta）均通过实际 Electron 自测，确认应用名称、窗口标题、页面标题、旧数据目录与持久会话保持正确，并实际执行搜索。x64 那次搜索返回 13 条，其中一个远程源超过 10 秒超时；这不影响品牌与本地服务检查通过。Windows x64 安装包已交叉构建，PE 产品名、图标和版本资源已检查，尚未在 Windows 实机运行。两套 DMG 校验通过，两套 macOS 应用的 ad-hoc 签名资源检查通过。验收记录位于 `self-test-results/muli-build7-packaged-arm64/` 和 `self-test-results/muli-build7-packaged-x64-rosetta/`。


## 高清详情背景

build6 的详情背景独立匹配 TMDB 横图，原封面继续用于海报和回退。图片真实解码尺寸至少 1280×720、比例在 1.5～2.4 才能替换背景，获取或加载失败时回到原图，图片查询与播放详情并行。

设置入口为“设置 → 图片与背景 → 高清背景图”。可保存自己的 TMDB API Key 或读取令牌；凭据单独保存在本机，不进入常规配置导出。当前没有内置第三方凭据，免凭据只覆盖共享目录的 7 条已核对片目，其余片目需要个人凭据。当前片目包含《燃烧女子的肖像》2019 的真实 3840×2160 横图。

在根目录可复现正式资源的独立本机预览与真实网络页面检查：

```bash
node scripts/preview-artwork.cjs
# 另一个终端，使用独立 Electron 会话验证真实影片、解码和断网回退。
node scripts/verify-artwork.cjs
```

预览监听 `http://127.0.0.1:17889`，证据输出至根目录 `artifacts/artwork-build6/desktop/`。断网检查同时阻断 TMDB 直连和内置代理路径，避免仅测到代理恢复成功。build6 的 Android/iPhone/iPad/TV 原生截图与当时的安装条件见 [高清背景预览与安装说明](../dist/artwork-2.16.12-build6/预览与安装说明.md)。

## 播放器

点播和直播共用 B 站式控制层：顶部返回、标题和更多，底部播放、时间、音量及全屏操作。点播使用粉色细进度条，并提供真实倍率和选集菜单；直播显示频道与线路操作。菜单位于播放器根节点内，网页全屏和系统全屏中都可操作，切集和换台复用同一个视频节点。

点播拖动进度先预览，松手提交，Escape 取消；播放中长按画面临时至少 2 倍速，松手或失焦恢复原倍率。正常倍率独立保存，切集和重新打开仍可恢复。空格播放/暂停，←/→ 调整 5 秒，↑/↓ 调整音量，F 系统全屏，W 网页全屏，M 静音；Alt+Shift+←/→ 切集。直播的全局 ↑/↓ 用于换台，菜单和输入控件优先处理自身按键。

## 本地服务与数据

- 服务只监听固定地址 `http://127.0.0.1:17886`，固定 origin 保证浏览器历史、设置、缓存和 IndexedDB 在重启后保留。
- 若端口被占用，应用会说明原因并退出；不会接管其他程序的服务器或悄悄改端口。
- 应用只允许一个实例。第二次打开会聚焦原窗口。
- 内置服务的 `PASSWORD` 为空，默认直接使用，无需访问验证或登录 Cookie；每次启动仍在内存中生成随机 `PROXY_SECRET`，用于代理签名。密钥不出现在页面、URL、命令行或安装包中。
- 渲染页面关闭 Node.js 集成，启用 context isolation、Chromium sandbox 和默认 web security。外部链接由系统浏览器打开。
- 退出应用时终止内置服务；父进程意外断开 IPC 时服务也会退出。
- 显示名称和安装包名为「幕里」；保留 `tv.kongwo.desktop` 应用标识、`kongwotv` 数据目录、`persist:kongwotv` Chromium 会话与 Windows 可执行文件名，以延续升级、浏览记录和设置。
- 用户数据目录：macOS 为 `~/Library/Application Support/kongwotv`，Windows 为 `%APPDATA%/kongwotv`。
- 应用直接进入页面，使用“视图 → 刷新”或重新打开应用时也无需输入访问密码。

构建时读取 Android 项目中公开的 `android-tv/app/src/main/assets/sources.json`，只复制公开点播、直播列表及来源说明；运行时注入 `DEFAULT_SOURCES`、`DEFAULT_LIVE_SOURCES`。源是否可达随网络和源站变化。

## 环境文件保护

`prepare:server` 将 `.next/standalone`、`.next/static`、`public` 复制到仅供构建使用的 `.staging/server`。复制时排除所有 `.env*` 文件、Git 元数据和不兼容的原生依赖；复制后和每个平台打包后再次遍历检查，发现环境文件或原生动态库会直接终止。staging 清单记录构建 ID、文件数、Next.js 版本和服务入口摘要，不记录任何密码。

桌面服务使用操作系统环境白名单启动，不继承开发机器的 `PASSWORD`、`PROXY_SECRET`、`DEFAULT_*` 或 `NODE_OPTIONS`。应用没有自动加载本机项目的环境文件。

## 验证

```bash
npm run prepare:server
npm run prepare:icons
npm run self-test

# 直接验证真正的 macOS 安装包中的应用可执行文件。
node scripts/self-test.cjs --app '../dist/muli-2.16.12-build7/mac-arm64/幕里.app/Contents/MacOS/幕里' --without-host-node

# 本地 HLS 实播、拖动、倍速、全屏和换台专项验证。
node scripts/player-self-test.cjs --output "$PWD/../artifacts/player-ui-2.16.12/desktop-dev" --without-host-node
node scripts/player-self-test.cjs --app "$PWD/../dist/muli-2.16.12-build7/mac-arm64/幕里.app/Contents/MacOS/幕里" --output "$PWD/../artifacts/player-ui-2.16.12/desktop-packaged-arm64" --without-host-node

# 通过 macOS LaunchServices 启动实际 .app，验证完整前台行为。
node scripts/player-self-test.cjs --launch-services --app '/Volumes/幕里 2.16.12/幕里.app' --output /tmp/kongwotv-player-full --without-host-node

# 独立的渲染层范围：执行控件与实播检查，原生前台/失焦仍未验收。
node scripts/player-self-test.cjs --renderer-only --app "$PWD/../dist/muli-2.16.12-build7/mac-arm64/幕里.app/Contents/MacOS/幕里" --output "$PWD/../artifacts/player-ui-2.16.12/desktop-renderer" --without-host-node
```

自测会实际打开 Electron 窗口并记录：应用名称与窗口标题、原有数据目录和会话标识、页面标题、服务端免密码状态、默认源数量、实际搜索请求、私网代理拦截、匿名接口可达、渲染页面隔离 Node.js、ASCII User-Agent、跨重启持久标记，以及截图。`--without-host-node` 使用不包含 Node.js 的系统 PATH 验证应用仍可运行。输出位于 `desktop/self-test-results/`。只有本机实际运行过的平台才能列为运行验证通过；交叉打包成功不等同于 Windows 或 Intel Mac 已完成目标机器运行测试。

播放器专项验证使用独立端口 `17888` 和输出目录下的 `profile`，与日常使用数据分开。本地 HLS 片段会通过真实的 Chromium 媒体链路加载和解码；仅剧集、频道元数据由测试提供。测试记录实际视频尺寸、帧数、时钟、倍率、DOM 对象身份和截图，检查拖动预览/提交/取消、切集、倍率恢复、网页/系统全屏及直播换台。每项失败都会写入结果，未运行的项目不会被计作通过。Mac x64 在 Apple Silicon 上运行属于 Rosetta 验证，不能当作 Intel 实机验收；Windows 交叉打包也不等同于 Windows 运行验收。

完整范围要求实际 Window、WebContents、document 三层前台焦点，并要求全部 14 项检查通过。`--renderer-only` 使用真实媒体、命中测试与注入的渲染输入，执行 12 项控件检查；系统原生全屏和真实窗口失焦两项明确列为未验收。该范围单独给出 `rendererPassed`，原始 `passed` 和 `fullAcceptancePassed` 始终为 `false`。锁屏会话中的渲染层结果不能替代解锁后的系统前台验收。LaunchServices 模式另行核验实际应用 PID、可执行路径、测试标记、范围和精简 PATH，原始结果不会由启动 driver 改写。

macOS 应用采用本地 ad-hoc 签名，并在构建后验证签名和资源完整性；尚未使用 Apple Developer ID 签名或进行 Apple 公证。Windows 未配置发布者代码签名证书。macOS 首次启动可能需要在系统隐私与安全设置中确认“仍要打开”，Windows 可能显示未知发布者提示。正式发布时可另行配置签名，私钥与密码不得加入仓库或应用资源。
