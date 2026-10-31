# Android 本地验证素材

`smoke.mp4` 是用 FFmpeg 的 `testsrc2` 测试图与 `sine` 音调生成的 12 秒 H.264/AAC MP4，只存在于 androidTest 资源，不会进入正式 APK。

生成命令：

```sh
ffmpeg -f lavfi -i testsrc2=size=320x180:rate=24 -f lavfi -i sine=frequency=440:sample_rate=44100 -t 12 -c:v libx264 -preset ultrafast -crf 30 -pix_fmt yuv420p -c:a aac -b:a 48k -movflags +faststart app/src/androidTest/assets/smoke.mp4
```

`SmokeInstrumentation` 使用 Android 自带 Instrumentation，无需新增测试依赖。它对真正的 release 构建检查应用标签、品牌、导航、详情弹窗，以及通过本机 HTTP 服务进行的视频解码、ASCII User-Agent、暂停、快进和选集；截图存入被测应用的外部文件目录。

```sh
gradle :app:assembleTvRelease :app:assembleMobileRelease :app:assembleTvReleaseAndroidTest :app:assembleMobileReleaseAndroidTest
adb install -r app/build/outputs/apk/tv/release/幕里-AndroidTV-2.16.12.apk
adb install -r app/build/outputs/apk/androidTest/tv/release/app-tv-release-androidTest.apk
adb shell am instrument -w -e profile tv org.kongwotv.tv.test/org.kongwotv.tv.SmokeInstrumentation
```

手机把路径中的 tv 替换为 mobile，并使用 `org.kongwotv.mobile.test/org.kongwotv.tv.SmokeInstrumentation`。

## TV 首页与输入法专项

`-e home true` 验证顶部横向导航、进入主播放按钮、通过遥控器访问详情与轮播、切片后焦点保持、目录刷新时保留当前推荐，以及「查看全部」进入实际搜索页。

`-e search true` 验证真实系统输入法的打开和关闭，覆盖搜索 / 完成动作、回车按下与抬起、页面搜索按钮、连续重新编辑及直播频道筛选。确认提交只执行一次、文字保留、焦点落到搜索按钮，并连续检查系统 `mInputShown=false`。此模式不依赖远端搜索结果。

`-e commentary true` 通过真实搜索页输入关键词并按输入法搜索，等待真实来源响应后检查已渲染影片标题。默认关键词为“周星驰”，可用 `-e keyword 少林足球` 覆盖；超时或空结果标为 `UNVERIFIED`，不会把上游无数据当作过滤成功。该模式只检查当前渲染页，不自动遍历“加载更多”；标题过滤及数量上限前的行为另由离线回归覆盖。

```sh
adb -s emulator-5554 shell am instrument -w -e home true -e profile tv-home-final org.kongwotv.tv.test/org.kongwotv.tv.SmokeInstrumentation
adb -s emulator-5554 shell am instrument -w -e search true -e profile tv-search-final org.kongwotv.tv.test/org.kongwotv.tv.SmokeInstrumentation
```

专项截图同时写入 `/data/local/tmp/kongwo-<profile>-*.png`，供普通 shell 拉取。Instrumentation 结束可能令被测进程退出，验收后可另行启动 `.MainActivity` 保留预览。2026-10-25 本机 Android TV API34 的构建、原版失败基线、专项回归及完整播放器 smoke 证据保存在根目录 `artifacts/tv-reference-ui-20261025/`；不是实体电视验收记录。


## build6 真实详情横图模式

`-e artwork true` 只验证真实影片详情、横图与失败回退，不启动本地视频 fixture。它从 360 资源的真实影片 ID 4342 取得《燃烧女子的肖像》2019 的详情，要求无 TMDB 凭据命中共享 TMDB531428，并等待真实 CDN 图片成功解码；随后故意连接不可用的本机图片地址，确认同一背景控件恢复原来源封面。也检查两端原生设置和 TMDB 官方声明。

本轮仅在新命名、全新 userdata 的隔离 AVD 上运行（手机 API30、电视 API34），没有操控既有 AVD 或真机。可对自己准备的隔离模拟器使用：

```sh
adb -s emulator-5578 shell am instrument -w -e artwork true -e profile artwork-tv-evidence org.kongwotv.tv.test/org.kongwotv.tv.SmokeInstrumentation
adb -s emulator-5578 pull /data/local/tmp/kongwo-artwork-tv-evidence-artwork-details.png
```

截图同时保存应用的外部文件目录与普通 shell 可读取的 `/data/local/tmp/kongwo-<profile>-artwork-*.png`；后者使用 Android 原生 `screencap`，适用于不支持 root 的 Android TV 正式镜像，不替换或合成画面。手机使用 mobile 测试包及自己的模拟器序列号。原始证据保存在根目录 [Android build6 日志与截图](../../../../artifacts/artwork-build6/android/)。
