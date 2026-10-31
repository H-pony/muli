#!/usr/bin/env python3
"""Refresh bundled data and icon assets. Requires Pillow; not needed for normal builds."""
from pathlib import Path
import json
import shutil
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
RES = ROOT / 'Resources'
RES.mkdir(exist_ok=True)

def json_file(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

def info():
    return {'version': 1, 'author': 'xcode'}

for filename in ['sources.json', 'channels.m3u']:
    shutil.copy2(REPO / 'android-tv/app/src/main/assets' / filename, RES / filename)
shutil.copy2(REPO / 'LICENSE', RES / 'LICENSE.txt')
icon = Image.open(REPO / 'public/icons/icon-1024.png').convert('RGB')
common = RES / 'Assets.xcassets'
json_file(common / 'Contents.json', {'info': info()})
brand = common / 'BrandMark.imageset'
brand.mkdir(exist_ok=True)
icon.save(brand / 'BrandMark.png')
json_file(brand / 'Contents.json', {'images': [{'filename': 'BrandMark.png', 'idiom': 'universal'}], 'info': info()})
ios = RES / 'Assets-iOS.xcassets'
json_file(ios / 'Contents.json', {'info': info()})
appicon = ios / 'AppIcon.appiconset'
appicon.mkdir(exist_ok=True)
icon.save(appicon / 'AppIcon-1024.png')
json_file(appicon / 'Contents.json', {'images': [{'filename': 'AppIcon-1024.png', 'idiom': 'universal', 'platform': 'ios', 'size': '1024x1024'}], 'info': info()})
tv = RES / 'Assets-tvOS.xcassets'
json_file(tv / 'Contents.json', {'info': info()})
brandassets = tv / 'AppIcon.brandassets'
assets = []
for label, size in [('Small', (400, 240)), ('Large', (1280, 768))]:
    filename = 'App Icon - ' + label + '.imagestack'
    stack = brandassets / filename
    layers = []
    for layer_name in ['Front', 'Back']:
        layer_file = layer_name + '.imagestacklayer'
        images = stack / layer_file / 'Content.imageset'
        images.mkdir(parents=True, exist_ok=True)
        if layer_name == 'Back':
            image = Image.new('RGB', size, (0, 0, 0))
        else:
            image = Image.new('RGBA', size, (0, 0, 0, 0))
            side = int(size[1] * .90)
            art = icon.resize((side, side), Image.Resampling.LANCZOS)
            image.paste(art, ((size[0]-side)//2, (size[1]-side)//2))
        image.save(images / 'Icon.png')
        json_file(images / 'Contents.json', {'images': [{'idiom': 'tv', 'filename': 'Icon.png', 'scale': '1x'}], 'info': info()})
        json_file(stack / layer_file / 'Contents.json', {'info': info()})
        layers.append({'filename': layer_file})
    json_file(stack / 'Contents.json', {'layers': layers, 'info': info()})
    assets.append({'idiom': 'tv', 'size': f'{size[0]}x{size[1]}', 'role': 'primary-app-icon', 'filename': filename})
for label, size in [('Top Shelf Image', (1920, 720)), ('Top Shelf Image Wide', (2320, 720))]:
    images = brandassets / (label + '.imageset')
    images.mkdir(parents=True, exist_ok=True)
    image = Image.new('RGB', size, (0, 0, 0))
    art = icon.resize((600, 600), Image.Resampling.LANCZOS)
    image.paste(art, ((size[0]-600)//2, 60))
    image.save(images / 'Shelf.png')
    json_file(images / 'Contents.json', {'images': [{'idiom': 'tv', 'filename': 'Shelf.png', 'scale': '1x'}], 'info': info()})
    assets.append({'idiom': 'tv', 'size': f'{size[0]}x{size[1]}', 'role': 'top-shelf-image-wide' if 'Wide' in label else 'top-shelf-image', 'filename': label + '.imageset'})
json_file(brandassets / 'Contents.json', {'assets': assets, 'info': info()})
print('Bundled source data, original license, iOS icons and Apple TV layered icons prepared.')
