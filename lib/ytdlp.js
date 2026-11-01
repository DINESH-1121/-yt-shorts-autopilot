/**
 * Shared yt-dlp authentication helpers.
 *
 * YouTube now serves a "Sign in to confirm you're not a bot" challenge to
 * anonymous clients on many networks, which no player_client workaround
 * bypasses reliably. The supported fix is authenticating yt-dlp with a browser
 * cookie jar, configured through environment variables:
 *
 *   YTDLP_COOKIES=/path/to/cookies.txt     # exported Netscape cookie file
 *   YTDLP_COOKIES_FROM_BROWSER=chrome      # chrome | edge | safari | firefox ...
 *   YTDLP_PLAYER_CLIENT=default            # optional extractor override
 *
 * YTDLP_COOKIES wins when both are set.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');

let _cachedAuthArgs = null;

function resetAuthArgsCache() {
  _cachedAuthArgs = null;
}

/**
 * Auth/extractor args to prepend to any yt-dlp invocation.
 */
function authArgs() {
  if (_cachedAuthArgs !== null) {
    return [..._cachedAuthArgs];
  }

  const args = [];

  const cookiesFile = (process.env.YTDLP_COOKIES || '').trim();
  let cookiesPassed = false;

  if (cookiesFile) {
    const resolved = path.isAbsolute(cookiesFile) ? cookiesFile : path.join(PROJECT_ROOT, cookiesFile);
    if (fs.existsSync(resolved)) {
      try {
        fs.accessSync(resolved, fs.constants.R_OK);
        args.push('--cookies', resolved);
        cookiesPassed = true;
      } catch (permErr) {
        console.warn(`[ytDlp] ⚠️ YTDLP_COOKIES exists at ${resolved} but cannot be read (macOS permission/EPERM). Checking project root...`);
      }
    } else {
      console.warn(`[ytDlp] YTDLP_COOKIES points to a missing file: ${resolved}`);
    }
  }

  // Automatic fallback to local cookies.txt in project root if not already passed
  if (!cookiesPassed) {
    const localCookies = path.join(PROJECT_ROOT, 'cookies.txt');
    if (fs.existsSync(localCookies)) {
      try {
        fs.accessSync(localCookies, fs.constants.R_OK);
        args.push('--cookies', localCookies);
        cookiesPassed = true;
      } catch {}
    }
  }

  if (!cookiesPassed) {
    const browser = (process.env.YTDLP_COOKIES_FROM_BROWSER || '').trim();
    if (browser) {
      args.push('--cookies-from-browser', browser);
    }
  }

  const playerClient = (process.env.YTDLP_PLAYER_CLIENT || '').trim();
  if (playerClient) {
    args.push('--extractor-args', `youtube:player_client=${playerClient}`);
  }

  _cachedAuthArgs = args;
  return args;
}

/**
 * True when yt-dlp output indicates YouTube's bot/authentication challenge.
 */
function isBotCheckError(text) {
  return /sign in to confirm|confirm you.{0,3}re not a bot|not a bot|sign in to view/i.test(String(text || ''));
}

/**
 * True when the configured cookie source is unusable (no such browser profile,
 * unreadable cookie DB, unsupported browser).
 */
function isCookieConfigError(text) {
  return /could not find .*cookies database|unsupported browser|failed to decrypt cookies|operation not permitted.*cookies/i.test(String(text || ''));
}

/**
 * True when a failure needs the user to fix authentication settings.
 */
function hasAuthConfigError(text) {
  return isBotCheckError(text) || isCookieConfigError(text);
}

/**
 * Actionable message for the bot-check failure, including setup steps.
 */
function botCheckHint() {
  return 'YouTube blocked the request with a bot check. '
    + 'Fix: sign in to YouTube in a desktop browser, then set YTDLP_COOKIES_FROM_BROWSER=chrome (or edge/safari) in .env, '
    + 'or export a cookies.txt and set YTDLP_COOKIES=/path/to/cookies.txt. '
    + 'If you are on a VPN or datacenter IP, try disabling it.';
}

/**
 * Actionable message when the configured browser cookie store cannot be read.
 */
function cookieConfigHint(browser) {
  const raw = String(browser || process.env.YTDLP_COOKIES_FROM_BROWSER || 'the configured browser');
  const name = raw.charAt(0).toUpperCase() + raw.slice(1);
  return `yt-dlp could not read ${name} cookies (no browser profile, or the profile is not readable). `
    + `Open ${name}, sign in to YouTube, quit the browser completely and retry — or export a cookies.txt and set YTDLP_COOKIES=/path/to/cookies.txt. `
    + `On macOS, if ${name} is signed in but its profile still cannot be read, grant Full Disk Access to the app running this server (System Settings → Privacy & Security → Full Disk Access), then restart that app. `
    + 'To turn this off, remove YTDLP_COOKIES_FROM_BROWSER from .env (search-only scanning works without cookies).';
}

/**
 * Decorates an error message for a failed yt-dlp run with an actionable hint.
 */
function describeError(rawError) {
  const text = String(rawError || '');
  if (isBotCheckError(text)) {
    return `${botCheckHint()} (yt-dlp said: ${text.replace(/\s+/g, ' ').slice(0, 180)})`;
  }
  if (isCookieConfigError(text)) {
    const browserMatch = text.match(/could not find (\w+) cookies database/i);
    return cookieConfigHint(browserMatch ? browserMatch[1] : undefined);
  }
  return text;
}

module.exports = {
  authArgs,
  resetAuthArgsCache,
  isBotCheckError,
  isCookieConfigError,
  hasAuthConfigError,
  botCheckHint,
  cookieConfigHint,
  describeError,
  PROJECT_ROOT
};
