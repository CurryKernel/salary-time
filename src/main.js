'use strict';

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, shell, Notification } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync, spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { DEFAULT_SETTINGS } = require('./shared/defaults.js');

const WIDGET_SIZE = { width: 400, height: 322 };
const SETTINGS_VIEW_HEIGHT = 780;
const MAX_OVERTIME_DAYS = 120;
const OVERTIME_REST_DEFAULTS = [
  { start: '12:00', end: '13:30' },
  { start: '18:00', end: '18:30' }
];
const isMac = process.platform === 'darwin';

// 可用于截图 / 演示时隔离配置，不影响正式使用的数据
if (process.env.SALARY_USER_DATA) {
  app.setPath('userData', process.env.SALARY_USER_DATA);
}

let mainWindow = null;
let tray = null;
let settings = sanitizeSettings(DEFAULT_SETTINGS);
let isQuitting = false;
let persistTimer = null;
let moveTimer = null;
let appliedLoginItem = null;
let hideNoticeShown = false;

const debugLogPath = process.env.SALARY_DEBUG_LOG || '';
function debugLog(message) {
  if (!debugLogPath) return;
  try {
    fs.appendFileSync(debugLogPath, new Date().toISOString() + ' ' + message + '\n');
  } catch (error) { /* ignore */ }
}

function ensureWindowOnCursorDisplay() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const area = display.workArea;
  const bounds = mainWindow.getBounds();
  const intersects = bounds.x < area.x + area.width && bounds.x + bounds.width > area.x &&
    bounds.y < area.y + area.height && bounds.y + bounds.height > area.y;
  if (!intersects) {
    const x = area.x + area.width - bounds.width - 16;
    const y = area.y + area.height - bounds.height - 16;
    mainWindow.setBounds({ x, y, width: bounds.width, height: bounds.height });
    settings.windowBounds = { x, y };
    persistSettingsDebounced();
  }
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  ensureWindowOnCursorDisplay();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.moveTop();
  if (isMac && app.focus) {
    try { app.focus({ steal: true }); } catch (error) { /* ignore */ }
  }
}


app.setAppUserModelId('com.currykernel.salarytime');
debugLog('main loaded');

const hasSingleInstanceLock = app.requestSingleInstanceLock();
debugLog('single instance lock: ' + hasSingleInstanceLock);

if (!hasSingleInstanceLock) {
  debugLog('quitting: no single instance lock');
  app.quit();
} else {
  app.on('second-instance', showMainWindow);

  app.whenReady().then(() => {
    debugLog('app ready');
    settings = readSettings();
    registerIpc();
    createWindow();
    createTray();
    applySystemSettings();
    if (isMac && app.dock) app.dock.hide();
    maybeCapture();
    debugLog('startup complete');
  });
}

app.on('before-quit', () => {
  debugLog('before-quit');
  isQuitting = true;
  persistSettings();
});

app.on('will-quit', () => {
  debugLog('will-quit');
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});

app.on('activate', showMainWindow);

/* ------------------------------------------------------------------ */
/* 设置读写                                                             */
/* ------------------------------------------------------------------ */

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    return sanitizeSettings(raw);
  } catch (error) {
    return sanitizeSettings(DEFAULT_SETTINGS);
  }
}

function persistSettings() {
  clearTimeout(persistTimer);
  persistTimer = null;
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf8');
  } catch (error) {
    console.error('保存设置失败:', error);
  }
}

function persistSettingsDebounced() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persistSettings, 350);
}

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max, fallback) {
  const n = toNumber(value, fallback);
  return Math.min(max, Math.max(min, n));
}

function validTime(value, fallback) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || '')) ? String(value) : fallback;
}

