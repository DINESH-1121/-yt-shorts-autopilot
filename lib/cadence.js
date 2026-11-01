const cron = require('node-cron');

/**
 * Standard viral peak engagement hours (in local/channel time)
 */
const VIRAL_PEAKS = {
  gaming_peak: {
    label: '🎮 Worldwide Gaming Peak (12 PM, 5 PM, 9 PM)',
    cron: '0 12,17,21 * * *',
    times: ['12:00', '17:00', '21:00']
  },
  afternoon_evening: {
    label: '🔥 Afternoon & Prime Time (2 PM, 6 PM, 10 PM)',
    cron: '0 14,18,22 * * *',
    times: ['14:00', '18:00', '22:00']
  },
  daily_triad: {
    label: '🚀 3x Daily (9 AM, 2 PM, 7 PM)',
    cron: '0 9,14,19 * * *',
    times: ['09:00', '14:00', '19:00']
  }
};

/**
 * Validates whether a cron expression is syntactically valid for node-cron
 */
function isValidCron(expr) {
  if (!expr || typeof expr !== 'string') return false;
  if (expr.trim() === 'immediate') return true;
  return cron.validate(expr.trim());
}

/**
 * Matches a specific value against a cron field segment
 */
function matchesField(val, field) {
  if (field === '*') return true;
  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2), 10);
    return !isNaN(step) && step > 0 && val % step === 0;
  }
  const parts = field.split(',');
  for (const p of parts) {
    if (p.includes('-')) {
      const [start, end] = p.split('-').map(Number);
      if (val >= start && val <= end) return true;
    } else if (parseInt(p, 10) === val) {
      return true;
    }
  }
  return false;
}

/**
 * Computes the exact next Date when the cron expression will trigger
 */
function getNextCronDate(cronExpr, fromDate = new Date()) {
  if (cronExpr === 'immediate') return fromDate;
  if (!isValidCron(cronExpr)) return null;

  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minPart, hrPart, domPart, monPart, dowPart] = parts;

  const d = new Date(fromDate.getTime());
  d.setSeconds(0);
  d.setMilliseconds(0);
  d.setMinutes(d.getMinutes() + 1); // check from the very next minute

  // Search forward up to 14 days
  const maxMinutes = 14 * 24 * 60;
  for (let i = 0; i < maxMinutes; i++) {
    const min = d.getMinutes();
    const hr = d.getHours();
    const dom = d.getDate();
    const mon = d.getMonth() + 1;
    const dow = d.getDay();

    if (
      matchesField(min, minPart) &&
      matchesField(hr, hrPart) &&
      matchesField(dom, domPart) &&
      matchesField(mon, monPart) &&
      matchesField(dow, dowPart)
    ) {
      return d;
    }
    d.setMinutes(d.getMinutes() + 1);
  }
  return null;
}

/**
 * Formats countdown time until next run
 */
function formatCountdown(targetDate, fromDate = new Date()) {
  if (!targetDate) return 'No schedule';
  const diffMs = targetDate.getTime() - fromDate.getTime();
  if (diffMs <= 0) return 'Due now';

  const totalMins = Math.round(diffMs / 60000);
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;

  if (hours === 0) {
    if (mins === 0) return 'in < 1 min';
    return `in ${mins} min${mins === 1 ? '' : 's'}`;
  }
  if (mins === 0) {
    return `in ${hours} hr${hours === 1 ? '' : 's'}`;
  }
  return `in ${hours}h ${mins}m`;
}

/**
 * Converts dynamic cadence parameters into a clean cron expression and human label
 */
