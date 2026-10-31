# 幕里

幕里 Next.js 迁移版：免费在线视频聚合搜索与观看平台。统一品牌为幕里。基于 Next.js 15（App Router）+ TypeScript + Tailwind CSS，播放内核为 ArtPlayer + hls.js，支持亮暗双主题。

应用名称、启动图标、播放器封面、配置导出和原生客户端统一为「幕里」，使用已确认的黑白弧形标识。项目包名为 `muli`；安装 ID、`kongwotv` 数据目录、存储键与已有会话保留，原有设置、观看历史和片单继续沿用，也兼容导入「空我TV」与 LibreTV 导出的旧配置。旧版 LibreTV 设备数据仍按原有规则迁移。

## 多端安装包

构建产物统一输出到 `dist/`，平台、架构、签名条件与实际验证结果见包内的「安装说明」。

- Android 手机 / 平板：统一签名 APK，网页一致的影院风格界面，B 站式播放控制与触摸手势。
- iPhone / iPad：统一原生客户端；IPA 的签名与安装条件见 Apple 构建说明。
- 电视：独立 Android TV / Apple TV 客户端，适配遥控器和大屏。
- 电脑：Windows 和 macOS 独立客户端。

Linux、独立 Web / PWA 部署包和模拟器程序不属于默认交付物。Web 技术仍可用于客户端内部实现，开发与部署命令供按需使用。

本次品牌更新保留 Android 手机/平板、电视各自现有的应用标识；签名一致时可覆盖对应旧客户端。桌面打包方式见 `desktop/README.md`，Apple 构建与签名方式见 `apple/README.md`，Android 构建方式见 `android-tv/README.md`。

## 核心特性

- **聚合搜索**：多采集站服务端并行搜索
- **跨源同名聚合**：同名影片合并为一张卡片，展开即可比较和选择各来源
- **HLS 播放**：ArtPlayer + hls.js，广告分片过滤、自动连播、倍速、快捷键、移动端长按 3 倍速
- **直播 / IPTV**：M3U 订阅解析，`/live` 页面按分组浏览、搜索频道并站内播放（HLS + HTTP-FLV），支持 XMLTV 节目单（EPG）与频道收藏；直播流经专用长连接代理（`/api/live/stream`）转发
- **进度同步**：播放进度与观看历史存于本机 IndexedDB，精确到秒的续播
- **换源测速**：跨源搜索同名资源并测速排序，一键切换保留集数位置
- **源测试与订阅**：一键探活点播源与直播源（支持批量测活）；搜索时自动记录各源健康度，连续失败的源按阶梯时长自动停用（30 分钟 → 24 小时 → 长期），可一键恢复；订阅远程源列表（一份 幕里-SourceList JSON 可同时下发点播源与直播源，也可直接填 TVBOX 配置地址，自动导入其中可直接使用的接口），可导出分享
- **首页排行榜**：电影、华语/海外剧集、国内/海外综艺和百度热播剧同时以海报横排展示；60s API 优先、豆瓣移动端直连降级，服务端缓存一小时，短暂故障可使用此前成功取得的真实榜单；免 key，`60S_API_BASE` 可指向自部署实例
- **分类片库**：电影、剧集、综艺使用多列海报流，向下滚动自动加载下一页；首页各榜单的「全部」以及分类页的「全部」进入 `/browse/movies`、`/browse/tv`、`/browse/shows`，按类型、地区、年份、评分或新近程度筛选。筛选保存在地址中，详情和播放返回时恢复原条件、已加载内容和位置；上游数据读完后停止加载
- **影片详情与片单**：点击榜单海报查看真实剧情、评分、演职员与剧照背景，搜索播放源并选择剧集；支持本机保存待看片单，首页继续观看；设置可额外开启豆瓣分类推荐或 Bangumi 新番放送
- **PWA**：可安装到桌面 / 主屏幕，亮暗双主题无首屏闪烁

## 部署

### Docker

本项目使用本地源码构建幕里 镜像：

```bash
# 默认无需访问验证；如需密码，可在 .env 中按需设置 PASSWORD
cp .env.example .env
docker compose up -d --build
```

默认镜像名为 `kongwotv:2.16.12`，应用监听 8080。需要自建镜像仓库时在 `.env` 设置 `KONGWOTV_IMAGE`。

```yaml
services:
  kongwotv:
    build: .
    image: kongwotv:2.16.12
    container_name: kongwotv
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      - PASSWORD=  # 留空直接访问，按需填写可开启验证
```

