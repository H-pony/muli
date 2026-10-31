# 空我TV Android 2.16.12 验证记录

最终安装包：

| 设备 | 文件 | 标签 | applicationId | 版本 |
| --- | --- | --- | --- | --- |
| 电视 / 盒子 | [电视 APK](../../dist/空我TV-AndroidTV-2.16.12.apk) | 空我TV 电视版 | `org.kongwotv.tv` | `2.16.12` / `2161203` |
| 手机 / 平板 | [安卓 APK](../../dist/空我TV-Android-2.16.12.apk) | 空我TV | `org.kongwotv.mobile` | `2.16.12` / `2161203` |

两个文件均已用 Android build-tools 35.0.0 的 `apksigner verify --verbose --print-certs` 验证成功；v1 与 v2 签名均为 true。证书 SHA-256：

```text
61d0e5ca3f17e6e8ec9fb5e3fb49b6be58de6582d2a49a8023589d32726cc4db
```

与保留的旧 release APK 对比，证书一致。沿用原签名，因此证书的历史 DN 中保留旧项目名；密钥和密码没有分发。新的 applicationId 与旧包独立安装。

详细文件大小、SHA-256、版本与签名信息见 [release-metadata.json](./release-metadata.json)。原始签名输出见 [TV 签名证据](./signature-tv.txt) 和 [手机签名证据](./signature-mobile.txt)；标签和 SDK 信息见 [TV 包信息](./badging-tv.txt) 和 [手机包信息](./badging-mobile.txt)。两包 minSdk 21、targetSdk 35，正式 APK 均不包含 androidTest 测试视频。

## 构建与静态检查

使用 JDK 17、Gradle 8.9、Android SDK 35 和既有本机 release 签名离线构建成功。

- `:app:assembleTvRelease`、`:app:assembleMobileRelease`：通过。
- `:app:testTvReleaseUnitTest`、`:app:testMobileReleaseUnitTest`：各 22 项通过，0 失败、0 跳过。
- `:app:lintTvRelease`：0 errors，16 warnings。
- `:app:lintMobileRelease`：0 errors，15 warnings。
- 两种 release AndroidTest APK：构建成功。

lint 的警告包括横屏设计、图标形状建议、固定中文文字、依赖版本提示和备份属性建议，没有被忽略的错误。

## 运行验证

对实际签名 release APK 执行 Android 自带 Instrumentation；本机 ServerSocket 提供原创 12 秒 H.264/AAC MP4，测试素材只在 AndroidTest 包中。

| 配置 | 环境 | 结果 | 最终日志 |
| --- | --- | --- | --- |
| 电视 | Android 14 / API 34，1920×1080，320 dpi | PASS | [TV](./smoke-tv-final.txt) |
| 手机 | Android 11 / API 30，1080×1920，420 dpi | PASS | [手机](./smoke-phone-final.txt) |
| 平板尺寸 | Android 11 / API 30，1920×1200，240 dpi，在同一隔离模拟器调整显示尺寸 | PASS | [平板](./smoke-tablet.txt) |

三种配置均检查：应用标签与品牌、直播与影视导航、搜索输入、真实可见的详情 / 选集窗口、视频与音频格式、播放进度前进、ASCII KongwoTV User-Agent、暂停、快进、切集后重新解码播放。电视使用注入的方向键 / 确认键，手机和平板使用注入的实际触摸事件。

稳定截图保存在 [电视截图](./screenshots/tv-final/home.png)、[手机截图](./screenshots/phone-final/home.png)、[平板截图](./screenshots/tablet/home.png) 的同级目录内；每套包括首页、直播、搜索、详情、选集列表和播放器。人工查看了手机竖屏详情、手机横屏播放器、电视详情与平板六列卡片 / 五列选集布局。

验证期间解决过测试 APK 的精简 desugar 类覆盖主 APK 的类加载问题；最终测试代码避免额外引入重复的精简兼容类，三个最终日志均为 PASS。这个修正只涉及 AndroidTest，已交付正式 APK 的哈希未变。

## 验证范围

已在以上模拟器完成安装、启动和媒体冒烟。没有连接实体小米电视、实体手机或实体平板；没有运行 API 21 或 API 35 模拟器。联网推荐内容和内置频道入口可加载，本轮未逐一验证全部外部点播影片和直播频道的持续可用性。
