#!/usr/bin/env python3
"""Generate Android brand assets from the shared 幕里 icon with Pillow."""
from pathlib import Path
import argparse
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / 'app/src/main/res'


def main():
    parser = argparse.ArgumentParser(description='生成幕里 Android 启动器、应用内标识与电视横幅。')
    parser.add_argument('--icon', type=Path, default=ROOT.parent / 'public/icons/icon-1024.png')
    parser.add_argument('--font', type=Path, default=Path('/System/Library/Fonts/STHeiti Medium.ttc'))
    options = parser.parse_args()
    source = Image.open(options.icon).convert('RGBA')
    icon = Image.new('RGBA', source.size, 'white')
    icon.alpha_composite(source)
    icon = icon.convert('RGB')
    for density, size in {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}.items():
        target = RES / f'mipmap-{density}/ic_launcher.png'
        target.parent.mkdir(parents=True, exist_ok=True)
        icon.resize((size, size), Image.Resampling.LANCZOS).save(target, optimize=True)
    icon.resize((256, 256), Image.Resampling.LANCZOS).save(RES / 'drawable-nodpi/kongwotv_mark.png', optimize=True)

    scale = 4
    banner = Image.new('RGB', (320 * scale, 180 * scale), 'black')
    draw = ImageDraw.Draw(banner)
    def font(size):
        return ImageFont.truetype(str(options.font), size * scale)
    white_mark = ROOT.parent / 'public/brand/muli-mark-white.png'
    banner_mark = Image.open(white_mark).convert('RGBA') if white_mark.exists() else source
    banner_mark = banner_mark.resize((88 * scale, 88 * scale), Image.Resampling.LANCZOS)
    banner.paste(banner_mark, (20 * scale, 42 * scale), banner_mark)
    draw.text((122 * scale, 60 * scale), '幕里', font=font(35), fill='white')
    draw.text((124 * scale, 106 * scale), '影视 · 直播 · 随心看', font=font(10), fill='white')
    draw.rounded_rectangle((124 * scale, 130 * scale, 291 * scale, 133 * scale), radius=scale, fill='white')
    banner.resize((320, 180), Image.Resampling.LANCZOS).save(RES / 'drawable-nodpi/tv_banner.png', optimize=True)
    print('已生成幕里五种密度的启动图标、应用内标识及 320×180 黑白电视横幅。')


if __name__ == '__main__':
    main()