版本号以 `package.json` 为单一来源，`/api/status` 返回 `version` 字段。环境变量的完整注释见 `docker-compose.yml`。公开服务器建议由反向代理提供 HTTPS；桌面应用仅在本机回环地址启动服务。

### 手动运行

```bash
npm install
npm run build
npm start   # 监听 8080
```

### 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `PASSWORD` | 否 | 可选访问密码；留空或不设置时无需验证，页面与接口均可直接使用 |
| `PROXY_SECRET` | 否 | 会话/代理签名密钥；不设置时从 PASSWORD 派生（多实例部署建议显式设置） |
| `DEFAULT_SOURCES` | 否 | 覆盖内置已验证的虎牙、火狐、三六点播接口（JSON 数组）；首次出现自动勾选，显式 `[]` 关闭默认源 |
| `REQUEST_TIMEOUT` | 否 | 代理上游请求超时（毫秒），默认 8000 |
| `MAX_RETRIES` | 否 | 代理请求重试次数，默认 1 |
| `SEARCH_MAX_PAGES` | 否 | 每个搜索源最多抓取的页数（1-50，默认 5）。第一页会读取源站 `pagecount`，实际页数 = min(源站总页数，该值)；页间并行请求，单页失败只丢该页 |
| `SEARCH_SOURCE_TIMEOUT_MS` | 否 | 单个搜索源的总死线（毫秒，3s-60s，默认 10000）：该源所有分页请求须在时限内完成，到点中断并将其标记为「超时」；健康度自动停用也以此为超时判定依据 |
| `USER_AGENT` | 否 | 代理请求使用的 UA（豆瓣封面防盗链等场景），默认 Chrome UA |
| `FALLBACK_CORS_PROXY` | 否 | 豆瓣推荐数据直连被拒时降级使用的 CORS 代理地址 |
| `COOKIE_SECURE` | 否 | 显式覆盖会话 cookie 的 `Secure` 标记（`true` / `false`）；默认按请求协议自动推导。反向代理未正确传递 `x-forwarded-proto` 导致 HTTPS 下登录失效时，设为 `true` 可解 |
| `60S_API_BASE` | 否 | 影视榜单推荐源（60s API）实例地址，默认 `https://60s.crystelf.top`；有限流，高频使用可[自部署](https://github.com/vikiboss/60s) |
| `DEFAULT_LIVE_SOURCES` | 否 | 覆盖内置精选直播频道，JSON 数组：`[{"name":"源名","url":"https://.../list.m3u","epg":"https://.../epg.xml.gz"}]`；`epg` 可选，显式 `[]` 关闭默认源 |
| `DEFAULT_SUBSCRIPTIONS` | 否 | 预置数据源订阅（幕里-SourceList JSON 链接，也接受 TVBOX 配置地址），JSON 数组：`["https://.../sources.json", {"url":"https://.../list.json","name":"名称"}]`。首次访问自动导入点播源与直播源，之后每 24h 静默刷新；用户删除后不再自动加回 |
| `DEFAULT_RECOMMEND_SOURCE` | 否 | 首页补充内容的默认值（`douban` / `bangumi` / `hot-list`，出厂默认 `hot-list` 表示仅排行榜）；排行榜始终展示，仅对未在设置中主动选择过的用户生效 |
| `LIVE_ALLOW_PRIVATE` | 否 | 设为 `1` 时允许直播流代理访问内网/保留地址（自建 IPTV 场景），默认关闭以维持 SSRF 防护 |

## 使用说明

1. **添加点播源**：设置 → 源管理 → 点播源 → 添加 API，填入 Apple CMS 采集站地址（如 `https://example.com/api.php/provide/vod`），可选填详情页地址（部分源需要爬详情页提取播放地址）。
2. **搜索**：勾选点播源后输入片名；搜索通过服务端聚合，个别源失败不影响整体结果。
3. **播放**：榜单海报打开影片详情，「立即播放」可查找已勾选播放源，选择来源和剧集进入 `/watch`；搜索结果同样可进入详情选集。支持快捷键（空格/←→/↑↓/F/Alt+Shift+←→）、移动端长按 3 倍速、自动连播、换源测速。观看/暂停时后续分片自动缓存到本地（设置可关），播放页可「下载本集」（TS/MP4）离线观看。
4. **进度与历史**：自动保存在本设备 IndexedDB，仅定位信息入库，播放时自动同步最新剧集。
5. **配置迁移**：设置 → 数据 → 配置导入导出（兼容更名前导出的旧版 JSON 配置和历史记录）。
6. **返回**：影片详情、关联影片详情和观看历史具有独立的浏览历史；播放页返回进入前的详情或历史面板，并恢复分类、搜索和滚动位置。换集、换播放源在同一次播放访问中替换地址，返回时不会逐个经过之前的集数。直接打开播放链接时使用经过校验的站内返回地址。

## 直播 / IPTV

1. **默认直播源**：未配置 `DEFAULT_LIVE_SOURCES` 时，使用内置精选频道，来源均经过逐条视频解码验证，不会自动重新拉入上游完整列表中的失效频道、MP4测试视频、组播或短期签名链接。部署者的显式列表可覆盖默认值；设为 `[]` 可关闭默认源。设置 → 源管理 → 直播源中仍可启停或添加自己的 M3U/M3U8 订阅。
2. **观看与切线**：进入「直播」页，按分组筛选或搜索频道，点击即播；同一频道的多条地址合并展示，在播放器下方手动切换线路。CCTV5、CCTV5+、CCTV4K 等不同频道保持独立；频道列表可手动刷新，也会每 10 分钟更新。各订阅独立加载，一个源失败不会阻塞其他源。
3. **播放兼容**：支持 HLS（m3u8）与 HTTP-FLV；直连失败走本站直播代理重试，HTTPS 页面上的 HTTP 地址直接走同源代理；浏览器原生 HLS 可用时可作为兼容路径。
4. **节目单**：订阅配置的 EPG 优先，否则使用 M3U 头部声明的 XMLTV 地址；频道具有对应 `tvg-id` 时展示当前/接下来节目与播放进度。
5. **收藏与导出**：收藏按频道保存，切线或地址更新后保持；兼容旧版按流 URL 保存的收藏和最近观看。订阅可一键导出为标准 M3U 文件，供 PotPlayer / VLC 等外部播放器使用。

详细机制可参考[上游直播 / IPTV 文档](https://libretv.is-an.org/wiki/Live-IPTV.html)。

> 应用默认订阅上述两个公开频道列表，可由部署者覆盖或关闭；所有频道内容由第三方源站提供，应用不存储、不制作直播内容。公开地址可能失效，列表状态标注也不代表当前设备一定可播；可在播放器下方手动切换线路。内网自建源默认受 SSRF 防护限制，自部署者可显式设置 `LIVE_ALLOW_PRIVATE=1`。

## 数据源订阅 / 分享

数据源（点播源 + 直播源）可以 **导出为一份 JSON → 托管到公开 URL → 他人在「设置 → 源管理 → 数据源订阅」里填入该 URL 订阅**。

托管地址没有特殊要求，可用 [npoint.io](https://www.npoint.io/) 免费托管 JSON（粘贴内容即可得到一个公开 URL），Gist、对象存储、任意静态托管同样可用。

### 订阅格式（幕里-SourceList JSON）

```json
{
  "name": "我的源列表",
  "version": 2,
  "sources": [
    {
      "name": "示例点播源",
      "url": "https://example.com/api.php/provide/vod",
      "detail": "https://example.com",
      "isAdult": false
    }
  ],
  "liveSources": [
    {
      "name": "示例直播源",
      "url": "https://example.com/list.m3u",
      "epg": "https://example.com/epg.xml.gz"
    }
  ]
}
```

**字段说明**：

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `name` | 顶层 | string | 否 | 列表名称，订阅后显示在订阅条目上；缺省时显示订阅地址主机名 |
| `version` | 顶层 | number | 否 | 格式版本，当前为 `2`（新增 `liveSources`）；导入端目前忽略该字段 |
| `sources` | 顶层 | array | 否 | **点播源**数组（Apple CMS 采集站），最多 100 个，超出部分截断 |
| `sources[].name` | 项 | string | 否 | 源显示名；缺省时使用 URL 主机名 |
| `sources[].url` | 项 | string | **是** | Apple CMS 采集接口地址（公网 http/https），结尾 `/` 自动去除 |
| `sources[].detail` | 项 | string | 否 | 详情页根地址，用于列表接口拿不到播放地址、需要爬详情页提取 m3u8 的源 |
| `sources[].isAdult` | 项 | boolean | 否 | 成人内容标记，默认 `false`。标记为 `true` 的源名称旁显示 **(18+)** 徽章；设置中的「成人内容过滤」开启（默认开启）时该源不可勾选、不参与搜索，需先关闭过滤才能启用 |
| `liveSources` | 顶层 | array | 否 | **直播源**数组（M3U 播放列表），最多 50 个，超出部分截断 |
| `liveSources[].name` | 项 | string | 否 | 源显示名；缺省时使用 URL 主机名 |
| `liveSources[].url` | 项 | string | **是** | M3U 播放列表地址（http/https） |
| `liveSources[].epg` | 项 | string | 否 | XMLTV 节目单地址（`xml` / `xml.gz`），用于 `/live` 页展示节目单；地址非法时只丢弃该字段、保留整条源 |

**兼容与限制**：

- 只写 `sources` 的老订阅照常可用（纯点播），只写 `liveSources` 则是纯直播订阅；两者都缺时提示「订阅内容格式不正确」；裸数组 `[{ "name": "...", "url": "..." }]` 视为点播源；
- 按 `url` 去重（先到先得）；非 http(s) 地址会被过滤；**点播源**另需为公网地址（内网/回环/保留地址会被静默过滤），**直播源**在部署者设置 `LIVE_ALLOW_PRIVATE=1` 时可使用内网自建源地址；
- 订阅由**服务端**拉取（拉取前经过 SSRF 校验），因此订阅地址**无需配置 CORS**，Gist、对象存储、任意静态托管均可。

### 兼容 TVBOX 配置

订阅地址也可以直接填 **TVBOX 配置**（形如 `{"sites": [...], "lives": [...], "parses": [...]}`）：服务端按内容结构自动识别格式，无需手动选择。

- **点播源**：导入 `sites` 中 `type: 1` 的 JSON 接口（即 Apple CMS 采集站）；部分共享配置省略 `type` 或写成 `0`，但地址命中 `api.php/provide/vod` 时同样导入；站点自身标记 `searchable: 0`（不可搜索）时跳过；
- **直播源**：导入 `lives` 中 `type: 0`（或省略）的 M3U 播放列表，`epg` 字段一并带上；txt 频道列表与单仓 JSON 不支持；
- **Spider 类站点会跳过**：`type: 3` 的 Spider（`csp_*` / `.jar` / `.js` / `.py`）需要 TVBOX 自身的 Spider 引擎才能运行，Node 侧无法执行；XML 接口、外链 JSON 同理。被跳过的条目不影响其余导入，导入结果会如实提示，如「已同步 8 个点播源、2 个直播源（TVBOX 配置）；跳过 96 个不可用条目（Spider 引擎 92、XML 接口 4）」；
- TVBOX 配置常含上百条站点且以 Spider 为主，**只导入个位数到十几个属正常现象**；
- **格式容错**：配置里的 `//` 注释、尾随逗号、字符串内未转义的换行会自动修正后再解析（共享配置中很常见，TVBOX 客户端用的 fastjson 同样容忍这些写法）；
- 其他限制：订阅地址需直接返回 JSON（Base64 / 压缩包装的分享链接不支持）；TVBOX「多仓」配置（顶层为 `urls` 数组）不支持，请填单仓配置；地址公网校验、去重与数量上限与上方格式完全一致。

### 订阅行为

- **订阅**：设置 → 源管理 → 数据源订阅 → 填入订阅地址 → 「订阅」，导入的点播源自动勾选、直播源自动启用，均带「订阅」标识，条目上显示「点播 N · 直播 M」；
- **同步**：订阅条目上的 **⟳** 手动强制同步，整体替换该订阅名下的点播源与直播源；
- **管理边界**：订阅源以远端列表为准，单独编辑会在下次同步时被覆盖，单独移除会在重新同步时恢复；如需调整请改远端列表，或直接删除整个订阅。删除订阅时点播源全部移除；直播源为**多归属共享**——同一 M3U 可被多个订阅引用（名称/EPG 以首次导入为准），删除订阅或远端列表中移除该源后再同步，都只摘除本订阅的引用，仅当不再被任何订阅引用时才移除该源，手动添加的源不受同步影响，**收藏的频道始终保留**；
- **导出分享**：设置 → 源管理 → 数据源订阅 → 「导出数据源」，把当前全部点播源与直播源（预置 + 手动 + 订阅，按 URL 去重）导出为上述 JSON；也可用「发布为链接」，把当前**已勾选启用**的源一键上传到公开粘贴板（paste.rs，失败自动降级 0x0.st），直接返回可填入订阅框的 URL，无需自备托管。注意：发布的内容**公开可读**，且每次发布生成新链接、不支持覆盖更新，需长期稳定请用导出 + 自行托管。

> 订阅由服务端拉取（经过 SSRF 校验），因此订阅地址无需配置 CORS。详细机制可参考[上游数据源文档](https://libretv.is-an.org/wiki/Data-Sources.html)。

## 开发

```bash
npm install
npm run dev                         # http://localhost:8080，默认无需验证
npm test                            # 核心库单元测试（cms-parser / m3u8 / ssrf）
npm run typecheck
```

原始测试与文档结构可参考[上游开发文档](https://libretv.is-an.org/wiki/Development.html)。

生成 Web 独立部署包：

```bash
DOCKER_BUILD=1 npm run build
npm run package:web
```

桌面、Android 和 Apple 原生构建分别见对应目录的说明。待各端文件就绪后，`python3 scripts/package-release.py` 可收集完整源码、主要安装包与 SHA-256，并生成整套压缩包。

## 发布新版本

版本号以 `package.json` 为单一来源。GitHub Actions 默认按当前仓库所有者发布 `ghcr.io/<owner>/kongwotv`。只有同时配置仓库变量 `DOCKERHUB_IMAGE` 与 `DOCKER_USERNAME` / `DOCKER_PASSWORD` secrets 才会同步到自己的 Docker Hub 仓库。

```bash
npm version patch
# 审核代码与构建结果后，自行推送 commit 和版本 tag
```

## 安全说明

- 默认无需密码；显式设置 `PASSWORD` 后才启用访问验证，密码仅保存在服务端。
- 配置密码时，登录接口有 IP 速率限制（10 次 / 10 分钟）。
- 代理内置 SSRF 防护：拒绝内网/保留地址（含 DNS 解析后校验），仅放行 http(s)。
- 配置密码时，未登录会话仅允许代理图片类目标（豆瓣封面防盗链需要）；免密码模式下播放与直播代理均可直接使用。

## 衍生作品

| 项目 | 说明 |
| --- | --- |
| [OrionTV](https://github.com/orion-lib/OrionTV) | Apple TV / Android TV 客户端（React Native TVOS + Expo），配合 MoonTV 使用 |
| [LunaTV](https://github.com/MoonTechLab/LunaTV) | 影视聚合站（Next.js），支持 Redis / Upstash 等多存储后端 |
| [Selene-TV](https://github.com/MoonTechLab/Selene-TV) | Android TV（Leanback）客户端，Kotlin + Compose，对接 MoonTV / Helios |
| [EchoTV](https://github.com/hoowhoami/EchoTV) | Flutter 全平台客户端（已归档） |
| [WarHutTV](https://github.com/OuOumm/WarHutTV) | Go + React 的自托管影视聚合站 |
| [DecoTV](https://github.com/Decohererk/DecoTV) | 聚合播放站（原 KatelyaTV） |
| [Joyflix](https://github.com/jeffernn/Joyflix-Mac-Objective-C) | macOS 原生影视聚合客户端（Objective-C） |
| [MoonCakeTV](https://github.com/MoonCakeTV/MoonCakeTV) | 影视聚合搜索站（Next.js），文件存储、一键脚本部署 |
| [OrangeTV](https://github.com/djteang/OrangeTV) | 跨平台影视聚合播放器（Next.js），Kvrocks/Redis/Upstash 多存储与多端同步 |

> 本项目基于 LibreSpark 的开源代码扩展，保留 AGPL-3.0-or-later 许可与原作者署名。原始项目的静态 HTML + Express 代码见 [backup-2025 分支](https://github.com/LibreSpark/LibreTV/tree/backup-2025)。

## 免责声明

本项目不存储、不制作任何视频内容，仅提供第三方公开接口的聚合与播放能力，内容的合法性由对应数据源负责。

☕ 觉得有用的话，可以到 [AFDIAN](https://afdian.com/a/veehub) 请我喝杯咖啡。

## 精选源维护与播放验证

点播接口与直播频道统一维护于 `shared/sources/verified.json`。修改后运行 `node scripts/sync-verified-sources.cjs`，同步苹果、安卓原生资源和公开 M3U；`--check` 只核对生成文件是否一致。电脑与安卓客户端使用同一份精选数据，并按实测的 HLS / FLV 格式选择解码器；苹果 AVPlayer 不支持 FLV，所以苹果资源只打包同一清单中的 HLS 子集。原生客户端仅启用精选频道时不追加旧订阅缓存，避免坏条目重新出现。

`node scripts/verify-source-playback.cjs` 通过真实页面、真实搜索/详情与媒体请求验证播放器，不替换网络响应。默认访问 `http://localhost:8082`，可用 `SOURCE_TEST_BASE_URL` 覆盖；点播检查起播、播放时间和视频帧推进及跳到30秒，直播检查起播和时间推进，并保存截图及 JSON 到 `artifacts/source-integration-20261021`。验证前可用 `NEXT_DIST_DIR=.next-source-integration npx next dev -p 8082` 启动独立服务，避免开发服务与已打包桌面服务共用 `.next` 造成资源冲突。源可用性仍随时间与网络变化。
