#!/usr/bin/env python3
"""Regenerate the checked-in Xcode project using only Python's standard library."""
from pathlib import Path
import hashlib
import json
import plistlib
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT / 'KongwoTV.xcodeproj'
PROJECT.mkdir(exist_ok=True)
(ROOT / 'Config').mkdir(exist_ok=True)

def uid(value):
    return hashlib.sha256(value.encode()).hexdigest()[:24].upper()

def quoted(value):
    return json.dumps(str(value), ensure_ascii=False)

def plist_value(value):
    if isinstance(value, dict):
        return '{ ' + ' '.join(f'{quoted(k)} = {plist_value(v)};' for k, v in value.items()) + ' }'
    if isinstance(value, list):
        return '( ' + ', '.join(plist_value(x) for x in value) + ' )'
    return quoted(value)

objects = {}
def obj(key, kind, **values):
    ident = uid(key)
    objects[ident] = {'isa': kind, **values}
    return ident

source_refs = []
resource_refs = []
for path in sorted((ROOT / 'Sources').glob('*.swift')):
    source_refs.append(obj(str(path.relative_to(ROOT)), 'PBXFileReference', lastKnownFileType='sourcecode.swift', path=str(path.relative_to(ROOT)), sourceTree='<group>'))
for path in [ROOT / 'Resources' / x for x in ['sources.json', 'channels.m3u', 'LICENSE.txt', 'NOTICE.txt', 'PrivacyInfo.xcprivacy', 'Assets.xcassets']]:
    kind = 'folder.assetcatalog' if path.suffix == '.xcassets' else 'text.plist.xml' if path.suffix == '.xcprivacy' else 'text'
    resource_refs.append(obj(str(path.relative_to(ROOT)), 'PBXFileReference', lastKnownFileType=kind, path=str(path.relative_to(ROOT)), sourceTree='<group>'))

for relative, kind in [('../shared/artwork-catalog.json', 'text.json'), ('../shared/tmdb-logo.png', 'image.png')]:
    resource_refs.append(obj(relative, 'PBXFileReference', lastKnownFileType=kind, path=relative, sourceTree='<group>'))

product_group = obj('products', 'PBXGroup', children=[], name='Products', sourceTree='<group>')
main_group = obj('main', 'PBXGroup', children=source_refs + resource_refs + [product_group], sourceTree='<group>')
project_configs = []
for config in ['Debug', 'Release']:
    project_configs.append(obj('project-' + config, 'XCBuildConfiguration', name=config, buildSettings={
        'CLANG_ENABLE_MODULES': 'YES', 'CLANG_ENABLE_OBJC_ARC': 'YES', 'SWIFT_VERSION': '5.0',
        'SWIFT_STRICT_CONCURRENCY': 'targeted', 'ENABLE_USER_SCRIPT_SANDBOXING': 'YES',
        'SWIFT_OPTIMIZATION_LEVEL': '-Onone' if config == 'Debug' else '-O',
        'DEBUG_INFORMATION_FORMAT': 'dwarf' if config == 'Debug' else 'dwarf-with-dsym',
        'GCC_PREPROCESSOR_DEFINITIONS': ['$(inherited)', 'DEBUG=1'] if config == 'Debug' else ['$(inherited)'],
    }))