function sanitizeSettings(input) {
  const source = Object.assign({}, DEFAULT_SETTINGS, input || {});
  const s = {};

  s.baseSalary = clamp(source.baseSalary, 0, 1e9, DEFAULT_SETTINGS.baseSalary);
  s.bonusSalary = clamp(source.bonusSalary, 0, 1e9, DEFAULT_SETTINGS.bonusSalary);

  s.workStart = validTime(source.workStart, DEFAULT_SETTINGS.workStart);
  s.workEnd = validTime(source.workEnd, DEFAULT_SETTINGS.workEnd);
  if (toSeconds(s.workEnd) <= toSeconds(s.workStart)) {
    s.workStart = DEFAULT_SETTINGS.workStart;
    s.workEnd = DEFAULT_SETTINGS.workEnd;
  }

  s.lunchStart = validTime(source.lunchStart, DEFAULT_SETTINGS.lunchStart);
  s.lunchEnd = validTime(source.lunchEnd, DEFAULT_SETTINGS.lunchEnd);
  if (toSeconds(s.lunchEnd) < toSeconds(s.lunchStart)) {
    const tmp = s.lunchStart;
    s.lunchStart = s.lunchEnd;
    s.lunchEnd = tmp;
  }
  s.overtimeDays = sanitizeOvertimeDays(source.overtimeDays, s.workStart, s.workEnd);
  s.overtimeRests = sanitizeOvertimeRests(source.overtimeRests);
  s.compConversion = sanitizeCompConversion(source.compConversion);
  s.insurance = sanitizeInsurance(source.insurance);
  s.tax = sanitizeTax(source.tax);
  s.partyDues = clamp(source.partyDues, 0, 1e9, 0);

  s.alwaysOnTop = source.alwaysOnTop !== false;
  s.moneyEffect = !!source.moneyEffect;
  s.theme = source.theme === 'light' ? 'light' : 'dark';
  s.customBackground = sanitizeBackground(source.customBackground);
  s.backgroundOpacity = clamp(source.backgroundOpacity, 0, 1, 0.55);
  s.autoUpdateCheck = source.autoUpdateCheck !== false;
  s.autoInstallUpdates = source.autoInstallUpdates !== false;
  s.openAtLogin = !!source.openAtLogin;

  const bounds = source.windowBounds;
  s.windowBounds = bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.y)
    ? { x: Math.round(bounds.x), y: Math.round(bounds.y) }
    : null;

  return s;
}

function toSeconds(value) {
  const parts = String(value || '').split(':');
  return Number(parts[0]) * 3600 + Number(parts[1]) * 60;
}

function isMonthEndSaturday(date) {
  if (date.getDay() !== 6) return false;
  const total = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  for (let day = total; day >= 1; day--) {
    const candidate = new Date(date.getFullYear(), date.getMonth(), day);
    if (candidate.getDay() === 6) return day === date.getDate();
  }
  return false;
}

/** 只保留合法的周末加班记录：真实存在的周六 / 周日、有效上下班时段，日期去重 */
function sanitizeOvertimeDays(list, fallbackStart, fallbackEnd) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const days = [];

  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(entry.date || '').trim());
    if (!match) continue;

    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    const date = new Date(year, month, day);
    if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) continue;
    if (date.getDay() !== 0 && date.getDay() !== 6) continue;
    // 月末周六自动转调休，不再保留为手动加班记录
    if (isMonthEndSaturday(date)) continue;

    const key = date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
    if (seen.has(key)) continue;

    const workStart = validTime(entry.workStart, '');
    const workEnd = validTime(entry.workEnd, '');
    let start = workStart;
    let end = workEnd;
    if (!workStart && !workEnd) {
      // 旧数据没有上下班时间，退回全局上下班时间
      start = fallbackStart;
      end = fallbackEnd;
    } else if (!workStart || !workEnd || toSeconds(workEnd) <= toSeconds(workStart)) {
      continue;
    }

    seen.add(key);
    days.push({ date: key, workStart: start, workEnd: end, compTime: !!entry.compTime });
    if (days.length >= MAX_OVERTIME_DAYS) break;
  }

  days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return days;
}

