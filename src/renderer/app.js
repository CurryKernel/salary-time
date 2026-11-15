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
    netTag: $('netTag'),
    netAmount: $('netAmount'),
    netSub: $('netSub'),
    netBar: $('netBar'),
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
    workStart: $('workStart'),
    workEnd: $('workEnd'),
    lunchStart: $('lunchStart'),
    lunchEnd: $('lunchEnd'),
    overtimeDate: $('overtimeDate'),
    overtimeStart: $('overtimeStart'),
    overtimeEnd: $('overtimeEnd'),
    overtimeRest1Start: $('overtimeRest1Start'),
    overtimeRest1End: $('overtimeRest1End'),
    overtimeRest2Start: $('overtimeRest2Start'),
    overtimeRest2End: $('overtimeRest2End'),
    overtimeAddBtn: $('overtimeAddBtn'),
    overtimeComp: $('overtimeComp'),
    overtimeList: $('overtimeList'),
    compConversionEnabled: $('compConversionEnabled'),
    compConversionHours: $('compConversionHours'),
    compConversionHoursRow: $('compConversionHoursRow'),
    overtimeError: $('overtimeError'),
    insuranceBase: $('insuranceBase'),
    socialEnabled: $('socialEnabled'),
    socialMode: $('socialMode'),
    socialValue: $('socialValue'),
    socialUnit: $('socialUnit'),
    housingFundEnabled: $('housingFundEnabled'),
    housingFundMode: $('housingFundMode'),
    housingFundValue: $('housingFundValue'),
    housingFundUnit: $('housingFundUnit'),
    insurancePreview: $('insurancePreview'),
    taxRate: $('taxRate'),
    taxReduction: $('taxReduction'),
    taxPreview: $('taxPreview'),
    partyDues: $('partyDues'),
    alwaysOnTop: $('alwaysOnTop'),
    openAtLogin: $('openAtLogin'),
    openAtLoginRow: $('openAtLoginRow'),
    previewDaily: $('previewDaily'),
    previewDailyLabel: $('previewDailyLabel'),
    previewFixed: $('previewFixed'),
    previewSaturday: $('previewSaturday'),
    previewOvertimeLabel: $('previewOvertimeLabel'),
    previewOvertime: $('previewOvertime'),
    previewComp: $('previewComp'),
    previewConversionRow: $('previewConversionRow'),
    previewConversionLabel: $('previewConversionLabel'),
    previewConversion: $('previewConversion'),
    previewMonth: $('previewMonth'),
    previewInsurance: $('previewInsurance'),
    previewTax: $('previewTax'),
    previewParty: $('previewParty'),
    previewNet: $('previewNet'),
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
    ui.widget.classList.toggle('is-comp', !!c.todayIsComp);

    let badgeText;
    let badgeClass = 'badge';
    if (c.dayType === 'overtime') {
      if (c.todayIsComp) {
        badgeText = c.overtimeKind === 'weekend' ? '周末加班 · 转调休' : '月末周六 · 转调休';
        badgeClass += ' badge-comp';
      } else {
        badgeText = c.overtimeKind === 'weekend' ? '周末加班 ×2' : '月末周六 ×2';
        badgeClass += ' badge-overtime';
      }
    } else if (c.dayType === 'rest') {
      badgeText = '休息日';
      badgeClass += ' badge-rest';
    } else {
      badgeText = '工作日';
    }
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

    setText(ui.netTag, c.monthLabel);
    setText(ui.netAmount, '¥' + formatMoney(c.netMonthly));
    setText(ui.netSub, '税前 ¥' + formatMoney(c.monthProjected));
    ui.netBar.style.width = (c.monthPercent * 100).toFixed(2) + '%';
    if (ui.netAmount) {
      ui.netAmount.title = '五险一金 ¥' + formatMoney(c.insuranceTotal) +
        ' · 个税 ¥' + formatMoney(c.taxAmount) +
        ' · 党费 ¥' + formatMoney(c.partyDues);
    }

    setText(ui.rateInfo, rateText(c));
    setText(ui.modeChip, '本月调休 ' + c.monthCompDays + ' 天');
    if (ui.modeChip) {
      ui.modeChip.title = '月末周六自动转调休' +
        (c.monthCompOvertimeDays > 0 ? '，另有 ' + c.monthCompOvertimeDays + ' 天加班转调休' : '') +
        (c.conversionEnabled ? '，本月兑换 ' + trimNumber(c.conversionHours) + ' 小时' : '');
    }

    updateDerivedUI(c);
  }

  function statusText(c) {
    const countdown = formatCountdown(c.countdownSeconds);
    if (c.todayIsComp) {
      const label = c.overtimeKind === 'weekend' ? '周末加班' : '月末周六';
      switch (c.phase) {
        case 'before': return '距上班 ' + countdown + ' · 今日转调休';
        case 'lunch': return '午休中 · 转调休 · 还有 ' + countdown;
        case 'working': return label + '加班中 · 转调休 · 距下班 ' + countdown;
        case 'after': return '今日已下班 · 已转调休';
        default: return '今日转调休';
      }
    }
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
    if (c.todayIsComp) return '今日转调休 · 不计工资';
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
    setText(ui.previewFixed, '¥' + formatMoney(c.fixedMonthly));
    setText(ui.previewDailyLabel, '工作日日薪（' + c.monthlyWorkdays + ' 天）');
    setText(ui.previewDaily, '¥' + formatMoney(c.normalDailyAmount));
    setText(ui.previewSaturday, c.monthEndCompDays + ' 天');
    let overtimeLabel = '周末加班';
    if (c.monthOvertimeDays > 0) {
      overtimeLabel += '（' + c.monthOvertimeDays + ' 天';
      if (c.monthCompOvertimeDays > 0) overtimeLabel += '，' + c.monthCompOvertimeDays + ' 天转调休';
      overtimeLabel += '）';
    }
    setText(ui.previewOvertimeLabel, overtimeLabel);
    setText(ui.previewOvertime, '¥' + formatMoney(c.monthOvertime));
    setText(ui.previewComp, c.monthCompDays + ' 天');
    const conversion = settings.compConversion || {};
    const conversionEnabled = !!conversion.enabled;
    if (ui.compConversionHoursRow) ui.compConversionHoursRow.hidden = !conversionEnabled;
    if (ui.previewConversionRow) ui.previewConversionRow.hidden = !conversionEnabled;
    if (conversionEnabled) {
      setText(ui.previewConversionLabel,
        '调休兑换（' + trimNumber(conversion.hours) + ' 小时）');
      setText(ui.previewConversion, '¥' + formatMoney(c.conversionPay));
    }
    setText(ui.previewMonth, '¥' + formatMoney(c.monthProjected));
    setText(ui.previewInsurance, '¥' + formatMoney(c.insuranceTotal));
    setText(ui.previewTax, '¥' + formatMoney(c.taxAmount));
    setText(ui.previewParty, '¥' + formatMoney(c.partyDues));
    setText(ui.previewNet, '¥' + formatMoney(c.netMonthly));
    setText(ui.insurancePreview, '¥' + formatMoney(c.insuranceTotal));
    setText(ui.taxPreview, '¥' + formatMoney(c.taxAmount));

    const note = '固定月薪 = 基础 + 绩效 = ¥' + formatMoney(c.fixedMonthly) +
      '，按当月 ' + c.monthlyWorkdays + ' 个工作日摊算（日薪 ¥' + formatMoney(c.normalDailyAmount) + '）。' +
      '月末周六自动转调休，不计工资；周末加班可选择转调休或发工资；' +
      '本月兑换配额按加班时薪计入税前。' +
      '本月到手 = 税前 − 五险一金 − 个税 − 党费。';
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
    setValue(ui.workStart, settings.workStart);
    setValue(ui.workEnd, settings.workEnd);
    setValue(ui.lunchStart, settings.lunchStart);
    setValue(ui.lunchEnd, settings.lunchEnd);

    const restDefaults = Defaults.DEFAULT_SETTINGS.overtimeRests;
    const overtimeRests = Array.isArray(settings.overtimeRests) ? settings.overtimeRests : [];
    const rest0 = Object.assign({}, restDefaults[0], overtimeRests[0]);
    const rest1 = Object.assign({}, restDefaults[1], overtimeRests[1]);
    setValue(ui.overtimeRest1Start, rest0.start);
    setValue(ui.overtimeRest1End, rest0.end);
    setValue(ui.overtimeRest2Start, rest1.start);
    setValue(ui.overtimeRest2End, rest1.end);

    ui.alwaysOnTop.checked = !!settings.alwaysOnTop;
    ui.openAtLogin.checked = !!settings.openAtLogin;

    const insurance = settings.insurance || {};
    const social = insurance.social || {};
    const housingFund = insurance.housingFund || {};
    setValue(ui.insuranceBase, insurance.base == null ? '' : trimNumber(insurance.base));
    ui.socialEnabled.checked = social.enabled !== false;
    ui.socialMode.value = social.mode === 'fixed' ? 'fixed' : 'ratio';
    setValue(ui.socialValue, trimNumber(social.mode === 'fixed' ? social.amount : social.ratio));
    setText(ui.socialUnit, social.mode === 'fixed' ? '元' : '%');
    ui.housingFundEnabled.checked = housingFund.enabled !== false;
    ui.housingFundMode.value = housingFund.mode === 'fixed' ? 'fixed' : 'ratio';
    setValue(ui.housingFundValue, trimNumber(housingFund.mode === 'fixed'
      ? housingFund.amount
      : housingFund.ratio));
    setText(ui.housingFundUnit, housingFund.mode === 'fixed' ? '元' : '%');

    const tax = settings.tax || {};
    setValue(ui.taxRate, trimNumber(tax.rate));
    setValue(ui.taxReduction, trimNumber(tax.monthlyReduction));
    setValue(ui.partyDues, trimNumber(settings.partyDues || 0));

    const conversion = settings.compConversion || {};
    ui.compConversionEnabled.value = conversion.enabled ? 'yes' : 'no';
    setValue(ui.compConversionHours, trimNumber(conversion.hours || 0));

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

    bindTime('workStart', 'workStart');
    bindTime('workEnd', 'workEnd');
    bindTime('lunchStart', 'lunchStart');
    bindTime('lunchEnd', 'lunchEnd');

    bindCheckbox('alwaysOnTop', 'alwaysOnTop');
    bindCheckbox('openAtLogin', 'openAtLogin');

    ui.overtimeAddBtn.addEventListener('click', addOvertimeDay);
    ui.overtimeList.addEventListener('click', onOvertimeListClick);
    ui.overtimeList.addEventListener('change', onOvertimeListChange);
    bindCompConversion();
    [ui.overtimeDate, ui.overtimeStart, ui.overtimeEnd].forEach((input) => {
      input.addEventListener('input', clearOvertimeError);
    });

    bindOvertimeRests();
    bindDeductions();

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
      showOvertimeError('月末周六已自动转调休，无需重复添加');
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
      .concat({ date: key, workStart, workEnd, compTime: !!ui.overtimeComp.checked })
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

  function onOvertimeListChange(event) {
    const input = event.target.closest('.overtime-comp-check');
    if (!input) return;
    const date = input.dataset.date;
    const days = (settings.overtimeDays || []).map((entry) =>
      entry.date === date ? Object.assign({}, entry, { compTime: input.checked }) : entry);
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

      const compLabel = document.createElement('label');
      compLabel.className = 'overtime-comp';
      compLabel.title = '勾选后该加班日转调休，不发现金';
      const compInput = document.createElement('input');
      compInput.type = 'checkbox';
      compInput.className = 'overtime-comp-check';
      compInput.dataset.date = entry.date;
      compInput.checked = !!entry.compTime;
      const compText = document.createElement('span');
      compText.textContent = '转调休';
      compLabel.append(compInput, compText);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'overtime-remove';
      remove.dataset.date = entry.date;
      remove.title = '删除该加班日';
      remove.setAttribute('aria-label', '删除 ' + entry.date + ' 的加班');
      remove.textContent = '×';

      item.append(label, span, compLabel, remove);
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

  /* --------------------------- 加班休息时段 --------------------------- */

  function currentOvertimeRests() {
    const defaults = Defaults.DEFAULT_SETTINGS.overtimeRests;
    const rests = Array.isArray(settings.overtimeRests) ? settings.overtimeRests : [];
    return defaults.map((fallback, index) => Object.assign({}, fallback, rests[index]));
  }

  function bindOvertimeRests() {
    const fields = [
      { input: ui.overtimeRest1Start, index: 0, key: 'start' },
      { input: ui.overtimeRest1End, index: 0, key: 'end' },
      { input: ui.overtimeRest2Start, index: 1, key: 'start' },
      { input: ui.overtimeRest2End, index: 1, key: 'end' }
    ];

    const isValid = (index, key, value, rests) => {
      if (!/^\d{2}:\d{2}$/.test(value)) return false;
      const rest = rests[index];
      return key === 'start'
        ? toSeconds(value) <= toSeconds(rest.end)
        : toSeconds(value) >= toSeconds(rest.start);
    };

    const commitRest = (index, key, value) => {
      const rests = currentOvertimeRests();
      rests[index] = Object.assign({}, rests[index], { [key]: value });
      commit({ overtimeRests: rests }, { refresh: true });
    };

    fields.forEach(({ input, index, key }) => {
      input.addEventListener('change', () => {
        const value = input.value;
        if (!isValid(index, key, value, currentOvertimeRests())) return;
        commitRest(index, key, value);
      });
      input.addEventListener('blur', () => {
        const rests = currentOvertimeRests();
        const value = input.value;
        if (!isValid(index, key, value, rests)) {
          input.value = rests[index][key];
          return;
        }
        if (value !== rests[index][key]) commitRest(index, key, value);
      });
    });
  }

  /* --------------------------- 五险一金 / 个税 --------------------------- */

  function commitInsurance(key, value) {
    commit({ insurance: Object.assign({}, settings.insurance, { [key]: value }) }, { refresh: true });
  }

  function bindCompConversion() {
    ui.compConversionEnabled.addEventListener('change', () => {
      const enabled = ui.compConversionEnabled.value === 'yes';
      commit({
        compConversion: Object.assign({}, settings.compConversion, { enabled })
      }, { refresh: true });
    });

    ui.compConversionHours.addEventListener('input', () => {
      const raw = ui.compConversionHours.value.trim();
      if (raw === '') return;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) return;
      commit({
        compConversion: Object.assign({}, settings.compConversion, {
          hours: Math.min(1000, value)
        })
      });
    });

    ui.compConversionHours.addEventListener('blur', () => {
      const value = Math.min(1000, Math.max(0, Number(ui.compConversionHours.value) || 0));
      ui.compConversionHours.value = trimNumber(value);
      commit({
        compConversion: Object.assign({}, settings.compConversion, { hours: value })
      }, { refresh: true });
    });
  }

  function bindDeductions() {
    ui.insuranceBase.addEventListener('input', () => {
      const raw = ui.insuranceBase.value.trim();
      if (raw === '') {
        commitInsurance('base', null);
        return;
      }
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) return;
      commitInsurance('base', Math.min(1e9, value));
    });
    ui.insuranceBase.addEventListener('blur', () => {
      const raw = ui.insuranceBase.value.trim();
      if (raw === '') {
        ui.insuranceBase.value = '';
        commitInsurance('base', null);
        return;
      }
      const value = Math.min(1e9, Math.max(0, Number(raw) || 0));
      ui.insuranceBase.value = trimNumber(value);
      commitInsurance('base', value);
    });

    bindInsuranceItem('social', ui.socialEnabled, ui.socialMode, ui.socialValue, ui.socialUnit);
    bindInsuranceItem('housingFund', ui.housingFundEnabled, ui.housingFundMode,
      ui.housingFundValue, ui.housingFundUnit);

    ui.taxRate.addEventListener('input', () => {
      const value = Number(ui.taxRate.value);
      if (!Number.isFinite(value) || value < 0 || value > 100) return;
      commit({ tax: Object.assign({}, settings.tax, { rate: value }) }, { refresh: true });
    });
    ui.taxRate.addEventListener('blur', () => {
      const value = Math.min(100, Math.max(0, Number(ui.taxRate.value) || 0));
      ui.taxRate.value = trimNumber(value);
      commit({ tax: Object.assign({}, settings.tax, { rate: value }) }, { refresh: true });
    });

    ui.taxReduction.addEventListener('input', () => {
      const value = Number(ui.taxReduction.value);
      if (!Number.isFinite(value) || value < 0) return;
      commit({ tax: Object.assign({}, settings.tax, { monthlyReduction: Math.min(1e9, value) }) },
        { refresh: true });
    });
    ui.taxReduction.addEventListener('blur', () => {
      const value = Math.min(1e9, Math.max(0, Number(ui.taxReduction.value) || 0));
      ui.taxReduction.value = trimNumber(value);
      commit({ tax: Object.assign({}, settings.tax, { monthlyReduction: value }) }, { refresh: true });
    });

    ui.partyDues.addEventListener('input', () => {
      const value = Number(ui.partyDues.value);
      if (!Number.isFinite(value) || value < 0) return;
      commit({ partyDues: Math.min(1e9, value) });
    });
    ui.partyDues.addEventListener('blur', () => {
      const value = Math.min(1e9, Math.max(0, Number(ui.partyDues.value) || 0));
      ui.partyDues.value = trimNumber(value);
      commit({ partyDues: value });
    });
  }

  function bindInsuranceItem(key, enabledInput, modeInput, valueInput, unitLabel) {
    const current = () => (settings.insurance && settings.insurance[key]) || {};
    const patch = (changes) => {
      const next = Object.assign({}, current(), changes);
      commit({ insurance: Object.assign({}, settings.insurance, { [key]: next }) }, { refresh: true });
    };

    enabledInput.addEventListener('change', () => {
      patch({ enabled: enabledInput.checked });
    });

    modeInput.addEventListener('change', () => {
      const mode = modeInput.value === 'fixed' ? 'fixed' : 'ratio';
      const item = current();
      const nextValue = mode === 'fixed' ? (item.amount || 0) : Math.min(100, item.ratio || 0);
      valueInput.value = trimNumber(nextValue);
      setText(unitLabel, mode === 'fixed' ? '元' : '%');
      patch({ mode });
    });

    valueInput.addEventListener('input', () => {
      const raw = valueInput.value.trim();
      if (raw === '') return;
      const numeric = Number(raw);
      if (!Number.isFinite(numeric) || numeric < 0) return;
      const item = current();
      if (item.mode === 'fixed') {
        patch({ amount: Math.min(1e9, numeric) });
      } else {
        patch({ ratio: Math.min(100, numeric) });
      }
    });

    valueInput.addEventListener('blur', () => {
      const item = current();
      let numeric = Number(valueInput.value);
      if (!Number.isFinite(numeric) || numeric < 0) numeric = 0;
      if (item.mode === 'fixed') {
        numeric = Math.min(1e9, numeric);
        valueInput.value = trimNumber(numeric);
        patch({ amount: numeric });
      } else {
        numeric = Math.min(100, numeric);
        valueInput.value = trimNumber(numeric);
        patch({ ratio: numeric });
      }
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
