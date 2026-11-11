'use strict';

/**
 * 在 macOS 上创建「工资实时统计」启动器 App。
 *
 * 背景：未签名的 Electron 应用在部分 macOS 版本上无法通过 Finder / LaunchServices 启动，
 * 但从终端启动正常。这个脚本用系统自带的 osacompile 生成一个 AppleScript 启动器，
 * 由它直接调用 node_modules 里已由 Electron 官方签名的运行时，从而可以双击打开。
 *
 * 使用：
 *   npm run install:mac
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..');
const APP_NAME = '工资实时统计';
const LOG_FILE = '/tmp/salary-time.log';

function fail(message) {
  console.error('\n[安装失败] ' + message + '\n');
  process.exit(1);
}

function run(command, args) {
  return execFileSync(command, args, { stdio: 'pipe' }).toString();
}

function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

if (process.platform !== 'darwin') {
  fail('该脚本仅适用于 macOS。');
}

const electronBinary = require('electron');
if (typeof electronBinary !== 'string' || !fs.existsSync(electronBinary)) {
  fail('找不到 Electron 运行时，请先在项目目录执行 npm install。');
}

// require('electron') -> .../Electron.app/Contents/MacOS/Electron
const electronApp = path.resolve(path.dirname(electronBinary), '..', '..');
if (!fs.existsSync(electronApp)) {
  fail('找不到 Electron 应用包：' + electronApp);
}

const buildDir = path.join(os.tmpdir(), 'salary-time-launcher');
const sourceApp = path.join(buildDir, APP_NAME + '.app');
const iconsetDir = path.join(buildDir, 'SalaryTime.iconset');
fs.rmSync(buildDir, { recursive: true, force: true });
fs.mkdirSync(buildDir, { recursive: true });

// 1. AppleScript：通过 LaunchServices 启动 Electron 官方签名的运行时，并加载本项目。
//    直接执行未签名的应用包会被部分 macOS 版本拦截，而 Electron.app 本身带官方签名。
const command = [
  '/usr/bin/env -u ELECTRON_RUN_AS_NODE',
  '/usr/bin/open -n',
  '-a ' + shellQuote(electronApp),
  '--stdout ' + shellQuote(LOG_FILE),
  '--stderr ' + shellQuote(LOG_FILE),
  '--args ' + shellQuote(REPO)
].join(' ');

const script = 'do shell script ' + JSON.stringify(command);
run('osacompile', ['-o', sourceApp, '-e', script]);

// 2. 写入应用名称等信息
const plist = path.join(sourceApp, 'Contents', 'Info.plist');

function plistSet(key, type, value) {
  const base = '/usr/libexec/PlistBuddy';
  try {
    run(base, ['-c', `Set :${key} ${value}`, plist]);
  } catch (error) {
    run(base, ['-c', `Add :${key} ${type} ${value}`, plist]);
  }
}

plistSet('CFBundleDisplayName', 'string', APP_NAME);
plistSet('CFBundleName', 'string', APP_NAME);
plistSet('CFBundleIdentifier', 'string', 'com.currykernel.salarytime.launcher');
plistSet('CFBundleShortVersionString', 'string', '1.0.0');
plistSet('CFBundleIconFile', 'string', 'applet');
plistSet('LSUIElement', 'bool', 'true');

// 3. 生成并替换图标
const sourceIcon = path.join(REPO, 'build', 'icon.png');
if (fs.existsSync(sourceIcon)) {
  fs.mkdirSync(iconsetDir, { recursive: true });
  const sizes = [
    ['icon_16x16.png', 16],
    ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32],
    ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128],
    ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256],
    ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512],
    ['icon_512x512@2x.png', 1024]
  ];
  for (const [name, size] of sizes) {
    run('sips', ['-z', String(size), String(size), sourceIcon, '--out', path.join(iconsetDir, name)]);
  }
  const icns = path.join(buildDir, 'applet.icns');
  run('iconutil', ['-c', 'icns', iconsetDir, '-o', icns]);
  fs.copyFileSync(icns, path.join(sourceApp, 'Contents', 'Resources', 'applet.icns'));
}

// 4. 修改过资源后重新做 ad-hoc 签名
try {
  run('codesign', ['--force', '--deep', '--sign', '-', sourceApp]);
} catch (error) {
  console.warn('[提示] 启动器签名失败，但通常仍可运行：' + error.message);
}

// 5. 安装到 /Applications（不可写时退回到 ~/Applications）
const candidateDirs = [path.join('/', 'Applications'), path.join(os.homedir(), 'Applications')];
let installDir = null;
for (const dir of candidateDirs) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    installDir = dir;
    break;
  } catch (error) { /* 尝试下一个 */ }
}
if (!installDir) fail('没有可写入的应用程序目录。');

const targetApp = path.join(installDir, APP_NAME + '.app');
fs.rmSync(targetApp, { recursive: true, force: true });
run('ditto', [sourceApp, targetApp]);

console.log('\n✅ 已安装：' + targetApp);
console.log('   以后在「启动台」或 Spotlight 中搜索「' + APP_NAME + '」即可打开。');
console.log('   关闭时点悬浮窗右上角的 ×；运行日志：' + LOG_FILE + '\n');