function compareVersions(a, b) {
  const parse = (value) => String(value || '').split('.').map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const l = left[index] || 0;
    const r = right[index] || 0;
    if (l !== r) return l - r;
  }
  return 0;
}

const GITHUB_RELEASE_API = 'https://api.github.com/repos/CurryKernel/salary-time';

async function fetchLatestRelease() {
  const response = await fetch(GITHUB_RELEASE_API + '/releases/latest', {
    headers: {
      'User-Agent': 'salary-time',
      'Accept': 'application/vnd.github+json'
    },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error('GitHub HTTP ' + response.status);
  return response.json();
}

async function downloadFile(url, destination) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'salary-time' },
    redirect: 'follow',
    signal: AbortSignal.timeout(300000)
  });
  if (!response.ok || !response.body) {
    throw new Error('下载失败 HTTP ' + response.status);
  }
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destination));
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function checksumFor(text, fileName) {
  for (const line of String(text || '').split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2 && parts[parts.length - 1] === fileName) {
      return parts[0].toLowerCase();
    }
  }
  return '';
}

async function installWindowsUpdate() {
  const release = await fetchLatestRelease();
  const version = String(release.tag_name || '').replace(/^v/, '');
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const portableTarget = process.env.PORTABLE_EXECUTABLE_FILE || '';
  const expectedName = portableTarget
    ? 'SalaryTime-Portable-' + version + '.exe'
    : 'SalaryTime-Setup-' + version + '.exe';
  const asset = assets.find((item) => item.name === expectedName) ||
    assets.find((item) => portableTarget
      ? /^SalaryTime-Portable-.*\.exe$/i.test(item.name)
      : /^SalaryTime-Setup-.*\.exe$/i.test(item.name));
  if (!asset) return { error: '发布包中找不到对应的 Windows 安装包' };

  const checksumAsset = assets.find((item) => /^SHA256SUMS-.*\.txt$/i.test(item.name));
  if (!checksumAsset) return { error: '发布包中找不到校验和文件' };

  const checksumResponse = await fetch(checksumAsset.browser_download_url, {
    headers: { 'User-Agent': 'salary-time' },
    signal: AbortSignal.timeout(30000)
  });
  if (!checksumResponse.ok) throw new Error('校验和下载失败 HTTP ' + checksumResponse.status);
  const expected = checksumFor(await checksumResponse.text(), asset.name);
  if (!expected) return { error: '校验和文件中找不到安装包记录' };

  const tempDir = path.join(os.tmpdir(), 'salary-time-update');
  const downloaded = path.join(tempDir, asset.name);
  await downloadFile(asset.browser_download_url, downloaded);
  const actual = await sha256File(downloaded);
  if (actual !== expected) {
    try { fs.unlinkSync(downloaded); } catch (error) { /* ignore */ }
    return { error: '安装包 SHA-256 校验失败，已取消更新' };
  }

  const targetExe = portableTarget || process.execPath;
  const installDir = portableTarget ? '' : path.dirname(process.execPath);
  const helper = path.join(tempDir, 'install-update.cmd');
  const lines = [
    '@echo off',
    'ping 127.0.0.1 -n 4 >nul'
  ];
  if (portableTarget) {
    lines.push('copy /Y "' + downloaded + '" "' + targetExe + '" >nul');
    lines.push('start "" "' + targetExe + '"');
  } else {
    // NSIS 静默安装；/D 必须是最后一个参数，路径不加引号
    lines.push('start "" /wait "' + downloaded + '" /S /D=' + installDir);
    lines.push('start "" "' + targetExe + '"');
  }
  lines.push('del "%~f0"');
  fs.writeFileSync(helper, lines.join('\r\n'), 'utf8');

  const child = spawn('cmd.exe', ['/c', helper], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();
  setTimeout(() => {
    isQuitting = true;
    app.quit();
  }, 800);
  return { ok: true, version };
}

async function installSourceUpdate() {
  const repo = path.resolve(__dirname, '..');
  const git = (args) => execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    timeout: 120000
  }).trim();

  try {
    if (git(['status', '--porcelain'])) {
      return { error: '本地有未提交修改，已跳过自动更新' };
    }
    git(['fetch', 'origin', '--quiet']);
    const behind = Number(git(['rev-list', '--count', 'HEAD..origin/main']));
    if (!behind || behind <= 0) return { error: '当前源码已是最新' };
    git(['pull', '--ff-only', 'origin', 'main']);
  } catch (error) {
    return { error: '源码更新失败：' + (error && error.message ? error.message : 'git error') };
  }

  setTimeout(() => {
    app.relaunch();
    app.exit(0);
  }, 600);
  return { ok: true, source: true };
}

