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
    alwaysOnTop: $('alwaysOnTop'),
    openAtLogin: $('openAtLogin'),
    previewDaily: $('previewDaily'),
    previewSaturday: $('previewSaturday'),
    previewMonth: $('previewMonth'),
    previewNote: $('previewNote')
  };

  const moneyFormatter = new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  let settings = Object.assign({}, Defaults.DEFAULT_SETTINGS);
  let computed = null;
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

    const badgeText = c.dayType === 'overtime' ? '月末周六 ×2' : c.dayType === 'rest' ? '休息日' : '工作日';
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
    setText(ui.dayRange, workRangeText());

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
      ? '实际 ' + trimNumber(c.effectiveWorkdays) + ' 天'
      : trimNumber(settings.standardWorkdays) + ' 天');

    updateDerivedUI(c);
  }

  function statusText(c) {
    const countdown = formatCountdown(c.countdownSeconds);
    switch (c.phase) {
      case 'before':
        return '距上班 ' + countdown;
      case 'lunch':
        return '午休中 · 还有 ' + countdown + ' 继续';
      case 'working':
        return (c.dayType === 'overtime' ? '月末周六加班中 · 距下班 ' : '上班中 · 距下班 ') + countdown;
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

  function workRangeText() {
    const period = Calc.workPeriod(settings);
    const lunchMinutes = Math.round(period.lunchSeconds / 60);
    let text = settings.workStart + ' – ' + settings.workEnd;
    if (lunchMinutes > 0) text += ' · 午休 ' + trimNumber(lunchMinutes / 60) + 'h';
    return text;
  }

  function updateDerivedUI(c) {
    if (!c) return;
    const active = !!settings.useActualWorkdays;
    ui.standardWorkdaysRow.hidden = active;
    ui.actualWorkdaysBox.hidden = !active;

    const now = new Date();
    const autoDays = Calc.countWeekdays(now.getFullYear(), now.getMonth());
    setText(ui.autoWorkdaysHint, '（自动 ' + autoDays + ' 天）');
    if (ui.actualWorkdaysOverride.placeholder !== '自动 ' + autoDays) {
      ui.actualWorkdaysOverride.placeholder = '自动 ' + autoDays;
    }

    setText(ui.previewDaily, '¥' + formatMoney(c.normalDailyAmount));
    setText(ui.previewSaturday, '¥' + formatMoney(c.saturdayAmount));
    setText(ui.previewMonth, '¥' + formatMoney(c.monthProjected));

    const denom = trimNumber(c.effectiveWorkdays);
    const formula = '日薪 = (基础 + 绩效) ÷ ' + denom + '，月末周六 = 基础 ÷ ' + denom + ' × 2（不含绩效）。';
    const modeText = active ? '按当月实际 ' + denom + ' 天计薪：' : '按 ' + denom + ' 天计薪：';
    setText(ui.previewNote, '本月月末周六：' + c.lastSaturdayLabel + '。' + modeText + formula);
  }

  /* ----------------------------- 表单 ----------------------------- */

  function fillFormValues() {
    ui.baseSalary.value = trimNumber(settings.baseSalary);
    ui.bonusSalary.value = trimNumber(settings.bonusSalary);
    ui.standardWorkdays.value = trimNumber(settings.standardWorkdays);
    ui.actualWorkdaysOverride.value = settings.actualWorkdaysOverride > 0
      ? String(settings.actualWorkdaysOverride)
      : '';
    ui.useActualWorkdays.checked = !!settings.useActualWorkdays;
    ui.workStart.value = settings.workStart;
    ui.workEnd.value = settings.workEnd;
    ui.lunchStart.value = settings.lunchStart;
    ui.lunchEnd.value = settings.lunchEnd;
    ui.alwaysOnTop.checked = !!settings.alwaysOnTop;
    ui.openAtLogin.checked = !!settings.openAtLogin;
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
    input.addEventListener('change', () => {
      const value = input.value;
      if (!/^\d{2}:\d{2}$/.test(value)) {
        input.value = settings[key];
        return;
      }
      if (key === 'workStart' && toSeconds(value) >= toSeconds(settings.workEnd)) {
        input.value = settings[key];
        return;
      }
      if (key === 'workEnd' && toSeconds(value) <= toSeconds(settings.workStart)) {
        input.value = settings[key];
        return;
      }
      commit({ [key]: value }, { refresh: true });
    });
  }

  function bindCheckbox(id, key) {
    const input = ui[id];
    input.addEventListener('change', () => {
      commit({ [key]: input.checked }, { refresh: true });
    });
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
      fillFormValues();
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
