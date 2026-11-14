'use strict';

(function () {
  const Calc = window.SalaryCalc;
  const Defaults = window.SalaryDefaults;

  const $ = (id) => document.getElementById(id);

  const ui = {
    widget: $('widget'),
    headerTitle: $('headerTitle'),
    mainView: $('mainView'),
    settingsView: $('settingsView'),
    dateLabel: $('dateLabel'),
    dayBadge: $('dayBadge'),
    todayAmount: $('todayAmount'),
    statusText: $('statusText'),
    pulse: $('pulse'),
    dayBar: $('dayBar'),
    dayPercent: $('dayPercent'),
    dayRange: $('dayRange'),
    monthTag: $('monthTag'),
    monthAmount: $('monthAmount'),
    monthSub: $('monthSub'),
    monthBar: $('monthBar'),
    weekTag: $('weekTag'),
    weekAmount: $('weekAmount'),
    weekSub: $('weekSub'),
    weekBar: $('weekBar'),
    rateInfo: $('rateInfo'),
    modeChip: $('modeChip'),
    pinBtn: $('pinBtn'),
    settingsBtn: $('settingsBtn'),
    hideBtn: $('hideBtn'),
    quitBtn: $('quitBtn'),
    doneBtn: $('doneBtn'),
    resetBtn: $('resetBtn'),
    baseSalary: $('baseSalary'),
    bonusSalary: $('bonusSalary'),
    standardWorkdays: $('standardWorkdays'),
    useActualWorkdays: $('useActualWorkdays'),
    actualWorkdaysBox: $('actualWorkdaysBox'),
    actualWorkdaysOverride: $('actualWorkdaysOverride'),
    autoWorkdaysHint: $('autoWorkdaysHint'),
    standardWorkdaysRow: $('standardWorkdaysRow'),
    workStart: $('workStart'),
    workEnd: $('workEnd'),
    lunchStart: $('lunchStart'),
    lunchEnd: $('lunchEnd'),
    overtimeDate: $('overtimeDate'),
    overtimeStart: $('overtimeStart'),
    overtimeEnd: $('overtimeEnd'),
    overtimeAddBtn: $('overtimeAddBtn'),
    overtimeList: $('overtimeList'),
    overtimeError: $('overtimeError'),
    alwaysOnTop: $('alwaysOnTop'),
    openAtLogin: $('openAtLogin'),
    openAtLoginRow: $('openAtLoginRow'),
    previewDaily: $('previewDaily'),
    previewDailyLabel: $('previewDailyLabel'),
    previewFixed: $('previewFixed'),
    previewSaturday: $('previewSaturday'),
    previewOvertimeLabel: $('previewOvertimeLabel'),
    previewOvertime: $('previewOvertime'),
    previewMonth: $('previewMonth'),
    previewNote: $('previewNote')
  };

  const moneyFormatter = new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  let settings = Object.assign({}, Defaults.DEFAULT_SETTINGS);
  let computed = null;
  let packaged = false;
  let view = 'widget';

  let pendingPatch = {};
  let pendingRefresh = false;
  let settingsGeneration = 0;
  let saveTimer = null;
  let tickTimer = null;

  init();

  async function init() {
    try {
      const state = await window.salary.getState();
      if (state && state.settings) settings = state.settings;
      packaged = !!(state && state.packaged);
    } catch (error) {
      console.error('读取设置失败', error);
    }

    fillFormValues();
    bindEvents();

    computed = Calc.compute(new Date(), settings);
    render();
    updatePinButton();

    clearInterval(tickTimer);
    tickTimer = setInterval(() => {
      computed = Calc.compute(new Date(), settings);
      render();
    }, 100);

    if (window.salary.onDebugView) {
      window.salary.onDebugView((target) => {
        if (target === 'settings') openSettings();
      });
    }
    if (window.salary.onSettingsUpdated) {
      window.salary.onSettingsUpdated((updated) => {
        if (!updated) return;
        settingsGeneration += 1;
        settings = updated;
        fillFormValues();
        updatePinButton();
        computed = Calc.compute(new Date(), settings);
        render();
      });
    }
  }

  /* ----------------------------- 渲染 ----------------------------- */

  function render() {
    const c = computed;
    if (!c) return;

    ui.widget.classList.toggle('is-rest', c.dayType === 'rest');
    ui.widget.classList.toggle('is-overtime', c.dayType === 'overtime');

    const badgeText = c.dayType === 'overtime'
      ? (c.overtimeKind === 'weekend' ? '周末加班 ×2' : '月末周六 ×2')
      : c.dayType === 'rest' ? '休息日' : '工作日';
    let badgeClass = 'badge';
    if (c.dayType === 'overtime') badgeClass += ' badge-overtime';
    if (c.dayType === 'rest') badgeClass += ' badge-rest';
    if (ui.dayBadge.className !== badgeClass) ui.dayBadge.className = badgeClass;
    setText(ui.dayBadge, badgeText);

    setText(ui.dateLabel, c.dateLabel);
    setText(ui.todayAmount, formatMoney(c.todayEarned));
    setText(ui.statusText, statusText(c));

    const pulseClass = 'pulse is-' + c.phase;
    if (ui.pulse.className !== pulseClass) ui.pulse.className = pulseClass;

    ui.dayBar.style.width = (c.fraction * 100).toFixed(3) + '%';
    setText(ui.dayPercent, formatPercent(c.fraction));
    setText(ui.dayRange, workRangeText(c));

    setText(ui.monthTag, c.monthLabel);
    setText(ui.monthAmount, '¥' + formatMoney(c.monthly));
    setText(ui.monthSub, '预计 ¥' + formatMoney(c.monthProjected));
    ui.monthBar.style.width = (c.monthPercent * 100).toFixed(2) + '%';

    setText(ui.weekTag, c.weekRangeLabel);
    setText(ui.weekAmount, '¥' + formatMoney(c.weekly));
    setText(ui.weekSub, '预计 ¥' + formatMoney(c.weekProjected));
    ui.weekBar.style.width = (c.weekPercent * 100).toFixed(2) + '%';

    setText(ui.rateInfo, rateText(c));
    setText(ui.modeChip, settings.useActualWorkdays
      ? '加班 实际 ' + trimNumber(c.effectiveWorkdays) + ' 天'
      : '加班 ' + trimNumber(settings.standardWorkdays) + ' 天');
    if (ui.modeChip) ui.modeChip.title = '加班费按此计薪天数折算';

    updateDerivedUI(c);
  }

  function statusText(c) {
    const countdown = formatCountdown(c.countdownSeconds);
    switch (c.phase) {
      case 'before':
        return '距上班 ' + countdown;
      case 'lunch':
        return (c.overtimeKind === 'weekend' ? '休息中 · 还有 ' : '午休中 · 还有 ') + countdown + ' 继续';
      case 'working':
        if (c.dayType === 'overtime') {
          const overtimeLabel = c.overtimeKind === 'weekend' ? '周末加班中' : '月末周六加班中';
          return overtimeLabel + ' · 距下班 ' + countdown;
        }
        return '上班中 · 距下班 ' + countdown;
      case 'after':
        return '今日已下班 · 明天继续';
      default:
        return '休息日 · 好好休息，明天再赚';
    }
  }

  function rateText(c) {
    const normalHourly = c.totalWorkSeconds > 0
      ? c.normalDailyAmount / (c.totalWorkSeconds / 3600)
      : 0;
    if (c.dayType === 'rest') {
      return '工作日日薪 ¥' + formatMoney(c.normalDailyAmount) + ' · 时薪 ¥' + formatMoney(normalHourly);
    }
    const label = c.dayType === 'overtime' ? '今日双倍' : '日薪';
    return label + ' ¥' + formatMoney(c.dayAmount) + ' · 时薪 ¥' + formatMoney(c.hourlyRate);
  }

  function workRangeText(c) {
    const period = Calc.workPeriod(settings, new Date());
    const restMinutes = Math.round(period.restSeconds / 60);
    let text = formatClock(period.start) + ' – ' + formatClock(period.end);
    if (restMinutes > 0) {
      const label = c && c.overtimeKind === 'weekend' ? '休息 ' : '午休 ';
      text += ' · ' + label + trimNumber(restMinutes / 60) + 'h';
    }
    return text;
  }

  function formatClock(totalSeconds) {
    const total = Math.max(0, Math.round(totalSeconds));
    return pad2(Math.floor(total / 3600)) + ':' + pad2(Math.floor((total % 3600) / 60));
  }

  function updateDerivedUI(c) {
    if (!c) return;
    if (ui.openAtLoginRow) ui.openAtLoginRow.hidden = !packaged;
    const active = !!settings.useActualWorkdays;
    ui.standardWorkdaysRow.hidden = active;
    ui.actualWorkdaysBox.hidden = !active;

    const now = new Date();
    const autoDays = Calc.countWeekdays(now.getFullYear(), now.getMonth());
    setText(ui.autoWorkdaysHint, '（自动 ' + autoDays + ' 天）');
    if (ui.actualWorkdaysOverride.placeholder !== '自动 ' + autoDays) {
      ui.actualWorkdaysOverride.placeholder = '自动 ' + autoDays;
    }

    setText(ui.previewFixed, '¥' + formatMoney(c.fixedMonthly));
    setText(ui.previewDailyLabel, '工作日日薪（' + c.monthlyWorkdays + ' 天）');
    setText(ui.previewDaily, '¥' + formatMoney(c.normalDailyAmount));
    setText(ui.previewSaturday, '¥' + formatMoney(c.saturdayAmount));
    setText(ui.previewOvertimeLabel, c.monthOvertimeDays > 0
      ? '周末加班（' + c.monthOvertimeDays + ' 天）'
      : '周末加班');
    setText(ui.previewOvertime, '¥' + formatMoney(c.monthOvertime));
    setText(ui.previewMonth, '¥' + formatMoney(c.monthProjected));

    const denom = trimNumber(c.effectiveWorkdays);
    const modeText = active
      ? '月末周六 / 周末加班按当月实际 ' + denom + ' 天折算'
      : '月末周六 / 周末加班按 ' + denom + ' 天折算';
    const note = '固定月薪 = 基础 + 绩效 = ¥' + formatMoney(c.fixedMonthly) +
      '，按当月 ' + c.monthlyWorkdays + ' 个工作日摊算（日薪 ¥' + formatMoney(c.normalDailyAmount) + '）。' +
      modeText + '，加班费额外计入本月预计。';
    setText(ui.previewNote, note);
  }

  /* ----------------------------- 表单 ----------------------------- */

  function fillFormValues(force) {
    // 保存回包会刷新表单；正在输入/编辑的控件跳过，避免打断用户
    const setValue = (input, value) => {
      if (force || document.activeElement !== input) input.value = value;
    };

    setValue(ui.baseSalary, trimNumber(settings.baseSalary));
    setValue(ui.bonusSalary, trimNumber(settings.bonusSalary));
    setValue(ui.standardWorkdays, trimNumber(settings.standardWorkdays));
    setValue(ui.actualWorkdaysOverride, settings.actualWorkdaysOverride > 0
      ? String(settings.actualWorkdaysOverride)
      : '');
    setValue(ui.workStart, settings.workStart);
    setValue(ui.workEnd, settings.workEnd);
    setValue(ui.lunchStart, settings.lunchStart);
    setValue(ui.lunchEnd, settings.lunchEnd);

    ui.useActualWorkdays.checked = !!settings.useActualWorkdays;
    ui.alwaysOnTop.checked = !!settings.alwaysOnTop;
    ui.openAtLogin.checked = !!settings.openAtLogin;

    renderOvertimeList();
  }

  function bindEvents() {
    ui.pinBtn.addEventListener('click', () => {
      commit({ alwaysOnTop: !settings.alwaysOnTop }, { refresh: true });
    });

    ui.settingsBtn.addEventListener('click', () => {
      if (view === 'settings') closeSettings();
      else openSettings();
    });

    ui.hideBtn.addEventListener('click', () => window.salary.hide());
    ui.quitBtn.addEventListener('click', quitApp);
    ui.doneBtn.addEventListener('click', closeSettings);
    ui.resetBtn.addEventListener('click', resetSettings);

    bindNumber('baseSalary', 'baseSalary', { min: 0, max: 1e9, integer: false });
    bindNumber('bonusSalary', 'bonusSalary', { min: 0, max: 1e9, integer: false });
    bindNumber('standardWorkdays', 'standardWorkdays', { min: 0.5, max: 31, integer: false });
    bindNumber('actualWorkdaysOverride', 'actualWorkdaysOverride', { min: 0, max: 31, integer: true, emptyIsZero: true });

    bindTime('workStart', 'workStart');
    bindTime('workEnd', 'workEnd');
    bindTime('lunchStart', 'lunchStart');
    bindTime('lunchEnd', 'lunchEnd');

    bindCheckbox('useActualWorkdays', 'useActualWorkdays');
    bindCheckbox('alwaysOnTop', 'alwaysOnTop');
    bindCheckbox('openAtLogin', 'openAtLogin');

    ui.overtimeAddBtn.addEventListener('click', addOvertimeDay);
    ui.overtimeList.addEventListener('click', onOvertimeListClick);
    [ui.overtimeDate, ui.overtimeStart, ui.overtimeEnd].forEach((input) => {
      input.addEventListener('input', clearOvertimeError);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && view === 'settings') closeSettings();
    });
  }

  function bindNumber(id, key, spec) {
    const input = ui[id];

    input.addEventListener('input', () => {
      const raw = input.value.trim();
      if (raw === '') {
        if (spec.emptyIsZero) commit({ [key]: 0 });
        return;
      }
      const n = Number(raw);
      if (!Number.isFinite(n)) return;
      const value = spec.integer ? Math.floor(n) : n;
      if (value < spec.min || value > spec.max) return;
      commit({ [key]: value });
    });

    input.addEventListener('blur', () => {
      const raw = input.value.trim();
      if (raw === '') {
        const fallback = spec.emptyIsZero ? 0 : settings[key];
        input.value = spec.emptyIsZero ? '' : trimNumber(fallback);
        commit({ [key]: fallback });
        return;
      }
      const n = Number(raw);
      let value = Number.isFinite(n) ? n : settings[key];
      if (spec.integer) value = Math.floor(value);
      value = Math.min(spec.max, Math.max(spec.min, value));
      input.value = spec.emptyIsZero && value === 0 ? '' : trimNumber(value);
      commit({ [key]: value });
    });
  }

  function bindTime(id, key) {
    const input = ui[id];

    const orderIsValid = (value) => {
      if (key === 'workStart') return toSeconds(value) < toSeconds(settings.workEnd);
      if (key === 'workEnd') return toSeconds(value) > toSeconds(settings.workStart);
      if (key === 'lunchStart') return toSeconds(value) <= toSeconds(settings.lunchEnd);
      if (key === 'lunchEnd') return toSeconds(value) >= toSeconds(settings.lunchStart);
      return true;
    };

    // 键盘输入小时时会出现 01:00 之类的中间值。
    // change 在输入过程中就会触发，此时不能立刻回退，否则第二位数字永远输不进去。
    input.addEventListener('change', () => {
      const value = input.value;
      if (!/^\d{2}:\d{2}$/.test(value)) return;
      if (!orderIsValid(value)) return;
      if (value === settings[key]) return;
      commit({ [key]: value }, { refresh: true });
    });

    // 离开输入框时再做最终校验，非法值才恢复原值。
    input.addEventListener('blur', () => {
      const value = input.value;
      if (!/^\d{2}:\d{2}$/.test(value) || !orderIsValid(value)) {
        input.value = settings[key];
        return;
      }
      if (value !== settings[key]) {
        commit({ [key]: value }, { refresh: true });
      }
    });
  }

  function bindCheckbox(id, key) {
    const input = ui[id];
    input.addEventListener('change', () => {
      commit({ [key]: input.checked }, { refresh: true });
    });
  }

  /* --------------------------- 周末加班 --------------------------- */

  function addOvertimeDay() {
    clearOvertimeError();
    const date = parseDateInput(ui.overtimeDate.value);
    if (!date) {
      showOvertimeError('请选择加班日期');
      return;
    }
    if (date.getDay() !== 0 && date.getDay() !== 6) {
      showOvertimeError('只能添加周六或周日的加班');
      return;
    }
    if (Calc.isEndOfMonthSaturday(date)) {
      showOvertimeError('月末周六已自动按双倍计算，无需重复添加');
      return;
    }

    const key = Calc.formatDateKey(date);
    const days = Array.isArray(settings.overtimeDays) ? settings.overtimeDays : [];
    if (days.some((entry) => entry.date === key)) {
      showOvertimeError('该日期已添加');
      return;
    }

    const workStart = ui.overtimeStart.value;
    const workEnd = ui.overtimeEnd.value;
    if (!workStart || !workEnd) {
      showOvertimeError('请填写加班起止时间');
      return;
    }
    if (toSeconds(workEnd) <= toSeconds(workStart)) {
      showOvertimeError('加班结束时间需晚于开始时间');
      return;
    }

    const next = days
      .concat({ date: key, workStart, workEnd })
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    ui.overtimeDate.value = '';
    commit({ overtimeDays: next }, { refresh: true });
  }

  function onOvertimeListClick(event) {
    const button = event.target.closest('.overtime-remove');
    if (!button) return;
    const date = button.dataset.date;
    const days = (settings.overtimeDays || []).filter((entry) => entry.date !== date);
    commit({ overtimeDays: days }, { refresh: true });
  }

  function renderOvertimeList() {
    if (!ui.overtimeList) return;
    ui.overtimeList.textContent = '';

    const days = Array.isArray(settings.overtimeDays) ? settings.overtimeDays : [];
    if (days.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'overtime-empty';
      empty.textContent = '暂无周末加班';
      ui.overtimeList.appendChild(empty);
      return;
    }

    const thisYear = new Date().getFullYear();
    days.forEach((entry) => {
      const date = parseDateInput(entry.date);
      if (!date) return;

      const item = document.createElement('li');
      item.className = 'overtime-item';

      const label = document.createElement('span');
      label.className = 'overtime-date';
      const yearPrefix = date.getFullYear() === thisYear ? '' : date.getFullYear() + '/';
      label.textContent = yearPrefix + (date.getMonth() + 1) + '/' + date.getDate() +
        ' ' + Calc.WEEKDAY_NAMES[date.getDay()];

      const span = document.createElement('span');
      span.className = 'overtime-rest';
      span.textContent = entry.workStart + '–' + entry.workEnd;
      span.title = '当天加班时段；12:00–13:30、18:00–18:30 休息不计薪';

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'overtime-remove';
      remove.dataset.date = entry.date;
      remove.title = '删除该加班日';
      remove.setAttribute('aria-label', '删除 ' + entry.date + ' 的加班');
      remove.textContent = '×';

      item.append(label, span, remove);
      ui.overtimeList.appendChild(item);
    });
  }

  function parseDateInput(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) return null;
    return date;
  }

  function showOvertimeError(message) {
    if (!ui.overtimeError) return;
    ui.overtimeError.textContent = message;
    ui.overtimeError.hidden = false;
  }

  function clearOvertimeError() {
    if (!ui.overtimeError) return;
    ui.overtimeError.hidden = true;
    ui.overtimeError.textContent = '';
  }

  async function quitApp() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (Object.keys(pendingPatch).length > 0) {
      try {
        await flushSave();
      } catch (error) {
        console.error('退出前保存设置失败', error);
      }
    }
    window.salary.quit();
  }

  async function resetSettings() {
    settingsGeneration += 1;
    clearTimeout(saveTimer);
    saveTimer = null;
    pendingPatch = {};
    pendingRefresh = false;
    try {
      settings = await window.salary.resetSettings();
      fillFormValues(true);
      updatePinButton();
      computed = Calc.compute(new Date(), settings);
      render();
    } catch (error) {
      console.error('恢复默认失败', error);
    }
  }

  /* ----------------------------- 存储 ----------------------------- */

  function commit(patch, options) {
    settings = Object.assign({}, settings, patch);
    Object.assign(pendingPatch, patch);
    if (options && options.refresh) pendingRefresh = true;

    updatePinButton();
    computed = Calc.compute(new Date(), settings);
    render();
    if (Object.prototype.hasOwnProperty.call(patch, 'overtimeDays')) renderOvertimeList();
    scheduleSave();
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 350);
  }

  async function flushSave() {
    const generation = settingsGeneration;
    const patch = pendingPatch;
    const refresh = pendingRefresh;
    pendingPatch = {};
    pendingRefresh = false;

    try {
      const saved = await window.salary.saveSettings(patch);
      if (saved && generation === settingsGeneration) {
        // 保存期间用户可能又改了别的字段，保留这些较新的本地修改
        settings = Object.assign({}, saved, pendingPatch);
        if (refresh && Object.keys(pendingPatch).length === 0) fillFormValues();
        updatePinButton();
        computed = Calc.compute(new Date(), settings);
        render();
      }
    } catch (error) {
      console.error('保存设置失败', error);
    }
  }

  function updatePinButton() {
    ui.pinBtn.classList.toggle('active', !!settings.alwaysOnTop);
    ui.pinBtn.title = settings.alwaysOnTop ? '已置顶（点击取消）' : '始终置顶';
    if (ui.alwaysOnTop.checked !== !!settings.alwaysOnTop) {
      ui.alwaysOnTop.checked = !!settings.alwaysOnTop;
    }
  }

  /* ----------------------------- 视图 ----------------------------- */

  function openSettings() {
    if (view === 'settings' || !computed) return;
    view = 'settings';
    ui.mainView.hidden = true;
    ui.settingsView.hidden = false;
    ui.settingsBtn.classList.add('active');
    ui.settingsBtn.title = '返回主界面';
    setText(ui.headerTitle, '设置');
    window.salary.setView('settings');
    updateDerivedUI(computed);
  }

  function closeSettings() {
    if (view !== 'settings') return;
    view = 'widget';
    ui.settingsView.hidden = true;
    ui.mainView.hidden = false;
    ui.settingsBtn.classList.remove('active');
    ui.settingsBtn.title = '设置';
    setText(ui.headerTitle, '工资实时统计');
    window.salary.setView('widget');
  }

  /* ----------------------------- 工具 ----------------------------- */

  function toSeconds(value) {
    const parts = String(value).split(':');
    return Number(parts[0]) * 3600 + Number(parts[1]) * 60;
  }

  function formatMoney(value) {
    return moneyFormatter.format(Number.isFinite(value) ? value : 0);
  }

  function formatPercent(fraction) {
    const percent = Math.min(1, Math.max(0, fraction)) * 100;
    return (percent >= 99.95 ? '100' : percent.toFixed(1)) + '%';
  }

  function formatCountdown(seconds) {
    const total = Math.max(0, Math.ceil(seconds));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function trimNumber(value) {
    if (!Number.isFinite(value)) return '0';
    return String(Number(value.toFixed(4)));
  }

  function setText(element, text) {
    if (element && element.textContent !== text) element.textContent = text;
  }
})();