function sanitizeBackground(value) {
  if (typeof value !== 'string') return '';
  if (!/^data:image\//.test(value)) return '';
  if (value.length > 4 * 1024 * 1024) return '';
  return value;
}

function sanitizeCompConversion(input) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    enabled: !!source.enabled,
    hours: clamp(source.hours, 0, 1000, 0)
  };
}

function sanitizeOvertimeRest(entry, fallback) {
  const source = entry && typeof entry === 'object' ? entry : {};
  let start = validTime(source.start, fallback.start);
  let end = validTime(source.end, fallback.end);
  if (toSeconds(end) < toSeconds(start)) {
    const tmp = start;
    start = end;
    end = tmp;
  }
  return { start, end };
}

function sanitizeOvertimeRests(list) {
  const source = Array.isArray(list) ? list : [];
  return OVERTIME_REST_DEFAULTS.map((fallback, index) =>
    sanitizeOvertimeRest(source[index], fallback));
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function sanitizeInsuranceItem(item, defaultRatio) {
  const source = item && typeof item === 'object' ? item : {};
  return {
    enabled: source.enabled !== false,
    mode: source.mode === 'fixed' ? 'fixed' : 'ratio',
    ratio: clamp(source.ratio, 0, 100, defaultRatio),
    amount: clamp(source.amount, 0, 1e9, 0)
  };
}

function sanitizeInsurance(input) {
  const source = input && typeof input === 'object' ? input : {};
  const base = source.base == null || source.base === ''
    ? null
    : clamp(source.base, 0, 1e9, 0);
  return {
    base,
    social: sanitizeInsuranceItem(source.social, 10.5),
    housingFund: sanitizeInsuranceItem(source.housingFund, 5)
  };
}

function sanitizeTax(input) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    rate: clamp(source.rate, 0, 100, 10),
    monthlyReduction: clamp(source.monthlyReduction, 0, 1e9, 0)
  };
}

/* ------------------------------------------------------------------ */
/* 窗口                                                                 */
/* ------------------------------------------------------------------ */

function assetPath(name) {
  return app.isPackaged
    ? path.join(process.resourcesPath, name)
    : path.join(__dirname, '..', 'build', name);
}

function initialBounds() {
  const saved = settings.windowBounds;

  if (saved) {
    const rect = { x: saved.x, y: saved.y, width: WIDGET_SIZE.width, height: WIDGET_SIZE.height };
    const display = screen.getDisplayMatching(rect);
    const wa = display.workArea;
    const intersects = saved.x + WIDGET_SIZE.width > wa.x && saved.x < wa.x + wa.width &&
      saved.y + WIDGET_SIZE.height > wa.y && saved.y < wa.y + wa.height;
    if (intersects) {
      return {
        x: Math.max(wa.x, Math.min(saved.x, wa.x + wa.width - WIDGET_SIZE.width)),
        y: Math.max(wa.y, Math.min(saved.y, wa.y + wa.height - WIDGET_SIZE.height)),
        ...WIDGET_SIZE
      };
    }
  }

  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: area.x + area.width - WIDGET_SIZE.width - 16,
    y: area.y + area.height - WIDGET_SIZE.height - 16,
    ...WIDGET_SIZE
  };
}