project_config_list = obj('project-config-list', 'XCConfigurationList', buildConfigurations=project_configs, defaultConfigurationIsVisible='0', defaultConfigurationName='Release')
targets = []
for platform in ['iOS', 'tvOS']:
    is_tv = platform == 'tvOS'
    name = 'KongwoTV-' + platform
    product = obj('product-' + platform, 'PBXFileReference', explicitFileType='wrapper.application', includeInIndex='0', path='幕里.app', sourceTree='BUILT_PRODUCTS_DIR')
    objects[product_group]['children'].append(product)
    asset_path = 'Resources/Assets-' + platform + '.xcassets'
    asset_ref = obj(asset_path, 'PBXFileReference', lastKnownFileType='folder.assetcatalog', path=asset_path, sourceTree='<group>')
    objects[main_group]['children'].append(asset_ref)
    source_builds = [obj(platform + '-src-' + ref, 'PBXBuildFile', fileRef=ref) for ref in source_refs]
    resource_builds = [obj(platform + '-res-' + ref, 'PBXBuildFile', fileRef=ref) for ref in resource_refs + [asset_ref]]
    phases = [
        obj(platform + '-sources', 'PBXSourcesBuildPhase', buildActionMask='2147483647', files=source_builds, runOnlyForDeploymentPostprocessing='0'),
        obj(platform + '-frameworks', 'PBXFrameworksBuildPhase', buildActionMask='2147483647', files=[], runOnlyForDeploymentPostprocessing='0'),
        obj(platform + '-resources', 'PBXResourcesBuildPhase', buildActionMask='2147483647', files=resource_builds, runOnlyForDeploymentPostprocessing='0'),
    ]
    configs = []
    for config in ['Debug', 'Release']:
        settings = {
            'PRODUCT_NAME': '幕里', 'PRODUCT_BUNDLE_IDENTIFIER': 'org.kongwotv.appletv' if is_tv else 'org.kongwotv.ios',
            'INFOPLIST_FILE': 'Config/' + platform + '-Info.plist', 'GENERATE_INFOPLIST_FILE': 'NO',
            'MARKETING_VERSION': '2.16.12', 'CURRENT_PROJECT_VERSION': '2161207',
            'SDKROOT': 'appletvos' if is_tv else 'iphoneos',
            'SUPPORTED_PLATFORMS': 'appletvos appletvsimulator' if is_tv else 'iphoneos iphonesimulator',
            'TARGETED_DEVICE_FAMILY': '3' if is_tv else '1,2',
            'TVOS_DEPLOYMENT_TARGET' if is_tv else 'IPHONEOS_DEPLOYMENT_TARGET': '17.0' if is_tv else '16.0',
            'ASSETCATALOG_COMPILER_APPICON_NAME': 'AppIcon',
            'ASSETCATALOG_COMPILER_GENERATE_SWIFT_ASSET_SYMBOL_EXTENSIONS': 'NO',
            'CODE_SIGN_STYLE': 'Automatic', 'SWIFT_EMIT_LOC_STRINGS': 'NO',
            'ENABLE_PREVIEWS': 'YES', 'LD_RUNPATH_SEARCH_PATHS': ['$(inherited)', '@executable_path/Frameworks'],
            'SUPPORTS_MACCATALYST': 'NO', 'SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD': 'NO',
        }
        if config == 'Debug': settings['SWIFT_ACTIVE_COMPILATION_CONDITIONS'] = 'DEBUG'
        configs.append(obj(platform + '-' + config, 'XCBuildConfiguration', name=config, buildSettings=settings))
    config_list = obj(platform + '-config-list', 'XCConfigurationList', buildConfigurations=configs, defaultConfigurationIsVisible='0', defaultConfigurationName='Release')
    target = obj('target-' + platform, 'PBXNativeTarget', buildConfigurationList=config_list, buildPhases=phases, buildRules=[], dependencies=[], name=name, productName='幕里', productReference=product, productType='com.apple.product-type.application')
    targets.append(target)
    info = {
        'CFBundleDevelopmentRegion': 'zh_CN', 'CFBundleDisplayName': '幕里', 'CFBundleName': '幕里',
        'CFBundleExecutable': '$(EXECUTABLE_NAME)', 'CFBundleIdentifier': '$(PRODUCT_BUNDLE_IDENTIFIER)',
        'CFBundleInfoDictionaryVersion': '6.0', 'CFBundlePackageType': 'APPL',
        'CFBundleShortVersionString': '$(MARKETING_VERSION)', 'CFBundleVersion': '$(CURRENT_PROJECT_VERSION)',
        'LSRequiresIPhoneOS': True, 'ITSAppUsesNonExemptEncryption': False,
        'NSAppTransportSecurity': {'NSAllowsArbitraryLoads': True, 'NSAllowsArbitraryLoadsForMedia': True},
        'UIBackgroundModes': ['audio'],
    }
    if not is_tv:
        info['UILaunchScreen'] = {}
        info['UIApplicationSceneManifest'] = {'UIApplicationSupportsMultipleScenes': True}
        info['UISupportedInterfaceOrientations'] = ['UIInterfaceOrientationPortrait', 'UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight']
        info['UISupportedInterfaceOrientations~ipad'] = ['UIInterfaceOrientationPortrait', 'UIInterfaceOrientationPortraitUpsideDown', 'UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight']
    (ROOT / 'Config' / (platform + '-Info.plist')).write_bytes(plistlib.dumps(info, sort_keys=False))
    scheme = ET.Element('Scheme', LastUpgradeVersion='2700', version='1.3')
    def reference(parent):
        ET.SubElement(parent, 'BuildableReference', BuildableIdentifier='primary', BlueprintIdentifier=target, BuildableName='幕里.app', BlueprintName=name, ReferencedContainer='container:KongwoTV.xcodeproj')
    build = ET.SubElement(scheme, 'BuildAction', parallelizeBuildables='YES', buildImplicitDependencies='YES')
    entries = ET.SubElement(build, 'BuildActionEntries')
    reference(ET.SubElement(entries, 'BuildActionEntry', buildForTesting='YES', buildForRunning='YES', buildForProfiling='YES', buildForArchiving='YES', buildForAnalyzing='YES'))
    launch = ET.SubElement(scheme, 'LaunchAction', buildConfiguration='Debug', selectedDebuggerIdentifier='Xcode.DebuggerFoundation.Debugger.LLDB', selectedLauncherIdentifier='Xcode.IDEFoundation.Launcher.LLDB', launchStyle='0', useCustomWorkingDirectory='NO', ignoresPersistentStateOnLaunch='NO', debugDocumentVersioning='YES', allowLocationSimulation='YES')
    reference(ET.SubElement(launch, 'BuildableProductRunnable', runnableDebuggingMode='0'))
    ET.SubElement(scheme, 'ArchiveAction', buildConfiguration='Release', revealArchiveInOrganizer='YES')
    ET.indent(scheme)
    schemes = PROJECT / 'xcshareddata' / 'xcschemes'
    schemes.mkdir(parents=True, exist_ok=True)
    (schemes / (name + '.xcscheme')).write_bytes(ET.tostring(scheme, encoding='utf-8', xml_declaration=True))

project = obj('project', 'PBXProject', attributes={'LastUpgradeCheck': '2700', 'BuildIndependentTargetsInParallel': 'YES'}, buildConfigurationList=project_config_list, compatibilityVersion='Xcode 14.0', developmentRegion='zh_CN', hasScannedForEncodings='0', knownRegions=['zh_CN', 'en', 'Base'], mainGroup=main_group, productRefGroup=product_group, projectDirPath='', projectRoot='', targets=targets)
text = '// !$*UTF8*$!\n{\n archiveVersion = 1;\n classes = {};\n objectVersion = 56;\n objects = {\n'
for ident, value in objects.items():
    text += f'  {ident} = {plist_value(value)};\n'
text += f' }};\n rootObject = {project};\n}}\n'
(PROJECT / 'project.pbxproj').write_text(text)
print('Generated KongwoTV.xcodeproj (iOS + tvOS), no external project generator required.')
