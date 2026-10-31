'use client';

import { Header } from '@/components/header';
import { SiteFooter } from '@/components/site-footer';
import { TMDBAttribution } from '@/components/artwork-settings';

export default function AboutPage() {
  return (
    <div className="tv-about-page min-h-screen flex flex-col">
      <Header />
      <main id="main-content" tabIndex={-1} className="tv-about-main flex-1">
        <section className="tv-about-intro">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" width={62} height={62} alt="" />
          <h1 className="text-xl font-bold text-content mb-3">关于 幕里</h1>
          <p className="text-sm text-muted leading-relaxed">
            幕里 是一个免费的在线视频搜索与观看平台。输入片名即可在多个点播源中聚合搜索，
            无需注册、无内嵌广告、不存储任何视频文件。所有播放内容均来自第三方公开接口。
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-content mb-2.5">快捷键</h2>
          <ul className="text-sm text-muted space-y-1.5 list-disc list-inside">
            <li><code className="text-accent">空格</code> 播放 / 暂停</li>
            <li><code className="text-accent">←</code> / <code className="text-accent">→</code> 快退 / 快进 5 秒</li>
            <li><code className="text-accent">↑</code> / <code className="text-accent">↓</code> 音量调节</li>
            <li><code className="text-accent">F</code> 切换全屏</li>
            <li><code className="text-accent">Alt + Shift + ←/→</code> 上一集 / 下一集</li>
            <li>移动端长按视频可 3 倍速播放</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-content mb-2.5">隐私与数据</h2>
          <p className="text-sm text-muted leading-relaxed">
            你的搜索历史、观看进度等数据仅保存在本设备浏览器中（IndexedDB），不会上传到服务器。
            聚合搜索请求由服务端代理转发，第三方数据源不会看到你的 IP 地址。
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-content mb-2.5">项目与许可</h2>
          <p className="text-sm text-muted leading-relaxed">
            幕里 基于 LibreSpark 的开源项目扩展，按 AGPL-3.0-or-later 许可提供。
            原作者、第三方组件与内容来源的版权归各自权利人所有。
            <a className="text-accent hover:underline" href="https://github.com/LibreSpark/LibreTV" target="_blank" rel="noopener noreferrer">查看上游源码与署名</a>。
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-content mb-2.5">高清图片来源</h2>
          <TMDBAttribution />
        </section>

        <section>
          <h2 className="text-base font-semibold text-content mb-2.5">免责声明</h2>
          <p className="text-sm text-faint leading-relaxed">
            本项目不存储、不制作任何视频内容，仅提供第三方公开接口的聚合与播放能力。
            请尊重版权，所有内容的合法性由对应数据源负责。
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
