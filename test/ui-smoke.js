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
const calls = { saves: [], views: [], hidden: 0, quit: 0, updateOpened: '' };

ipcMain.handle('app:get-state', () => ({
  settings: savedSettings,
  version: '1.0.0',
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
ipcMain.handle('update:check', () => ({
  current: '1.0.0',
  latest: '1.1.0',
  url: 'https://github.com/CurryKernel/salary-time/releases/tag/v1.1.0',
  hasUpdate: true
}));
ipcMain.handle('update:open', (event, url) => { calls.updateOpened = url; return true; });

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

  // 初始状态：月末周六自动转调休，主界面可见
  let state = await run(`({
    mode: document.getElementById('modeChip').textContent,
    amount: document.getElementById('todayAmount').textContent,
    monthly: document.getElementById('monthAmount').textContent,
    netAmount: document.getElementById('netAmount').textContent,
    netSub: document.getElementById('netSub').textContent,
    weekRemoved: document.getElementById('weekAmount') === null,
    moneyActive: document.getElementById('moneyBtn').classList.contains('money-active'),
    settingsHidden: document.getElementById('settingsView').hidden
  })`);
  ok('默认显示本月调休 1 天', state.mode.includes('本月调休 1 天'), state.mode);
  ok('主界面默认可见', state.settingsHidden === true);
  ok('今日金额已渲染', /^[\d,]+\.\d{2}$/.test(state.amount), state.amount);
  ok('本月累计已渲染', /^¥[\d,]+\.\d{2}$/.test(state.monthly), state.monthly);
  ok('本月到手已渲染', /^¥[\d,]+\.\d{2}$/.test(state.netAmount), state.netAmount);
  ok('本周累计已移除', state.weekRemoved === true, state.netSub);
  ok('撒钱特效默认关闭', state.moneyActive === false);

  // 撒钱特效开关
  await run(`document.getElementById('moneyBtn').click()`);
  await sleep(400);
  state = await run(`({
    active: document.getElementById('moneyBtn').classList.contains('money-active'),
    rainActive: document.getElementById('moneyRain').dataset.active,
    hidden: document.getElementById('moneyRain').hidden,
    canvasWidth: document.getElementById('moneyCanvas').width
  })`);
  ok('开启撒钱特效并启动画布动画',
    state.active === true && state.rainActive === '1' && state.hidden === false &&
    state.canvasWidth > 0,
    state.active + ' / ' + state.rainActive + ' / ' + state.canvasWidth);
  ok('撒钱设置已持久化', calls.saves.some((p) => p.moneyEffect === true));
  await run(`document.getElementById('moneyBtn').click()`);
  await sleep(200);
  state = await run(`({
    active: document.getElementById('moneyBtn').classList.contains('money-active'),
    hidden: document.getElementById('moneyRain').hidden,
    rainActive: document.getElementById('moneyRain').dataset.active
  })`);
  ok('关闭撒钱特效并停止动画',
    state.active === false && state.hidden === true && state.rainActive === '0');

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
    version: document.getElementById('currentVersion').textContent,
    autoUpdate: document.getElementById('autoUpdateCheck').checked,
    rest1Start: document.getElementById('overtimeRest1Start').value,
    rest1End: document.getElementById('overtimeRest1End').value,
    rest2Start: document.getElementById('overtimeRest2Start').value,
    rest2End: document.getElementById('overtimeRest2End').value,
    partyDues: document.getElementById('partyDues').value
  })`);
  ok('点击齿轮打开设置页', state.settingsHidden === false && state.mainHidden === true);
  ok('通知主进程调整窗口高度', calls.views[calls.views.length - 1] === 'settings');
  ok('五险默认 10.5%、公积金默认 5%', state.social === '10.5' && state.housing === '5',
    state.social + ' / ' + state.housing);
  ok('五险一金默认合计 3,100', state.insurancePreview === '¥3,100.00', state.insurancePreview);
  ok('党费默认 0', state.partyDues === '0', state.partyDues);
  ok('个税默认税率 10%', state.taxRate === '10', state.taxRate);
  ok('显示当前版本且默认自动检查更新',
    state.version === 'v1.0.0' && state.autoUpdate === true,
    state.version + ' / ' + state.autoUpdate);
  ok('加班休息时段默认 12:00–13:30、18:00–18:30',
    state.rest1Start === '12:00' && state.rest1End === '13:30' &&
    state.rest2Start === '18:00' && state.rest2End === '18:30');

  // 月末周六自动转调休
  const now = new Date();
  const autoWorkdays = calc.countWeekdays(now.getFullYear(), now.getMonth());
  state = await run(`({
    mode: document.getElementById('modeChip').textContent,
    previewSaturday: document.getElementById('previewSaturday').textContent,
    previewComp: document.getElementById('previewComp').textContent,
    previewOvertime: document.getElementById('previewOvertime').textContent,
    previewNet: document.getElementById('previewNet').textContent
  })`);
  ok('月末周六自动转调休', state.mode.includes('本月调休 1 天'), state.mode);
  ok('预览月末周六显示 1 天调休', state.previewSaturday === '1 天', state.previewSaturday);
  ok('本月调休合计默认 1 天', state.previewComp === '1 天', state.previewComp);
  ok('默认周末加班金额为 0', state.previewOvertime === '¥0.00', state.previewOvertime);

  // 党费扣除
  const netBeforeParty = Number(state.previewNet.replace(/[¥,]/g, ''));
  await run(`(() => {
    const input = document.getElementById('partyDues');
    input.value = '200';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(700);
  state = await run(`({
    previewParty: document.getElementById('previewParty').textContent,
    previewNet: document.getElementById('previewNet').textContent
  })`);
  const netAfterParty = Number(state.previewNet.replace(/[¥,]/g, ''));
  ok('党费字段可填写并显示', state.previewParty === '¥200.00', state.previewParty);
  ok('党费从本月到手扣除', Math.abs((netBeforeParty - netAfterParty) - 200) < 0.01,
    netBeforeParty + ' -> ' + netAfterParty);
  ok('设置已持久化（党费）', calls.saves.some((p) => p.partyDues === 200));

  // 检查更新
  await run(`document.getElementById('updateCheckBtn').click()`);
  await sleep(400);
  state = await run(`({
    status: document.getElementById('updateStatus').textContent,
    button: document.getElementById('updateCheckBtn').textContent
  })`);
  ok('检查更新发现新版本',
    state.status.includes('1.1.0') && state.button.includes('去下载'), state.status + ' / ' + state.button);
  await run(`document.getElementById('updateCheckBtn').click()`);
  await sleep(200);
  ok('打开新版本 Release 页面', calls.updateOpened.includes('v1.1.0'), calls.updateOpened);

  await run(`(() => {
    const input = document.getElementById('autoUpdateCheck');
    input.checked = false;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await sleep(400);
  ok('可关闭每天自动检查更新',
    calls.saves.some((p) => p.autoUpdateCheck === false));

  // 主题与自定义背景
  state = await run(`({
    theme: document.getElementById('themeSelect').value,
    light: document.getElementById('widget').classList.contains('theme-light'),
    bgHidden: document.getElementById('customBg').hidden,
    opacityHidden: document.getElementById('bgOpacityRow').hidden
  })`);
  ok('默认深色主题且无自定义背景',
    state.theme === 'dark' && state.light === false && state.bgHidden === true &&
    state.opacityHidden === true);

  await run(`(() => {
    const select = document.getElementById('themeSelect');
    select.value = 'light';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await sleep(700);
  state = await run(`document.getElementById('widget').classList.contains('theme-light')`);
  ok('切换浅色主题', state === true);
  ok('主题设置已持久化', calls.saves.some((p) => p.theme === 'light'));

  await run(`(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ff0000';
    context.fillRect(0, 0, 8, 8);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const file = new File([blob], 'background.png', { type: 'image/png' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.getElementById('bgFileInput');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await sleep(1200);
  state = await run(`({
    bgHidden: document.getElementById('customBg').hidden,
    tintHidden: document.getElementById('bgTint').hidden,
    opacityHidden: document.getElementById('bgOpacityRow').hidden,
    hasImage: document.getElementById('customBg').style.backgroundImage.includes('data:image')
  })`);
  ok('上传自定义背景图',
    state.bgHidden === false && state.tintHidden === false &&
    state.opacityHidden === false && state.hasImage === true);
  ok('自定义背景已持久化',
    calls.saves.some((p) => typeof p.customBackground === 'string' &&
      p.customBackground.startsWith('data:image')));

  await run(`(() => {
    const range = document.getElementById('bgOpacity');
    range.value = '30';
    range.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(400);
  state = await run(`({
    opacity: document.getElementById('customBg').style.opacity,
    label: document.getElementById('bgOpacityValue').textContent
  })`);
  ok('背景透明度可调',
    state.opacity === '0.3' && state.label === '30%',
    state.opacity + ' / ' + state.label);
  ok('透明度设置已持久化', calls.saves.some((p) => p.backgroundOpacity === 0.3));

  await run(`document.getElementById('bgClearBtn').click()`);
  await sleep(300);
  state = await run(`({
    bgHidden: document.getElementById('customBg').hidden,
    opacityHidden: document.getElementById('bgOpacityRow').hidden
  })`);
  ok('清除自定义背景', state.bgHidden === true && state.opacityHidden === true);

  await run(`(() => {
    const select = document.getElementById('themeSelect');
    select.value = 'dark';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await sleep(300);

  // 本月兑换配额
  state = await run(`({
    conversion: document.getElementById('compConversionEnabled').value,
    hoursRowHidden: document.getElementById('compConversionHoursRow').hidden,
    previewRowHidden: document.getElementById('previewConversionRow').hidden
  })`);
  ok('默认不兑换调休配额',
    state.conversion === 'no' && state.hoursRowHidden === true && state.previewRowHidden === true);

  await run(`(() => {
    const select = document.getElementById('compConversionEnabled');
    select.value = 'yes';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await sleep(300);
  state = await run(`document.getElementById('compConversionHoursRow').hidden`);
  ok('选择兑换后显示小时数输入', state === false);

  await run(`(() => {
    const input = document.getElementById('compConversionHours');
    input.value = '2.5';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(700);
  const conversionPay = Math.round((2.5 * ((20000 / 21.75) * 2 / 8) + Number.EPSILON) * 100) / 100;
  state = await run(`({
    previewRowHidden: document.getElementById('previewConversionRow').hidden,
    label: document.getElementById('previewConversionLabel').textContent,
    amount: document.getElementById('previewConversion').textContent
  })`);
  ok('兑换配额显示在预览中',
    state.previewRowHidden === false && state.label.includes('2.5 小时'), state.label);
  ok('兑换金额按加班时薪计算',
    state.amount === '¥' + money(conversionPay), state.amount);
  ok('兑换配置已持久化',
    calls.saves.some((p) => p.compConversion &&
      p.compConversion.enabled === true && p.compConversion.hours === 2.5));

  // 关闭兑换，避免影响后续断言
  await run(`(() => {
    const select = document.getElementById('compConversionEnabled');
    select.value = 'no';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await sleep(700);
  state = await run(`({
    hidden: document.getElementById('compConversionHoursRow').hidden,
    previewHidden: document.getElementById('previewConversionRow').hidden
  })`);
  ok('关闭兑换后隐藏小时数输入', state.hidden === true && state.previewHidden === true);

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

  // 工资单页
  await run(`document.getElementById('payslipBtn').click()`);
  await sleep(250);
  state = await run(`({
    visible: document.getElementById('payslipView').hidden === false,
    mainHidden: document.getElementById('mainView').hidden,
    title: document.getElementById('headerTitle').textContent,
    month: document.getElementById('payslipMonth').value,
    hint: document.getElementById('payslipHint').textContent,
    net: document.getElementById('payslipNet').textContent
  })`);
  const currentMonthValue = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  ok('打开工资单页', state.visible === true && state.mainHidden === true && state.title === '工资单');
  ok('工资单默认当前月份', state.month === currentMonthValue && state.hint.includes('当月预计'), state.month);
  ok('工资单显示本月到手', /^¥[\d,]+\.\d{2}$/.test(state.net), state.net);

  const previousMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const previousMonthValue = previousMonthDate.getFullYear() + '-' +
    String(previousMonthDate.getMonth() + 1).padStart(2, '0');
  await run(`(() => {
    const input = document.getElementById('payslipMonth');
    input.value = '${previousMonthValue}';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await sleep(250);
  state = await run(`({
    hint: document.getElementById('payslipHint').textContent,
    net: document.getElementById('payslipNet').textContent
  })`);
  ok('工资单可切换历史月份',
    state.hint.includes(previousMonthDate.getFullYear() + '年' + (previousMonthDate.getMonth() + 1) + '月'),
    state.hint);
  ok('历史月份工资单已渲染', /^¥[\d,]+\.\d{2}$/.test(state.net), state.net);

  await run(`document.getElementById('payslipBackBtn').click()`);
  await sleep(200);
  state = await run(`({
    hidden: document.getElementById('payslipView').hidden,
    mainHidden: document.getElementById('mainView').hidden,
    title: document.getElementById('headerTitle').textContent
  })`);
  ok('工资单返回主界面',
    state.hidden === true && state.mainHidden === false && state.title === '工资实时统计');

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
  ok('未勾选转调休时加班金额计入本月预计预览',
    /^¥(?!0\.00$)[\d,]+\.\d{2}$/.test(state.previewOvertime) && state.previewLabel.includes('1 天'),
    state.previewOvertime + ' / ' + state.previewLabel);
  ok('加班日已持久化',
    calls.saves.some((p) => Array.isArray(p.overtimeDays) &&
      p.overtimeDays.length === 1 && p.overtimeDays[0].date === overtimeDate &&
      p.overtimeDays[0].workStart === '10:00' && p.overtimeDays[0].workEnd === '15:00' &&
      p.overtimeDays[0].compTime === false));

  // 加班切换为转调休
  await run(`(() => {
    const input = document.querySelector('#overtimeList .overtime-comp-check');
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await sleep(700);
  state = await run(`({
    previewOvertime: document.getElementById('previewOvertime').textContent,
    previewComp: document.getElementById('previewComp').textContent,
    previewLabel: document.getElementById('previewOvertimeLabel').textContent,
    checked: document.querySelector('#overtimeList .overtime-comp-check').checked
  })`);
  ok('加班可勾选转调休', state.checked === true);
  ok('转调休后不计加班费', state.previewOvertime === '¥0.00', state.previewOvertime);
  ok('转调休后本月调休变为 2 天', state.previewComp === '2 天', state.previewComp);
  ok('预览标注 1 天转调休', state.previewLabel.includes('1 天转调休'), state.previewLabel);
  ok('转调休状态已持久化',
    calls.saves.some((p) => Array.isArray(p.overtimeDays) &&
      p.overtimeDays.some((entry) => entry.date === overtimeDate && entry.compTime === true)));

  // 切回发工资
  await run(`(() => {
    const input = document.querySelector('#overtimeList .overtime-comp-check');
    input.checked = false;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await sleep(700);
  state = await run(`({
    previewOvertime: document.getElementById('previewOvertime').textContent,
    previewComp: document.getElementById('previewComp').textContent
  })`);
  ok('切回发工资后加班费恢复', /^¥(?!0\.00$)[\d,]+\.\d{2}$/.test(state.previewOvertime), state.previewOvertime);
  ok('切回发工资后本月调休恢复 1 天', state.previewComp === '1 天', state.previewComp);

  // 先删除刚才的加班，再用同一日期测试添加时直接勾选转调休
  await run(`document.querySelector('#overtimeList .overtime-remove').click()`);
  await sleep(700);

  await run(`(() => {
    const input = document.getElementById('overtimeDate');
    input.value = '${overtimeDate}';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('overtimeStart').value = '10:00';
    document.getElementById('overtimeEnd').value = '15:00';
    document.getElementById('overtimeComp').checked = true;
    document.getElementById('overtimeAddBtn').click();
  })()`);
  await sleep(700);
  state = await run(`({
    checked: document.querySelector('#overtimeList .overtime-comp-check') ? document.querySelector('#overtimeList .overtime-comp-check').checked : null,
    previewOvertime: document.getElementById('previewOvertime').textContent
  })`);
  ok('添加时勾选转调休', state.checked === true && state.previewOvertime === '¥0.00',
    state.checked + ' / ' + state.previewOvertime);

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
  ok('点击 × 仅关闭到后台，不退出进程', calls.hidden === 2 && calls.quit === 0);

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
    partyDues: document.getElementById('partyDues').value,
    conversion: document.getElementById('compConversionEnabled').value,
    conversionHidden: document.getElementById('compConversionHoursRow').hidden,
    theme: document.getElementById('themeSelect').value,
    bgHidden: document.getElementById('customBg').hidden,
    autoUpdate: document.getElementById('autoUpdateCheck').checked,
    insurancePreview: document.getElementById('insurancePreview').textContent
  })`);
  ok('恢复默认后基础工资为 20000', state.base === '20000', state.base);
  ok('恢复默认后月末周六自动转调休', state.mode.includes('本月调休 1 天'), state.mode);
  ok('恢复默认后固定月薪正确', state.previewFixed === '¥' + money(25000), state.previewFixed);
  ok('恢复默认后工作日日薪 = 月薪 ÷ 当月工作日',
    state.previewDaily === '¥' + money(25000 / autoWorkdays), state.previewDaily);
  ok('恢复默认后个税税率 10%', state.taxRate === '10', state.taxRate);
  ok('恢复默认后党费为 0', state.partyDues === '0', state.partyDues);
  ok('恢复默认后本月兑换配额为不兑换',
    state.conversion === 'no' && state.conversionHidden === true);
  ok('恢复默认后为深色主题且无背景',
    state.theme === 'dark' && state.bgHidden === true);
  ok('恢复默认后每天自动检查更新开启', state.autoUpdate === true);
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