function createWindow() {
  const bounds = initialBounds();

  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 360,
    minHeight: 300,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: settings.alwaysOnTop,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    title: '工资实时统计',
    icon: assetPath('icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

  mainWindow.once('ready-to-show', () => {
    debugLog('ready-to-show');
    ensureWindowOnCursorDisplay();
    mainWindow.show();
    if (settings.alwaysOnTop) mainWindow.setAlwaysOnTop(true, 'floating');
  });

  mainWindow.on('move', () => {
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      const b = mainWindow.getBounds();
      settings.windowBounds = { x: b.x, y: b.y + b.height - WIDGET_SIZE.height };
      persistSettingsDebounced();
    }, 400);
  });

  // 点“关闭”时收进托盘，而不是退出应用
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (isMac) {
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
}

function applySystemSettings() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setAlwaysOnTop(!!settings.alwaysOnTop, 'floating');
  }
  if (app.isPackaged) {
    const want = !!settings.openAtLogin;
    // 首次启动时只在需要开启自启时写入系统，避免无意义的权限请求
    const shouldApply = appliedLoginItem === null ? want : appliedLoginItem !== want;
    if (shouldApply) {
      try {
        app.setLoginItemSettings({ openAtLogin: want });
      } catch (error) {
        console.error('设置开机自启失败:', error);
      }
    }
    appliedLoginItem = want;
  }
  rebuildTrayMenu();
}

function setView(view) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const targetHeight = view === 'settings' ? SETTINGS_VIEW_HEIGHT : WIDGET_SIZE.height;
  const current = mainWindow.getBounds();
  const area = screen.getDisplayMatching(current).workArea;
  const height = Math.min(targetHeight, area.height - 24);
  let y = current.y + current.height - height;
  y = Math.max(area.y + 8, Math.min(y, area.y + area.height - height - 8));
  mainWindow.setBounds({ x: current.x, y, width: current.width, height }, true);
}

/* ------------------------------------------------------------------ */
/* 托盘                                                                 */
/* ------------------------------------------------------------------ */

function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function createTray() {
  let image = nativeImage.createFromPath(assetPath('tray.png'));
  if (image.isEmpty()) {
    image = nativeImage.createFromPath(assetPath('icon.png'));
  }
  if (isMac) image = image.resize({ width: 18, height: 18 });

  tray = new Tray(image);
  tray.setToolTip('工资实时统计');
  rebuildTrayMenu();
  tray.on('click', toggleWindow);
  tray.on('double-click', () => {
    if (!mainWindow) return;
    mainWindow.show();
    mainWindow.focus();
  });
}

function rebuildTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    {
      label: '显示 / 隐藏悬浮窗',
      click: toggleWindow
    },
    {
      label: '始终置顶',
      type: 'checkbox',
      checked: !!settings.alwaysOnTop,
      click: (item) => {
        settings.alwaysOnTop = item.checked;
        applySystemSettings();
        persistSettingsDebounced();
        notifySettingsUpdated();
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
  tray.setContextMenu(menu);
}

function notifySettingsUpdated() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('settings:updated', settings);
  }
}

/* ------------------------------------------------------------------ */
/* IPC                                                                  */
/* ------------------------------------------------------------------ */

