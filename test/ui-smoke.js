'use strict';

/**
 * 渲染层冒烟测试（在 Electron 中运行）：
 *   npx electron test/ui-smoke.js
 *
 * 不加载主进程 main.js，只加载页面并注入 IPC 桩，
 * 验证设置面板、实际工作日切换、输入联动与视图切换。
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const { DEFAULT_SETTINGS } = require('../src/shared/defaults.js');
const calc = require('../src/shared/calc.js');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'salary-time-test-')));

let savedSettings = Object.assign({}, DEFAULT_SETTINGS);
const calls = { saves: [], views: [], hidden: 0, quit: 0 };

ipcMain.handle('app:get-state', () => ({
  settings: savedSettings,
  version: 'test',
  platform: process.platform,
  packaged: false
}));

ipcMain.handle('settings:save', (event, patch) => {
  calls.saves.push(patch);
  savedSettings = Object.assign({}, savedSettings, patch);
  return savedSettings;
});

ipcMain.handle('settings:reset', () => {
  savedSettings = Object.assign({}, DEFAULT_SETTINGS);
  return savedSettings;
});

ipcMain.on('window:set-view', (event, view) => calls.views.push(view));
ipcMain.on('window:hide', () => { calls.hidden += 1; });
ipcMain.on('window:quit', () => { calls.quit += 1; });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function money(value) {
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

const results = [];
function ok(name, condition, detail) {
  if (!condition) throw new Error('断言失败：' + name + (detail ? ' — ' + detail : ''));
  results.push(name);
  console.log('  ✔ ' + name);
}

async function main() {
  const window = new BrowserWindow({
    width: 400,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });

  await window.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await sleep(300);

  const run = (script) => window.webContents.executeJavaScript(script);

  // 初始状态：默认 21.75 天，主界面可见
  let state = await run(`({
    mode: document.getElementById('modeChip').textContent,
    amount: document.getElementById('todayAmount').textContent,
    monthly: document.getElementById('monthAmount').textContent,
    netAmount: document.getElementById('netAmount').textContent,
    netSub: document.getElementById('netSub').textContent,
    weekRemoved: document.getElementById('weekAmount') === null,
    settingsHidden: document.getElementById('settingsView').hidden
  })`);
  ok('默认按 21.75 天计薪', state.mode.includes('21.75'), state.mode);
  ok('主界面默认可见', state.settingsHidden === true);
  ok('今日金额已渲染', /^[\d,]+\.\d{2}$/.test(state.amount), state.amount);
  ok('本月累计已渲染', /^¥[\d,]+\.\d{2}$/.test(state.monthly), state.monthly);
  ok('本月到手已渲染', /^¥[\d,]+\.\d{2}$/.test(state.netAmount), state.netAmount);
  ok('本周累计已移除', state.weekRemoved === true, state.netSub);

  // 打开设置
  await run(`document.getElementById('settingsBtn').click()`);
  await sleep(200);
  state = await run(`({
    settingsHidden: document.getElementById('settingsView').hidden,
    mainHidden: document.getElementById('mainView').hidden,
    social: document.getElementById('socialValue').value,
    housing: document.getElementById('housingFundValue').value,
    taxRate: document.getElementById('taxRate').value,
    insurancePreview: document.getElementById('insurancePreview').textContent,
    rest1Start: document.getElementById('overtimeRest1Start').value,
    rest1End: document.getElementById('overtimeRest1End').value,
    rest2Start: document.getElementById('overtimeRest2Start').value,
    rest2End: document.getElementById('overtimeRest2End').value
  })`);
  ok('点击齿轮打开设置页', state.settingsHidden === false && state.mainHidden === true);
  ok('通知主进程调整窗口高度', calls.views[calls.views.length - 1] === 'settings');
  ok('五险默认 10.5%、公积金默认 5%', state.social === '10.5' && state.housing === '5',
    state.social + ' / ' + state.housing);
  ok('五险一金默认合计 3,100', state.insurancePreview === '¥3,100.00', state.insurancePreview);
  ok('个税默认税率 10%', state.taxRate === '10', state.taxRate);
  ok('加班休息时段默认 12:00–13:30、18:00–18:30',
    state.rest1Start === '12:00' && state.rest1End === '13:30' &&
    state.rest2Start === '18:00' && state.rest2End === '18:30');

  // 加班折算固定按 21.75
  const now = new Date();
  const autoWorkdays = calc.countWeekdays(now.getFullYear(), now.getMonth());
  state = await run(`({
    mode: document.getElementById('modeChip').textContent,
    previewSaturday: document.getElementById('previewSaturday').textContent
  })`);
  ok('加班固定按 21.75 天折算', state.mode.includes('21.75'), state.mode);
  ok('预览月末周六按 21.75 折算',
    state.previewSaturday === '¥' + money((20000 / 21.75) * 2), state.previewSaturday);

  // 修改基础工资
  await run(`(() => {
    const input = document.getElementById('baseSalary');
    input.value = '30000';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(700);
  state = await run(`({
    previewDaily: document.getElementById('previewDaily').textContent,
    monthly: document.getElementById('monthAmount').textContent
  })`);
  const expectedAfterRaise = money((30000 + 5000) / autoWorkdays);
  ok('修改基础工资后预览联动', state.previewDaily === '¥' + expectedAfterRaise, state.previewDaily);
  ok('修改基础工资后主界面联动', /^¥[\d,]+\.\d{2}$/.test(state.monthly));
  ok('设置已持久化（baseSalary）', calls.saves.some((p) => p.baseSalary === 30000));

  // 完成返回主界面
  await run(`document.getElementById('doneBtn').click()`);
  await sleep(200);
  state = await run(`({
    settingsHidden: document.getElementById('settingsView').hidden,
    mainHidden: document.getElementById('mainView').hidden
  })`);
  ok('点击完成返回主界面', state.settingsHidden === true && state.mainHidden === false);
  ok('通知主进程恢复窗口高度', calls.views[calls.views.length - 1] === 'widget');

  // Esc 关闭设置
  await run(`document.getElementById('settingsBtn').click()`);
  await sleep(150);
  await run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await sleep(150);
  state = await run(`document.getElementById('settingsView').hidden`);
  ok('Esc 关闭设置页', state === true);

  // 周末加班：添加与删除
  const today = new Date();
  const lastSaturday = calc.lastSaturdayOfMonth(today.getFullYear(), today.getMonth());
  let overtimeDate = null;
  for (let d = 1; d <= calc.daysInMonth(today.getFullYear(), today.getMonth()); d++) {
    const date = new Date(today.getFullYear(), today.getMonth(), d);
    const weekday = date.getDay();
    if (weekday !== 0 && weekday !== 6) continue;
    if (weekday === 6 && d === lastSaturday) continue;
    overtimeDate = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') +
      '-' + String(d).padStart(2, '0');
    break;
  }

  await run(`(() => {
    const input = document.getElementById('overtimeDate');
    input.value = '${overtimeDate}';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('overtimeStart').value = '10:00';
    document.getElementById('overtimeEnd').value = '15:00';
    document.getElementById('overtimeAddBtn').click();
  })()`);
  await sleep(700);
  state = await run(`({
    count: document.querySelectorAll('#overtimeList .overtime-item').length,
    text: document.getElementById('overtimeList').textContent,
    previewOvertime: document.getElementById('previewOvertime').textContent,
    previewLabel: document.getElementById('previewOvertimeLabel').textContent
  })`);
  ok('添加周末加班日', state.count === 1, state.text);
  ok('加班金额计入本月预计预览',
    /^¥(?!0\.00$)[\d,]+\.\d{2}$/.test(state.previewOvertime) && state.previewLabel.includes('1 天'),
    state.previewOvertime + ' / ' + state.previewLabel);
  ok('加班日已持久化',
    calls.saves.some((p) => Array.isArray(p.overtimeDays) &&
      p.overtimeDays.length === 1 && p.overtimeDays[0].date === overtimeDate &&
      p.overtimeDays[0].workStart === '10:00' && p.overtimeDays[0].workEnd === '15:00'));

  await run(`document.querySelector('#overtimeList .overtime-remove').click()`);
  await sleep(700);
  state = await run(`document.querySelectorAll('#overtimeList .overtime-item').length`);
  ok('删除周末加班日', state === 0);

  // 时间输入：中间值不能立即回退（否则小时位无法输入第二位数字）
  await run(`(() => {
    const input = document.getElementById('workEnd');
    input.value = '01:00';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await sleep(150);
  state = await run(`document.getElementById('workEnd').value`);
  ok('下班时间的小时中间值不会被立即回退', state === '01:00', state);
  ok('非法中间值不会写入设置', !calls.saves.some((p) => p.workEnd === '01:00'));

  await run(`document.getElementById('workEnd').dispatchEvent(new Event('blur', { bubbles: true }))`);
  await sleep(150);
  state = await run(`document.getElementById('workEnd').value`);
  ok('失焦后非法时间恢复原值', state === '18:00', state);

  await run(`(() => {
    const input = document.getElementById('workEnd');
    input.value = '17:30';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await sleep(700);
  state = await run(`document.getElementById('workEnd').value`);
  ok('合法的下班时间可以正常保存', state === '17:30' && calls.saves.some((p) => p.workEnd === '17:30'), state);

  // 隐藏与退出按钮
  await run(`document.getElementById('hideBtn').click()`);
  await sleep(120);
  ok('点击减号隐藏到托盘', calls.hidden === 1);

  await run(`document.getElementById('quitBtn').click()`);
  await sleep(120);
  ok('点击 × 退出应用', calls.quit === 1);

  // 恢复默认
  await run(`document.getElementById('settingsBtn').click()`);
  await sleep(150);
  await run(`document.getElementById('resetBtn').click()`);
  await sleep(300);
  state = await run(`({
    base: document.getElementById('baseSalary').value,
    mode: document.getElementById('modeChip').textContent,
    previewFixed: document.getElementById('previewFixed').textContent,
    previewDaily: document.getElementById('previewDaily').textContent,
    taxRate: document.getElementById('taxRate').value,
    insurancePreview: document.getElementById('insurancePreview').textContent
  })`);
  ok('恢复默认后基础工资为 20000', state.base === '20000', state.base);
  ok('恢复默认后按 21.75 天折算加班', state.mode.includes('21.75'), state.mode);
  ok('恢复默认后固定月薪正确', state.previewFixed === '¥' + money(25000), state.previewFixed);
  ok('恢复默认后工作日日薪 = 月薪 ÷ 当月工作日',
    state.previewDaily === '¥' + money(25000 / autoWorkdays), state.previewDaily);
  ok('恢复默认后个税税率 10%', state.taxRate === '10', state.taxRate);
  ok('恢复默认后五险一金合计 3,100', state.insurancePreview === '¥3,100.00', state.insurancePreview);

  window.destroy();
  console.log('\nUI 冒烟测试通过：' + results.length + ' 项断言');
  app.exit(0);
}

const timeout = setTimeout(() => {
  console.error('UI 冒烟测试超时');
  app.exit(1);
}, 20000);
timeout.unref();

app.whenReady().then(() => {
  main().catch((error) => {
    console.error('\nUI 冒烟测试失败：');
    console.error(error && error.stack ? error.stack : error);
    app.exit(1);
  });
});
