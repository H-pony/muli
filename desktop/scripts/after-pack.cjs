'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { assertClean } = require('./stage-server.cjs');

async function afterPack(context) {
  const resources = context.electronPlatformName === 'darwin'
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources');
  const staging = path.join(__dirname, '..', '.staging');
  fs.cpSync(path.join(staging, 'server'), path.join(resources, 'server'), { recursive: true, dereference: true });
  const audit = assertClean(path.join(resources, 'server'));
  const expected = JSON.parse(fs.readFileSync(path.join(staging, 'server-manifest.json'), 'utf8'));
  if (audit.fileCount !== expected.fileCount || audit.bytes !== expected.bytes) {
    throw new Error(`Packaged server differs from verified staging (${audit.fileCount}/${expected.fileCount} files).`);
  }
  console.log(`Audited packaged standalone server: ${audit.fileCount} files, no .env files or host-native modules.`);

  if (context.electronPlatformName !== 'win32') return;
  const ResEdit = require('resedit');
  const executable = path.join(context.appOutDir, 'kongwotv.exe');
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(executable), { ignoreCert: true });
  const resource = ResEdit.NtExecutableResource.from(exe);
  const icon = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(resource.entries);
  for (const group of groups) {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(resource.entries, group.id, group.lang, icon.icons.map((item) => item.data));
  }
  const versions = ResEdit.Resource.VersionInfo.fromEntries(resource.entries);
  if (!versions.length) versions.push(ResEdit.Resource.VersionInfo.createEmpty());
  for (const version of versions) {
    const buildVersion = context.packager.appInfo.buildVersion;
    version.setFileVersion(buildVersion, 1033);
    version.setProductVersion(buildVersion, 1033);
    const languages = version.getAllLanguagesForStringValues();
    for (const language of languages.length ? languages : [{ lang: 1033, codepage: 1200 }]) {
      version.setStringValues(language, {
        ProductName: '幕里',
        FileDescription: '幕里桌面客户端',
        CompanyName: '幕里 contributors',
        InternalName: 'kongwotv',
        OriginalFilename: 'kongwotv.exe',
        LegalCopyright: 'Copyright © 空我TV contributors; 幕里 contributors; AGPL-3.0-or-later',
      });
    }
    version.outputToResourceEntries(resource.entries);
  }
  resource.outputResource(exe);
  fs.writeFileSync(executable, Buffer.from(exe.generate()));
  const check = ResEdit.NtExecutableResource.from(ResEdit.NtExecutable.from(fs.readFileSync(executable)));
  if (!ResEdit.Resource.IconGroupEntry.fromEntries(check.entries).length) throw new Error('Windows branded executable icon verification failed.');
  console.log('Updated Windows executable branding using pure JavaScript (no Wine).');
}
module.exports = afterPack;