function registerIpc() {
  ipcMain.handle('app:get-state', () => ({
    settings,
    version: app.getVersion(),
    platform: process.platform,
    packaged: app.isPackaged
  }));

  ipcMain.handle('settings:save', (event, patch) => {
    if (!patch || typeof patch !== 'object') return settings;
    const merged = Object.assign({}, settings, patch, { windowBounds: settings.windowBounds });
    settings = sanitizeSettings(merged);
    applySystemSettings();
    persistSettingsDebounced();
    return settings;
  });

  ipcMain.handle('settings:reset', () => {
    settings = sanitizeSettings(Object.assign({}, DEFAULT_SETTINGS, {
      windowBounds: settings.windowBounds
    }));
    applySystemSettings();
    persistSettingsDebounced();
    return settings;
  });

  ipcMain.handle('update:check', async () => {
    const current = app.getVersion();
    try {
      const data = await fetchLatestRelease();
      const latest = String(data.tag_name || '').replace(/^v/, '');
      return {
        current,
        latest,
        url: data.html_url || '',
        hasUpdate: compareVersions(latest, current) > 0
      };
    } catch (error) {
      return { current, error: error && error.message ? error.message : 'network error' };
    }
  });

  ipcMain.handle('update:install', async () => {
    try {
      if (process.platform === 'win32' && app.isPackaged) {
        return await installWindowsUpdate();
      }
      if (process.platform === 'darwin' && !app.isPackaged) {
        return await installSourceUpdate();
      }
      return { error: '当前安装方式不支持静默更新，请手动下载安装包' };
    } catch (error) {
      console.error('静默更新失败:', error);
      return { error: error && error.message ? error.message : '更新失败' };
    }
  });

  ipcMain.handle('update:open', (event, url) => {
    if (typeof url === 'string' && /^https:\/\//.test(url)) {
      shell.openExternal(url).catch(() => {});
      return true;
    }
    return false;
  });

  ipcMain.on('window:set-view', (event, view) => setView(view === 'widget' ? 'widget' : 'settings'));
  ipcMain.on('window:hide', () => {
    if (!mainWindow) return;
    mainWindow.hide();
    if (process.platform === 'win32' && tray && !hideNoticeShown) {
      hideNoticeShown = true;
      try {
        tray.displayBalloon({
          title: '工资实时统计',
          content: '已隐藏到系统托盘，单击托盘图标即可重新显示。'
        });
      } catch (error) {
        // 部分 Windows 环境不支持气泡提示，忽略即可
      }
    }
    if (process.platform === 'darwin' && !hideNoticeShown) {
      hideNoticeShown = true;
      try {
        new Notification({
          title: '工资实时统计',
          body: '已隐藏到菜单栏，点击菜单栏的 ¥ 图标或重新打开启动器即可恢复。'
        }).show();
      } catch (error) {
        // 未签名的开发版本可能不显示通知，忽略即可
      }
    }
  });
  ipcMain.on('window:quit', () => { isQuitting = true; app.quit(); });
}

/* ------------------------------------------------------------------ */
/* 截图（仅用于自动化验证）                                               */
/* ------------------------------------------------------------------ */

function maybeCapture() {
  const capturePath = process.env.SALARY_CAPTURE;
  if (!capturePath || !mainWindow) return;
  const view = process.env.SALARY_CAPTURE_VIEW || 'widget';

  mainWindow.webContents.once('did-finish-load', () => {
    if (view !== 'widget') {
      setTimeout(() => {
        if (mainWindow) mainWindow.webContents.send('debug:view', view);
      }, 500);
    }
    setTimeout(async () => {
      try {
        if (process.env.SALARY_DUMP_LAYOUT) {
          const layout = await mainWindow.webContents.executeJavaScript(`(() => {
            const rect = (selector) => {
              const node = document.querySelector(selector);
              if (!node) return null;
              const r = node.getBoundingClientRect();
              return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) };
            };
            const scroller = document.querySelector('.settings-scroll');
            return JSON.stringify({
              inner: [window.innerWidth, window.innerHeight],
              main: rect('.main-view'),
              hero: rect('.hero'),
              cards: rect('.cards'),
              footer: rect('.footer'),
              settingsScroll: rect('.settings-scroll'),
              settingsScrollHeight: scroller ? [scroller.clientHeight, scroller.scrollHeight] : null
            });
          })()`);
          console.log('layout:', layout);
        }
        const image = await mainWindow.webContents.capturePage();
        fs.mkdirSync(path.dirname(capturePath), { recursive: true });
        fs.writeFileSync(capturePath, image.toPNG());
        console.log('captured:', capturePath);
      } catch (error) {
        console.error('截图失败:', error);
      }
      isQuitting = true;
      app.quit();
    }, 1800);
  });
}
