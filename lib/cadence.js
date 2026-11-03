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

  // 0. Immediate Mode / Burst Protection: Allow 4-24 hour interval
  if (mode === 'immediate') {
    return {
      cron: '0 */5 * * *',
      label: 'Every 5 Hours (Continuous Safe Mode)',
      mode: 'interval'
    };
  }

  // 1. Preset Mode (Enforces 4–24 hours interval: safe within YouTube daily quota)
  if (mode === 'preset') {
    const preset = cadence.preset || 'every-5h';
    const presets = {
      'every-4h': { cron: '0 */4 * * *', label: 'Every 4 Hours (6x Daily - Max Safe Quota)' },
      'every-5h': { cron: '0 */5 * * *', label: 'Every 5 Hours (~5x Daily - Safe Quota Limit)' },
      'every-6h': { cron: '0 */6 * * *', label: 'Every 6 Hours (4x Daily)' },
      'every-8h': { cron: '0 */8 * * *', label: 'Every 8 Hours (3x Daily)' },
      'every-12h': { cron: '0 */12 * * *', label: 'Every 12 Hours (2x Daily - Recommended)' },
      'every-24h': { cron: '0 18 * * *', label: 'Every 24 Hours (1x Daily)' },
      'daily-6pm': { cron: '0 18 * * *', label: 'Daily at 6:00 PM (18:00 IST / Prime Time)' },
      'daily-9pm': { cron: '0 21 * * *', label: 'Daily at 9:00 PM (21:30 IST Prime Time)' }
    };
    if (presets[preset]) {
      return { cron: presets[preset].cron, label: presets[preset].label, mode: 'preset' };
    }
    return { cron: '0 */5 * * *', label: 'Every 5 Hours (~5x Daily)', mode: 'preset' };
  }

  // 2. Dynamic Interval Mode: 1–24 hours (safe within YouTube daily quota)
  if (mode === 'interval') {
    const rawVal = parseInt(cadence.intervalValue || 5, 10);
    const unit = cadence.intervalUnit || 'hours';

    let hours = 5;
    if (unit === 'minutes') {
      hours = Math.max(1, Math.min(24, Math.round(rawVal / 60) || 5));
    } else if (unit === 'days') {
      hours = Math.max(1, Math.min(24, rawVal * 24));
    } else {
      hours = Math.max(1, Math.min(24, isNaN(rawVal) ? 5 : rawVal));
    }

    const cronStr = hours >= 24 ? '0 18 * * *' : `0 */${hours} * * *`;
    return {
      cron: cronStr,
      label: `Every ${hours} Hours (${Math.round(24 / hours)}x Daily)`,
      mode: 'interval'
    };
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
    else if (expr === '0 */5 * * *') label = 'Every 5 Hours (~5x Daily)';
    else if (expr === '0 */6 * * *') label = 'Every 6 Hours';
    else if (expr === '0 */8 * * *') label = 'Every 8 Hours (3x Daily)';
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

/**
 * Calculates the next automated schedule slot for publishing to YouTube:
 * Strictly enforces an 8-hour spacing from the previous video:
 * 1. Checks upload history for the most recent video's publication time (`publishAt` or `uploadedAt`).
 * 2. If the previous video was published/scheduled:
 *    - Next video is scheduled for: previous video time + 8 hours.
 *    - If that time is in the past or < 20 mins from now (i.e. previous video was long ago),
 *      it schedules for: now + 8 hours.
 * 3. If no history exists, schedules for: now + 8 hours.
 * 4. Ensures the slot is safely in the future for YouTube Data API.
 * 5. Returns ISO string.
 */
function getNextAutoScheduleSlot({ history = [], bufferHours = 5, spacingHours = 5, fromDate = new Date() } = {}) {
  const now = fromDate instanceof Date ? fromDate : new Date(fromDate);
  const minFutureTime = now.getTime() + 20 * 60 * 1000; // at least 20m in future

  // Find the latest publication/scheduled timestamp among all uploaded videos in history
  let latestVideoMs = 0;
  if (Array.isArray(history)) {
    for (const item of history) {
      if (!item || item.status !== 'uploaded') continue;
      const timeStr = item.publishAt || item.uploadedAt;
      if (timeStr) {
        const timeMs = new Date(timeStr).getTime();
        if (!isNaN(timeMs) && timeMs > latestVideoMs) {
          latestVideoMs = timeMs;
        }
      }
    }
  }

  // Slight natural jitter (±2 minutes) so automated posts don't look like exact robotic seconds
  const jitterMs = (Math.floor(Math.random() * 5) - 2) * 60 * 1000;

  let targetMs;
  if (latestVideoMs > 0) {
    const candidateNextMs = latestVideoMs + (spacingHours * 3600 * 1000) + jitterMs;
    // If previous video + 8h is safely in the future, use it to strictly maintain 8-hour gap
    if (candidateNextMs >= minFutureTime) {
      targetMs = candidateNextMs;
    } else {
      // Previous video was published more than 8h ago; schedule 8h from now
      targetMs = now.getTime() + (bufferHours * 3600 * 1000) + jitterMs;
    }
  } else {
    // First upload: bufferHours from now
    targetMs = now.getTime() + (bufferHours * 3600 * 1000) + jitterMs;
  }

  // Ensure targetMs is safely in the future
  if (targetMs < minFutureTime) {
    targetMs = minFutureTime;
  }

  return new Date(targetMs).toISOString();
}

/**
 * Calculates the next optimal publishing slot for YouTube Shorts:
 * Slots: 18:00 IST (12:30 UTC) or 21:30 IST (16:00 UTC) with random jitter of ±14 minutes.
 * Guarantees the scheduled timestamp is safely in the future (> 15 minutes) for YouTube Data API publishAt.
 * Returns ISO timestamp string.
 */
function calculateNextOptimalPublishSlot(fromDate = new Date()) {
  const jitterMinutes = Math.floor(Math.random() * 29) - 14; // -14 to +14 mins jitter
  const slotsUTC = [
    { hour: 12, minute: 30 }, // 18:00 IST / 12:30 UTC prime slot
    { hour: 16, minute: 0 }   // 21:30 IST / 16:00 UTC prime slot
  ];

  const candidateDates = [];
  for (let dayOffset = 0; dayOffset <= 2; dayOffset++) {
    for (const slot of slotsUTC) {
      const d = new Date(fromDate.getTime());
      d.setUTCDate(d.getUTCDate() + dayOffset);
      d.setUTCHours(slot.hour, slot.minute, 0, 0);
      const scheduled = new Date(d.getTime() + jitterMinutes * 60 * 1000);
      // Scheduled time must be at least 15 minutes in the future for YouTube publishAt
      if (scheduled.getTime() > fromDate.getTime() + 15 * 60 * 1000) {
        candidateDates.push(scheduled);
      }
    }
  }

  candidateDates.sort((a, b) => a.getTime() - b.getTime());
  return candidateDates[0].toISOString();
}

module.exports = {
  VIRAL_PEAKS,
  isValidCron,
  getNextCronDate,
  formatCountdown,
  buildCronFromCadence,
  getScheduleInfo,
  calculateNextOptimalPublishSlot,
  getNextAutoScheduleSlot
};
