'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const sharp = require('sharp');

async function createIcons() {
  const desktop = path.resolve(__dirname, '..');
  const build = path.join(desktop, 'build');
  const large = path.join(desktop, '..', 'public', 'icons', 'icon-1024.png');
  const source = fs.existsSync(large) ? large : path.join(desktop, '..', 'public', 'icons', 'icon-512.png');
  fs.mkdirSync(build, { recursive: true });
  fs.mkdirSync(path.join(build, 'icons'), { recursive: true });
  await sharp(source).resize(512, 512).png().toFile(path.join(build, 'icon-512.png'));
  const pngToIco = (await import('png-to-ico')).default;
  fs.writeFileSync(path.join(build, 'icon.ico'), await pngToIco(path.join(build, 'icon-512.png')));
  for (const size of [16, 24, 32, 48, 64, 96, 128, 256, 512]) {
    await sharp(source).resize(size, size).png().toFile(path.join(build, 'icons', `${size}x${size}.png`));
  }
  if (process.platform === 'darwin') {
    const iconset = path.join(build, 'icon.iconset');
    fs.mkdirSync(iconset, { recursive: true });
    for (const size of [16, 32, 128, 256, 512]) {
      await sharp(source).resize(size, size).png().toFile(path.join(iconset, `icon_${size}x${size}.png`));
      await sharp(source).resize(size * 2, size * 2).png().toFile(path.join(iconset, `icon_${size}x${size}@2x.png`));
    }
    execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', path.join(build, 'icon.icns')], { stdio: 'inherit' });
  } else if (!fs.existsSync(path.join(build, 'icon.icns'))) {
    console.log('macOS ICNS generation requires iconutil on macOS; Windows/Linux icons are ready.');
  }
  console.log('Prepared 幕里 PNG, ICO and platform icons.');
}

if (require.main === module) {
  createIcons().catch((error) => { console.error(error); process.exitCode = 1; });
}
module.exports = { createIcons };