function buildCronFromCadence(cadence = {}) {
  const mode = cadence.mode || 'preset';

  // 0. Immediate / Continuous Mode (No hard time set)
  if (mode === 'immediate') {
    return {
      cron: 'immediate',
      label: '⚡ Immediate Continuous (No hard time set)',
      mode: 'immediate'
    };
  }

  // 1. Preset Mode
  if (mode === 'preset') {
    const preset = cadence.preset || 'every-12h';
    const presets = {
      'immediate': { cron: 'immediate', label: '⚡ Immediate Continuous (No hard time set)' },
      'every-1m': { cron: '* * * * *', label: 'Every 1 Minute' },
      'every-15m': { cron: '*/15 * * * *', label: 'Every 15 Minutes' },
      'every-30m': { cron: '*/30 * * * *', label: 'Every 30 Minutes' },
      'every-1h': { cron: '0 * * * *', label: 'Every 1 Hour' },
      'every-2h': { cron: '0 */2 * * *', label: 'Every 2 Hours' },
      'every-3h': { cron: '0 */3 * * *', label: 'Every 3 Hours' },
      'every-4h': { cron: '0 */4 * * *', label: 'Every 4 Hours' },
      'every-6h': { cron: '0 */6 * * *', label: 'Every 6 Hours' },
      'every-12h': { cron: '0 */12 * * *', label: 'Every 12 Hours (2x Daily)' },
      'daily-9am': { cron: '0 9 * * *', label: 'Daily at 9:00 AM' },
      'daily-6pm': { cron: '0 18 * * *', label: 'Daily at 6:00 PM' }
    };
    if (presets[preset]) {
      return { cron: presets[preset].cron, label: presets[preset].label, mode: 'preset' };
    }
    return { cron: '0 */12 * * *', label: 'Every 12 Hours', mode: 'preset' };
  }

  // 2. Dynamic Interval Mode (Every N Minutes / Hours / Days)
  if (mode === 'interval') {
    const val = Math.max(1, parseInt(cadence.intervalValue || 2, 10));
    const unit = cadence.intervalUnit || 'hours';

    if (unit === 'minutes') {
      const requested = Math.min(59, val);
      const cronStr = requested === 1 ? '* * * * *' : `*/${requested} * * * *`;
      return {
        cron: cronStr,
        label: `Every ${requested} Minute${requested === 1 ? '' : 's'}`,
        mode: 'interval'
      };
    }

    if (unit === 'hours') {
      // Values >= 24h are day-based schedules, not an odd */23 hour cron.
      if (val >= 24) {
        const days = Math.min(30, Math.max(1, Math.round(val / 24)));
        const hour = parseInt(cadence.dailyHour || 12, 10);
        const cronStr = days === 1 ? `0 ${hour} * * *` : `0 ${hour} */${days} * *`;
        return {
          cron: cronStr,
          label: `Every ${days} Day${days === 1 ? '' : 's'} at ${hour}:00`,
          mode: 'interval'
        };
      }
      const clamped = Math.min(23, val);
      const cronStr = clamped === 1 ? '0 * * * *' : `0 */${clamped} * * *`;
      return {
        cron: cronStr,
        label: `Every ${clamped} Hour${clamped === 1 ? '' : 's'}`,
        mode: 'interval'
      };
    }

    if (unit === 'days') {
      const clamped = Math.min(30, val);
      const hour = parseInt(cadence.dailyHour || 12, 10);
      const cronStr = clamped === 1 ? `0 ${hour} * * *` : `0 ${hour} */${clamped} * *`;
      return {
        cron: cronStr,
        label: `Every ${clamped} Day${clamped === 1 ? '' : 's'} at ${hour}:00`,
        mode: 'interval'
      };
    }
  }

  // 3. Viral Peak Hours Mode
  if (mode === 'peak_hours') {
    const peakKey = cadence.peakPreset || 'gaming_peak';
    const peak = VIRAL_PEAKS[peakKey] || VIRAL_PEAKS.gaming_peak;
    return {
      cron: peak.cron,
      label: peak.label,
      mode: 'peak_hours'
    };
  }

  // 4. Specific Times of Day (e.g. 11:00, 18:30)
  if (mode === 'specific_times') {
    let times = Array.isArray(cadence.specificTimes)
      ? cadence.specificTimes
      : String(cadence.specificTimes || '12:00,19:00').split(',').map(s => s.trim()).filter(Boolean);

    if (times.length === 0) times = ['12:00', '19:00'];

    // Group hours that share minute 0
    const hours = [];
    times.forEach(t => {
      const [h] = t.split(':').map(Number);
      if (!isNaN(h) && h >= 0 && h <= 23 && !hours.includes(h)) {
        hours.push(h);
      }
    });

    hours.sort((a, b) => a - b);
    const hrStr = hours.join(',');
    const label = `Daily at ${times.join(', ')}`;
    return {
      cron: `0 ${hrStr || '12'} * * *`,
      label,
      mode: 'specific_times'
    };
  }

  // 5. Custom Cron Expression Mode
  if (mode === 'custom') {
    const expr = (cadence.customCron || '').trim();
    if (isValidCron(expr)) {
      return {
        cron: expr,
        label: `Custom Cron: "${expr}"`,
        mode: 'custom'
      };
    }
    return {
      cron: '0 */12 * * *',
      label: 'Invalid cron, default Every 12 Hours',
      mode: 'custom',
      error: 'Invalid cron format (must be 5 space-separated parts)'
    };
  }

  return { cron: '0 */12 * * *', label: 'Every 12 Hours', mode: 'preset' };
}

/**
 * Returns human-readable description and next execution preview for any cron expression
 */
function getScheduleInfo(cronExpr, cadenceConfig = null) {
  const expr = (cronExpr || '0 */12 * * *').trim();
  if (expr === 'immediate' || cadenceConfig?.mode === 'immediate') {
    return {
      valid: true,
      cron: 'immediate',
      label: '⚡ Immediate Continuous (No hard time set)',
      nextRunDate: new Date().toISOString(),
      nextRunFormatted: 'Immediate (Continuous)',
      countdown: 'Immediate (No time set)',
      peaks: VIRAL_PEAKS
    };
  }

  const valid = isValidCron(expr);
  const now = new Date();
  const nextDate = valid ? getNextCronDate(expr, now) : null;

  let label = cadenceConfig?.scheduleLabel || '';
  if (!label) {
    if (expr === '* * * * *' || expr === '*/1 * * * *') label = 'Every 1 Minute';
    else if (expr === '*/15 * * * *') label = 'Every 15 Minutes';
    else if (expr === '*/30 * * * *') label = 'Every 30 Minutes';
    else if (expr === '0 * * * *') label = 'Every 1 Hour';
    else if (expr === '0 */2 * * *') label = 'Every 2 Hours';
    else if (expr === '0 */4 * * *') label = 'Every 4 Hours';
    else if (expr === '0 */6 * * *') label = 'Every 6 Hours';
    else if (expr === '0 */12 * * *') label = 'Every 12 Hours (2x Daily)';
    else if (expr === '0 9 * * *') label = 'Daily at 9:00 AM';
    else if (expr === '0 18 * * *') label = 'Daily at 6:00 PM';
    else if (expr === '0 12,17,21 * * *') label = '🎮 Worldwide Gaming Peak (12 PM, 5 PM, 9 PM)';
    else label = `Schedule: ${expr}`;
  }

  return {
    valid,
    cron: expr,
    label,
    nextRunDate: nextDate ? nextDate.toISOString() : null,
    nextRunFormatted: nextDate ? nextDate.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'None',
    countdown: nextDate ? formatCountdown(nextDate, now) : 'Disabled',
    peaks: VIRAL_PEAKS
  };
}

module.exports = {
  VIRAL_PEAKS,
  isValidCron,
  getNextCronDate,
  formatCountdown,
  buildCronFromCadence,
  getScheduleInfo
};
