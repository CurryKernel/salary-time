(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./defaults.js'));
  } else {
    root.SalaryCalc = factory(root.SalaryDefaults);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Defaults) {
  'use strict';

  const BASE = Defaults.DEFAULT_SETTINGS;
  const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function normalizeSettings(settings) {
    const s = Object.assign({}, BASE, settings || {});
    s.baseSalary = toNumber(s.baseSalary, BASE.baseSalary);
    s.bonusSalary = toNumber(s.bonusSalary, BASE.bonusSalary);
    s.standardWorkdays = toNumber(s.standardWorkdays, BASE.standardWorkdays);
    s.actualWorkdaysOverride = Math.max(0, Math.floor(toNumber(s.actualWorkdaysOverride, 0)));
    s.useActualWorkdays = !!s.useActualWorkdays;
    s.alwaysOnTop = s.alwaysOnTop !== false;
    s.openAtLogin = !!s.openAtLogin;
    return s;
  }

  function toNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function daysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
  }

  function countWeekdays(year, month) {
    let count = 0;
    const total = daysInMonth(year, month);
    for (let day = 1; day <= total; day++) {
      const weekday = new Date(year, month, day).getDay();
      if (weekday >= 1 && weekday <= 5) count++;
    }
    return count;
  }

  /** 当月最后一个周六的日期（1-31），必定存在 */
  function lastSaturdayOfMonth(year, month) {
    const total = daysInMonth(year, month);
    for (let day = total; day >= 1; day--) {
      if (new Date(year, month, day).getDay() === 6) return day;
    }
    return 0;
  }

  /** 是否为“月末周六”（当月最后一个周六，双倍工资） */
  function isEndOfMonthSaturday(date) {
    return date.getDay() === 6 &&
      date.getDate() === lastSaturdayOfMonth(date.getFullYear(), date.getMonth());
  }

  /** 本月实际计薪工作日数：21.75 天模式 / 实际工作日模式（可手动覆盖） */
  function effectiveWorkdays(settings, year, month) {
    const s = normalizeSettings(settings);
    if (!s.useActualWorkdays) return s.standardWorkdays;
    if (s.actualWorkdaysOverride > 0) return s.actualWorkdaysOverride;
    return countWeekdays(year, month);
  }

  function parseTimeToSeconds(value) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return null;
    return hour * 3600 + minute * 60;
  }

  /** 一天的工作时段（扣除午休），单位秒 */
  function workPeriod(settings) {
    const s = normalizeSettings(settings);
    const start = parseTimeToSeconds(s.workStart);
    let end = parseTimeToSeconds(s.workEnd);
    let lunchStart = parseTimeToSeconds(s.lunchStart);
    let lunchEnd = parseTimeToSeconds(s.lunchEnd);

    const safeStart = start == null ? 9 * 3600 : start;
    let safeEnd = end == null ? 18 * 3600 : end;
    if (safeEnd <= safeStart) safeEnd = Math.min(24 * 3600, safeStart + 8 * 3600);
    let safeLunchStart = lunchStart == null ? 12 * 3600 : lunchStart;
    let safeLunchEnd = lunchEnd == null ? 13 * 3600 : lunchEnd;

    safeLunchStart = Math.min(Math.max(safeLunchStart, safeStart), safeEnd);
    safeLunchEnd = Math.min(Math.max(safeLunchEnd, safeStart), safeEnd);
    if (safeLunchEnd < safeLunchStart) {
      const tmp = safeLunchStart;
      safeLunchStart = safeLunchEnd;
      safeLunchEnd = tmp;
    }

    const lunch = safeLunchEnd - safeLunchStart;
    const total = Math.max(0, safeEnd - safeStart - lunch);

    return {
      start: safeStart,
      end: safeEnd,
      lunchStart: safeLunchStart,
      lunchEnd: safeLunchEnd,
      lunchSeconds: lunch,
      totalSeconds: total
    };
  }

  /** workday | overtime | rest */
  function dayType(date, settings) {
    if (isEndOfMonthSaturday(date)) return 'overtime';
    const weekday = date.getDay();
    return weekday >= 1 && weekday <= 5 ? 'workday' : 'rest';
  }

  /** 某一天应得的全日工资（月末周六按基础工资双倍，且不含绩效） */
  function dayAmountForDate(date, settings) {
    const s = normalizeSettings(settings);
    const denom = effectiveWorkdays(s, date.getFullYear(), date.getMonth());
    if (!denom || denom <= 0) return 0;

    if (isEndOfMonthSaturday(date)) {
      return (s.baseSalary / denom) * 2;
    }
    const weekday = date.getDay();
    if (weekday >= 1 && weekday <= 5) {
      return (s.baseSalary + s.bonusSalary) / denom;
    }
    return 0;
  }

  function secondsOfDay(date) {
    return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds() +
      date.getMilliseconds() / 1000;
  }

  /** 今天的工作进度 0-1（午休期间冻结） */
  function fractionAt(date, settings) {
    if (dayType(date, settings) === 'rest') return 0;
    const period = workPeriod(settings);
    if (period.totalSeconds <= 0) {
      return secondsOfDay(date) >= period.end ? 1 : 0;
    }
    const now = secondsOfDay(date);
    if (now <= period.start) return 0;
    if (now >= period.end) return 1;

    const elapsed = now - period.start;
    const lunchOverlap = Math.max(0, Math.min(now, period.lunchEnd) - period.lunchStart);
    const worked = elapsed - lunchOverlap;
    return Math.min(1, Math.max(0, worked / period.totalSeconds));
  }

  /** before | working | lunch | after | rest */
  function phaseAt(date, settings) {
    if (dayType(date, settings) === 'rest') return 'rest';
    const period = workPeriod(settings);
    const now = secondsOfDay(date);
    if (now < period.start) return 'before';
    if (now >= period.end) return 'after';
    if (now >= period.lunchStart && now < period.lunchEnd) return 'lunch';
    return 'working';
  }

  function remainingSecondsAt(date, settings) {
    const period = workPeriod(settings);
    const now = secondsOfDay(date);
    switch (phaseAt(date, settings)) {
      case 'before': return Math.max(0, period.start - now);
      case 'lunch': return Math.max(0, period.lunchEnd - now);
      case 'working': return Math.max(0, period.end - now);
      default: return 0;
    }
  }

  function dateKey(date) {
    return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
  }

  /** 某天已经挣到的钱：过去整天按全额，今天按时段进度，未来为 0 */
  function earnedOnDate(date, now, settings) {
    const dayAmount = dayAmountForDate(date, settings);
    const key = dateKey(date);
    const todayKey = dateKey(now);
    if (key < todayKey) return dayAmount;
    if (key > todayKey) return 0;
    return dayAmount * fractionAt(now, settings);
  }

  function sumDays(startDate, endDate, now, settings, fullDay) {
    let total = 0;
    const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const last = dateKey(endDate);
    while (dateKey(cursor) <= last) {
      total += fullDay ? dayAmountForDate(cursor, settings) : earnedOnDate(cursor, now, settings);
      cursor.setDate(cursor.getDate() + 1);
    }
    return total;
  }

  function startOfWeekMonday(date) {
    const day = date.getDay();
    const offset = day === 0 ? 6 : day - 1;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() - offset);
  }

  function formatMonthDay(date) {
    return (date.getMonth() + 1) + '/' + date.getDate();
  }

  function compute(now, settings) {
    const s = normalizeSettings(settings);
    const date = now instanceof Date ? now : new Date(now);
    const year = date.getFullYear();
    const month = date.getMonth();
    const day = date.getDate();

    const totalDays = daysInMonth(year, month);
    const type = dayType(date, s);
    const period = workPeriod(s);
    const fraction = fractionAt(date, s);
    const dayAmount = dayAmountForDate(date, s);
    const todayEarned = dayAmount * fraction;
    const phase = phaseAt(date, s);

    const denom = effectiveWorkdays(s, year, month);
    const monthWorkdaysAuto = countWeekdays(year, month);
    const lastSaturdayDay = lastSaturdayOfMonth(year, month);
    const lastSaturday = new Date(year, month, lastSaturdayDay);

    const firstOfMonth = new Date(year, month, 1);
    const monthProjected = sumDays(firstOfMonth, new Date(year, month, totalDays), date, s, true);
    let monthly = 0;
    for (let d = 1; d <= day; d++) {
      monthly += earnedOnDate(new Date(year, month, d), date, s);
    }

    const monday = startOfWeekMonday(date);
    const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
    const weekly = sumDays(monday, date, date, s, false);
    const weekProjected = sumDays(monday, sunday, date, s, true);

    const normalDailyAmount = denom > 0 ? (s.baseSalary + s.bonusSalary) / denom : 0;
    const saturdayAmount = denom > 0 ? (s.baseSalary / denom) * 2 : 0;
    const hourlyRate = period.totalSeconds > 0 ? dayAmount / (period.totalSeconds / 3600) : 0;

    return {
      now: date,
      year,
      month,
      day,
      dateLabel: (month + 1) + '月' + day + '日 ' + WEEKDAY_NAMES[date.getDay()],
      monthLabel: (month + 1) + '月',
      weekRangeLabel: formatMonthDay(monday) + ' - ' + formatMonthDay(sunday),
      dayType: type,
      phase,
      fraction,
      dayAmount,
      todayEarned,
      todayRemaining: Math.max(0, dayAmount - todayEarned),
      monthly,
      weekly,
      monthProjected,
      weekProjected,
      monthPercent: monthProjected > 0 ? Math.min(1, monthly / monthProjected) : 0,
      weekPercent: weekProjected > 0 ? Math.min(1, weekly / weekProjected) : 0,
      countdownSeconds: remainingSecondsAt(date, s),
      remainingWorkSeconds: Math.max(0, period.totalSeconds * (1 - fraction)),
      totalWorkSeconds: period.totalSeconds,
      effectiveWorkdays: denom,
      autoWorkdays: monthWorkdaysAuto,
      standardWorkdays: s.standardWorkdays,
      useActualWorkdays: s.useActualWorkdays,
      normalDailyAmount,
      saturdayAmount,
      hourlyRate,
      lastSaturday,
      lastSaturdayLabel: (month + 1) + '月' + lastSaturdayDay + '日',
      isLastSaturdayToday: type === 'overtime'
    };
  }

  return {
    // 常量
    WEEKDAY_NAMES,
    // 工具
    normalizeSettings,
    daysInMonth,
    countWeekdays,
    lastSaturdayOfMonth,
    isEndOfMonthSaturday,
    effectiveWorkdays,
    parseTimeToSeconds,
    workPeriod,
    dayType,
    dayAmountForDate,
    fractionAt,
    phaseAt,
    remainingSecondsAt,
    earnedOnDate,
    startOfWeekMonday,
    // 主计算
    compute
  };
});
