"""Export 幕里 platform assets from the approved ImageGen PNG, without redrawing it.

The source is shared/brand/muli-mark-source.png. Re-running this script keeps every
client on the same silhouette. Platform-specific scripts consume icon-1024.png.
Requires Pillow; MULI_FONT or the previous KONGWOTV_FONT can select a CJK font.
"""
from pathlib import Path
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'shared/brand/muli-mark-source.png'
FONT = os.environ.get('MULI_FONT', os.environ.get('KONGWOTV_FONT', '/System/Library/Fonts/STHeiti Medium.ttc'))
SIZE = 1024


def mark_mask():
    with Image.open(SOURCE) as source:
        source.load()
        if source.mode != 'RGBA':
            raise ValueError('The approved master must retain its transparent background.')
        alpha = source.getchannel('A')
        # Ignore faint extraction residue outside the visible approved silhouette.
        bounds = alpha.point(lambda value: 255 if value > 32 else 0).getbbox()
        if not bounds:
            raise ValueError('The approved master has no visible silhouette.')
        return alpha.crop(bounds).point(lambda value: 0 if value < 8 else value)


def render_mark(side, color, fraction=0.96):
    mask = mark_mask()
    mask.thumbnail((round(side * fraction), round(side * fraction)), Image.Resampling.LANCZOS)
    result = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    solid = Image.new('RGBA', mask.size, color)
    solid.putalpha(mask)
    result.alpha_composite(solid, ((side - mask.width) // 2, (side - mask.height) // 2))
    return result


def generate_icon():
    # The OS supplies the application tile's outer mask. iOS requires opaque RGB.
    tile = Image.new('RGBA', (SIZE, SIZE), '#000000')
    tile.alpha_composite(render_mark(SIZE, '#ffffff', 0.72))
    return tile.convert('RGB')


def centered(draw, center, text, size):
    face = ImageFont.truetype(FONT, size)
    box = draw.textbbox((0, 0), text, font=face)
    draw.text((center[0] - (box[2] + box[0]) / 2, center[1] - (box[3] + box[1]) / 2), text, font=face, fill='#ffffff')


def main():
    icons = ROOT / 'public/icons'
    brand = ROOT / 'public/brand'
    icons.mkdir(parents=True, exist_ok=True)
    brand.mkdir(parents=True, exist_ok=True)
    render_mark(SIZE, '#000000').save(brand / 'muli-mark-black.png', optimize=True)
    render_mark(SIZE, '#ffffff').save(brand / 'muli-mark-white.png', optimize=True)
    image = generate_icon()
    for side in [48, 96, 144, 192, 512, 1024]:
        image.resize((side, side), Image.Resampling.LANCZOS).save(icons / f'icon-{side}.png', optimize=True)
    image.resize((180, 180), Image.Resampling.LANCZOS).save(icons / 'apple-touch-icon.png', optimize=True)
    image.save(ROOT / 'public/favicon.ico', sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    poster = Image.new('RGBA', (1600, 900), '#000000')
    poster.alpha_composite(render_mark(240, '#ffffff'), (680, 210))
    draw = ImageDraw.Draw(poster)
    centered(draw, (800, 555), '幕里', 96)
    centered(draw, (800, 655), '留一点时间，给喜欢的故事。', 30)
    poster.convert('RGB').save(ROOT / 'public/player-poster.png', optimize=True)
    print('Generated 幕里 monochrome marks, 48–1024px icons, favicon and player poster from the approved master.')


if __name__ == '__main__':
    main()
