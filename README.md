# YouTube Shorts Studio & Autonomous AI Auto-Pilot

An enterprise-grade, fully autonomous YouTube Shorts curation, formatting, and publishing suite powered by **local Apple Silicon MLX GPU acceleration**, **Beat-Sync Phonk audio mixing**, **Dynamic Visual Hooks**, **Google Font Pirata One animated watermarking**, **Apple VideoToolbox hardware transcoding**, and a **Strict Anti-Repetition Duplicate Prevention Engine**.

---

## 🌟 Key Highlights & Features

* **⚡ Local Apple Silicon MLX GPU Acceleration**:
  * Runs **Qwen 3.5 9B MLX 4-bit** natively on your Mac's Metal GPU with unified memory.
  * Native multimodal AI: handles both visual keyframe quality checks and high-CTR title & description generation.
  * Generates high-CTR viral titles and rich SEO descriptions at high throughput with **zero external rate limits, zero quotas, and zero API costs**.
  * Built-in automatic background lifecycle manager (`ensureMLXServer`) that spins up the local OpenAI-compatible HTTP daemon on demand.
  * Cloud fallback to **Google Gemini** (`gemini-3.8-flash`) if MLX is unavailable.
* **🎵 Beat-Sync Phonk Audio & Dialogue Ducking Pipeline**:
  * Automatically mixes Brazilian Phonk and high-energy drift phonk (e.g., `MONTAGEM ALQUIMIA`) with raw video audio.
  * **Intelligent Dialogue Ducking**: Prioritizes dialogue and punchy sound effects at 18% ducking volume while keeping phonk bass lines at full 100% prominence.
  * **EBU R128 Loudness Normalization**: Automatically normalizes audio to **-14 LUFS** with a **-1.0 dBFS true peak ceiling**, preventing audio clipping, distortion, or quiet playback on mobile devices.
* **⚡ Dynamic Visual Hook Engine (0.0s – 2.5s)**:
  * Renders an attention-grabbing frosted-glass hook banner in the upper third safe zone (`y = 0.16`), completely clear of the YouTube Shorts UI header.
  * Formulates curiosity-inducing, emotional hook titles (e.g. *"The Shadow Monarch Awakens 💀"*) to arrest viewer attention in the first 3 seconds, pushing viewer hold rates well above 80%.
