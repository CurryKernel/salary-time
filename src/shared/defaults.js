(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SalaryDefaults = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_SETTINGS = Object.freeze({
    // 薪资
    baseSalary: 20000,
    bonusSalary: 5000,
    // 工作时间
    workStart: '09:00',
    workEnd: '18:00',
    lunchStart: '12:00',
    lunchEnd: '13:00',
    // 手动添加的周六 / 周日加班：{ date: 'YYYY-MM-DD', workStart, workEnd, compTime }
    overtimeDays: [],
    // 手动加班日固定休息时段（全局，可设置）
    overtimeRests: [
      { start: '12:00', end: '13:30' },
      { start: '18:00', end: '18:30' }
    ],
    // 本月调休兑换：按加班时薪把若干小时调休兑换为工资
    compConversion: { enabled: false, hours: 0 },
    // 五险一金（个人缴纳部分）：base 为 null 时使用基础工资
    insurance: {
      base: null,
      social: { enabled: true, mode: 'ratio', ratio: 10.5, amount: 0 },
      housingFund: { enabled: true, mode: 'ratio', ratio: 5, amount: 0 }
    },
    // 个税：简化模型，手动税率 + 每月减免额度，减除费用固定 5000
    tax: { rate: 10, monthlyReduction: 0 },
    // 党费：固定金额，在个税后扣除
    partyDues: 0,
    // 窗口 / 系统
    alwaysOnTop: true,
    moneyEffect: false,
    // 外观
    theme: 'dark',
    customBackground: '',
    backgroundOpacity: 0.55,
    // 每天自动检查更新；autoInstallUpdates 为 true 时在凌晨静默安装
    autoUpdateCheck: true,
    autoInstallUpdates: true,
    openAtLogin: false,
    windowBounds: null
  });

  return { DEFAULT_SETTINGS };
});