* **🏷️ Viral Watermark Overlay with Google Font Pirata One**:
  * Exact replica of the viral YouTube Short format (e.g., [`https://www.youtube.com/shorts/cBqrI_M4h6s`](https://www.youtube.com/shorts/cBqrI_M4h6s)).
  * **Stacked Typography**: Crisp, tracked uppercase sans-serif (`MADE BY`) paired with viral gothic blackletter typography in Google Font **Pirata One** (`assets/fonts/PirataOne-Regular.ttf`).
  * **Organically Floating**: Text floats directly on the footage with ambient dark drop shadows (`rgba(0,0,0,0.95)`, blur: `8px`)—no bulky rounded background pill boxes.
  * **Smooth 3-Phase Cursor Animation**:
    * **Phase 1 (Reveal In, 0.6s)**: A glowing vertical white cursor bar (`3px` wide, white glow) slides left-to-right (`easeOutCubic`), unmasking text smoothly.
    * **Phase 2 (Hold, 3.0s)**: Full text remains visible; cursor blinks softly on hold then gracefully fades out.
    * **Phase 3 (Wipe Out, 0.5s)**: Cursor bar slides back right-to-left (`easeInCubic`), cleanly wiping the text away.
  * Positioned in the lower-third safe zone (`y = 0.82`) above YouTube title and action buttons.
* **🔁 Seamless Looping Mode (>100% APV Retention)**:
  * End cards are disabled by default (`enableEndCard: false`) to ensure uninterrupted, seamless loop transitions.
  * Infinite loops incentivize repeat views, driving Average Percentage Viewed (APV) well over 100%—a critical algorithmic signal for Shorts feed recommendation velocity.
* **🚫 Strict Anti-Repetition Duplicate Prevention**:
  * Multi-layer canonical ID extraction engine supporting YouTube Shorts (`/shorts/`), regular videos (`/watch?v=`), short links (`youtu.be/`), and Instagram Reels (`/reel/`).
  * **Zero Double Downloads**: Pre-filters duplicate videos across 4 independent gates: scanner intake, candidate queueing, pre-download validation, and manual upload submission.
  * Persistent tracking (`history.json`) permanently retains canonical IDs across thousands of uploads.
* **📊 Algorithmic Cadence & Daily Quota Guard**:
  * Enforces an optimal posting cadence of **3–4 Shorts per day**, spacing uploads evenly across peak viewer traffic windows.
  * Built-in daily quota tracking in `lib/store.js` prevents excessive bursts that could trigger spam flags or algorithmic shadowbans.
  * Scanner sweet-spot filter (`12s–58s`) automatically skips clips that are too short to hook or exceed YouTube's 60s Shorts threshold.
* **🛡️ Dual-Rule AI Quality & Safety Guard**:
  * **Rule 1 (AI Slop Detection)**: Rejects 100% synthetic hallucinations (Sora, Runway, Kling, Pika loops) and low-effort robotic brainrot, while approving authentic gameplay, cinema edits, and anime clips.
  * **Rule 2 (Promo Watermark Rejection)**: Rejects on-screen burnt-in promos, watermarks, or overlays directing viewers to rival channels. Title and description mentions of celebrities and actors are 100% exempt.
  * **Pre-Transcode Gate**: Evaluates raw video frames *before* transcoding, saving disk I/O and compute on rejected videos.
* **🚀 Hardware-Accelerated 9:16 Vertical Transcoding**:
  * Utilizes Apple's dedicated hardware Media Engine via `h264_videotoolbox` on macOS.
  * Converts clips to 9:16 vertical format (1080x1920) with blurred ambient backgrounds in **1–2 seconds** with color grading and 1.03x speed shift for perceptual hash evasion.
* **🌐 Web Dashboard & Real-Time Monitoring**:
  * Sleek dark-mode Studio dashboard with live Server-Sent Events (SSE) streaming real-time download, AI reasoning, audio mixing, and upload progress.

---

## 🏗️ Architecture & Pipeline Flow

```
┌──────────────────┐       ┌──────────────────────┐       ┌──────────────────────┐
│  Multi-Source    ├──────►│  Canonical Duplicate ├──────►│  Duration Sweet-Spot  │
│  Intake Scanner  │       │  Prevention Engine   │       │  Filter (12s–58s)    │
└──────────────────┘       └──────────────────────┘       └──────────┬───────────┘
                                                                     │
                                                                     ▼
┌──────────────────┐       ┌──────────────────────┐       ┌──────────────────────┐
│  Hardware 9:16   │◄──────┤  Beat-Sync Phonk     │◄──────┤  Pre-Transcode AI    │
│  Encode + EBU-R  │       │  Dialogue Ducking    │       │  Quality Guard (MLX) │
└────────┬─────────┘       └──────────────────────┘       └──────────────────────┘
         │
         ▼
┌──────────────────┐       ┌──────────────────────┐       ┌──────────────────────┐
│  Dynamic Visual  ├──────►│  Animated Pirata One ├──────►│  YouTube Data v3 API │
│  Hook (0–2.5s)   │       │  Watermark (y=0.82)  │       │  Publisher + Quota   │
└──────────────────┘       └──────────────────────┘       └──────────────────────┘
```

1. **Source Discovery**: Ingests candidate shorts via configured keywords, channel handles, and dynamic trending search pools, filtered strictly within the 12s–58s sweet spot.
2. **Duplicate Filtering**: Canonical 11-character video IDs are checked against `history.json`. Any previously downloaded or uploaded video is immediately discarded.
3. **AI Quality Verification**: Evaluates raw video keyframes against slop and competitor promos *prior* to expensive rendering steps.
4. **Beat-Sync Phonk Mixing**: Generates punchy Brazilian Phonk backing tracks with 18% dialogue ducking and BPM beat alignment.
5. **Hardware Transcoding & Hash Evasion**: Transcodes to 9:16 vertical format with ambient blur, color shift, 1.03x speed shift, and EBU R128 (-14 LUFS) loudness normalization in seamless looping mode.
6. **Dynamic Visual Hook**: Overlays a frosted-glass visual hook banner during 0.0s–2.5s in the upper third (`y=0.16`).
7. **Animated Pirata One Watermark**: Renders a glowing cursor-reveal and wipe watermark overlay featuring `Pirata One` gothic typography at `y=0.82`.
8. **Publishing & Quota Tracking**: Streams the finalized Short to YouTube API v3 with optimized titles and 25–30 niche hashtags, updating the daily quota tracker (3–4 shorts/day limit).

---

## ⚡ Local Apple Silicon MLX Engine

The AI gateway ([`lib/aiClient.js`](lib/aiClient.js)) connects directly to Apple's **MLX** framework running on Apple Silicon unified memory:

* **Default Local Model**: [`mlx-community/Qwen3.5-9B-MLX-4bit`](https://huggingface.co/mlx-community/Qwen3.5-9B-MLX-4bit) (~5.6 GB memory footprint).
* **High-Performance Intelligence**: Qwen 3.5 9B on Metal GPU for rapid viral metadata generation and visual content compliance.
* **Instant Structured JSON**: Automatically configures `enable_thinking: false` in the MLX chat template, producing direct JSON without reasoning token latency.
* **Automated Daemon**: Node automatically launches the server on port `8080` if not already running.
* **Cloud Fallback**: Automatically cascades to Google Gemini (`gemini-3.8-flash`) if MLX is unreachable or explicitly disabled.

### Useful MLX Commands
```bash
# Start the background MLX server manually (with thinking disabled):
npm run mlx:start

# Interactive terminal chat with Qwen 3.5 9B:
npm run mlx:chat

# Or directly with Python:
.venv-mlx/bin/python -m mlx_lm chat --model mlx-community/Qwen3.5-9B-MLX-4bit
```

---

## 🧪 Testing & Validation Suite

The project includes unit tests and a local end-to-end validation short generator:

```bash
# 1. Test Animated Watermark (Pirata One, cursor reveal, hold, wipe, buffer sizes):
node test-watermark.js

# 2. Test Dynamic Visual Hook Banner:
node test-visual-hook.js

# 3. Test Beat-Sync Phonk Pipeline & Dialogue Ducking:
node test-beat-sync-pipeline.js

# 4. Test AI Quality & Slop Checker:
node test-quality-checker.js

# 5. Test 9:16 Shorts Formatter & End Card Engine:
node test-endcard-formatter.js

# 6. Generate a full 10-second validation sample Short (NO YouTube upload):
node scripts/generate_sample_validation_short.js 10
```

> [!NOTE]
> `scripts/generate_sample_validation_short.js` runs the entire production pipeline (beat-sync phonk, EBU R128 normalization, visual hook banner, and cursor-reveal watermark) and outputs a sample video to [`downloads/validation_sample_short.mp4`](downloads/validation_sample_short.mp4) without uploading to YouTube.

---

## 📋 Prerequisites

* **Operating System**: macOS 13.5+ (Optimized for Apple Silicon M1 / M2 / M3 / M4)
* **Node.js**: v18.0.0 or higher
* **Python**: 3.10+ (Homebrew Python 3.12 recommended)
* **System Binaries**:
  ```bash
  brew install ffmpeg yt-dlp pkg-config cairo pango libpng jpeg giflib librsvg
  ```

---

## 🚀 Quick Setup & Installation

### 1. Clone the Repository
```bash
git clone https://github.com/DINESH-1121/-yt-shorts-autopilot.git
cd -yt-shorts-autopilot
```

### 2. Install Node Dependencies
```bash
npm install
```

### 3. Set Up Local MLX Environment (Apple Silicon)
```bash
# Create dedicated Python virtual environment:
/opt/homebrew/bin/python3.12 -m venv .venv-mlx

# Install Apple Silicon Metal MLX packages:
.venv-mlx/bin/pip install mlx mlx-lm mlx-vlm scipy numpy
```

### 4. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Edit `.env` with your Google Cloud OAuth credentials and preferences:
```env
# Google OAuth 2.0 Credentials (from Google Cloud Console)
CLIENT_ID=your_client_id_here.apps.googleusercontent.com
CLIENT_SECRET=your_client_secret_here

# Server Port
PORT=3000

# Local Apple Silicon MLX GPU Configuration
USE_MLX=true
MLX_MODEL=mlx-community/Qwen3.5-9B-MLX-4bit
MLX_BASE_URL=http://127.0.0.1:8080

# Cloud Fallback (Optional)
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-3.8-flash
DISABLE_OPENCODE=true

# YouTube Bot Bypass & Cookie Authentication
YTDLP_COOKIES=cookies.txt
# Alternatively: YTDLP_COOKIES_FROM_BROWSER=chrome

# Animated Watermark Overlay (Viral Pirata One Style)
WATERMARK_TEXT=MADE BY @YOURCHANNEL
WATERMARK_START_TIME=1.0
WATERMARK_OPACITY=0.95
WATERMARK_Y_POSITION=0.82

# End Card Configuration (disabled by default for seamless looping)
ENABLE_END_CARD=false
ENDCARD_PATH=assets/End Cards Shorts.mp4
```

> [!TIP]
> **Bypassing YouTube "Sign in to confirm you're not a bot" checks**:
> Export your logged-in YouTube session cookies using a browser extension (such as *Get cookies.txt LOCALLY*) and save it as `cookies.txt` in the root folder, or set `YTDLP_COOKIES_FROM_BROWSER=chrome` in `.env`.

### 5. Set Up Google Cloud OAuth
1. Visit the [Google Cloud Console](https://console.cloud.google.com/) and create a project.
2. Enable the **YouTube Data API v3**.
3. Create an **OAuth 2.0 Client ID** (Application type: *Web application*).
4. Add Authorized Redirect URI: `http://localhost:3000/oauth2callback`.
5. Under **OAuth consent screen ➔ Test users**, add your YouTube account email.

---

## 🎮 Running the Application

### Start the Studio Server
```bash
npm start
```
* Visit [http://localhost:3000](http://localhost:3000) in your browser.
* Click **Connect YouTube** to link your channel.
* Configure your AutoPilot schedule, percentage weights, and topic sources.
* Click **Save & Run Cycle** or let the automated cron handle publishing hands-free.

### Development Mode (Auto-Reload)
```bash
npm run dev
```

---

## ⚙️ Configuration File Reference (`autopilot-config.json`)

```json
{
  "enabled": true,
  "privacy": "public",
  "cadence": {
    "mode": "interval",
    "intervalValue": 360,
    "intervalUnit": "minutes"
  },
  "sources": [
    {
      "type": "keyword",
      "url": "Anime edits 4k 60fps shorts",
      "name": "Anime Highlights",
      "percentage": 50
    },
    {
      "type": "keyword",
      "url": "Marvel cinema edits shorts",
      "name": "Marvel & Cinema",
      "percentage": 50
    }
  ],
  "maxCandidates": 12,
  "watermarkText": "MADE BY @YOURCHANNEL",
  "enableEndCard": false
}
```

---

## 🛡️ License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
