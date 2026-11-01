# YouTube Shorts Studio & Autonomous AI Auto-Pilot

An enterprise-grade, fully autonomous YouTube Shorts curation, formatting, and publishing suite powered by **local Apple Silicon MLX GPU acceleration**, **Google Gemini Pro fallback**, **Apple VideoToolbox hardware transcoding**, and a **Strict Anti-Repetition Duplicate Prevention Engine**.

---

## 🌟 Key Highlights & Features

* **⚡ Local Apple Silicon MLX GPU Acceleration**:
  * Runs **Qwen 3.5 9B MLX 4-bit** natively on your Mac's Metal GPU with unified memory.
  * Native multimodal AI: handles both visual keyframe quality checks and high-CTR title & description generation.
  * Generates high-CTR viral titles and rich SEO descriptions at high throughput with **zero external rate limits, zero quotas, and zero API costs**.
  * Built-in automatic background lifecycle manager (`ensureMLXServer`) that spins up the local OpenAI-compatible HTTP daemon on demand.
* **🚫 Strict Anti-Repetition Duplicate Prevention**:
  * Multi-layer canonical ID extraction engine supporting YouTube Shorts (`/shorts/`), regular videos (`/watch?v=`), short links (`youtu.be/`), and Instagram Reels (`/reel/`).
  * **Zero Double Downloads**: Pre-filters duplicate videos at 4 independent stages: scanner intake, candidate queueing, pre-download validation, and manual upload submission.
  * High-capacity persistent tracking (`history.json`) preserving canonical IDs and URLs permanently across thousands of uploads.
* **📝 Rich Video Descriptions with 25–30 Guaranteed Hashtags**:
  * Automatically extracts original context and narrative hooks to describe what actually happens in the video.
  * Formats high-conversion Calls to Action (Like, Comment, Subscribe) without external links or promotional clutter, maximizing viewer retention and YouTube recommendation velocity.
  * **Anti-Hallucination Genre Guard**: Rigorously aligns hashtags with the true content category (Anime, Gaming, Cinema, Tech) to prevent cross-genre tag leakage.
  * Dynamically populates and deduplicates **exactly 25 to 30 relevant, high-velocity hashtags** spanning niche-specific tags and universal Shorts viral tags.
* **🎯 Target Content Mix & Automatic Deficit Balancing**:
  * Define exact percentage targets for your channels and queries (e.g., 25% Anime, 25% Marvel, 25% Gaming, 25% Tech).
  * AutoPilot computes historical upload deficits from `history.json` and automatically prioritizes under-represented categories to maintain the exact desired channel distribution.
* **🛡️ Dual-Rule AI Quality & Safety Guard**:
  * **Rule 1 (AI Slop Detection)**: Rejects 100% synthetic hallucinations (Sora, Runway, Kling, Pika loops) and low-effort robotic brainrot, while approving authentic gameplay, cinema edits, and anime clips.
  * **Rule 2 (Promo Watermark Rejection)**: Rejects on-screen burnt-in promos, watermarks, or overlays directing viewers to rival YouTube channels. Title and description mentions of celebrities and actors are 100% exempt.
  * **Pre-Transcode Gate**: Evaluates raw video frames *before* transcoding, saving disk I/O and compute on rejected videos.
* **🚀 Hardware-Accelerated 9:16 Vertical Transcoding**:
  * Utilizes Apple's dedicated hardware Media Engine via `h264_videotoolbox` on macOS.
  * Converts horizontal clips to 9:16 vertical format (1080x1920 $\le 59.5$s) with blurred ambient backgrounds in **1–2 seconds** at master quality (18–24 Mbps).
* **🌐 Web Dashboard & Real-Time Monitoring**:
  * Sleek dark-mode Studio dashboard with live Server-Sent Events (SSE) streaming real-time download, AI reasoning, transcoding, and upload progress.

---

## 🏗️ Architecture & Pipeline Flow

```
┌─────────────────┐       ┌──────────────────────┐       ┌──────────────────────┐
│  Multi-Source   ├──────►│  Canonical Duplicate ├──────►│  Candidate Queue     │
│  Intake Scanner │       │  Prevention Engine   │       │  & Deficit Balancing │
└─────────────────┘       └──────────────────────┘       └──────────┬───────────┘
                                                                    │
                                                                    ▼
┌─────────────────┐       ┌──────────────────────┐       ┌──────────────────────┐
│ YouTube Data v3 │◄──────┤ Apple VideoToolbox   │◄──────┤ Pre-Upload AI        │
│ API Publisher   │       │ 9:16 Hardware Encode │       │ Quality Guard        │
└─────────────────┘       └──────────────────────┘       └──────────────────────┘
```

1. **Source Discovery**: Ingests candidate shorts via configured keywords, channel handles, and dynamic trending search pools.
2. **Duplicate Filtering**: Canonical 11-character video IDs are checked against `history.json`. Any previously downloaded or uploaded video is immediately discarded.
3. **AI Selection & SEO Formulation**: The local Apple Silicon MLX GPU evaluates candidate options against content distribution percentages, crafting a click-worthy title, rich description, and 25–30 hashtags.
4. **Primacy Download**: Downloads master video streams via `yt-dlp` using cookie authentication to bypass bot protections.
5. **Quality Verification**: Extracts 3 representative video keyframes and verifies compliance against slop and competitor promos.
6. **Hardware Transcoding**: FFmpeg with `h264_videotoolbox` transcodes the video to vertical 9:16 Short format in under 2 seconds.
7. **YouTube Upload**: Streams video to YouTube API v3 with real-time percentage progress, records canonical ID in history, and clears temporary files.

---

## ⚡ Local Apple Silicon MLX Engine

The AI gateway ([`lib/aiClient.js`](lib/aiClient.js)) connects directly to Apple's **MLX** framework running on Apple Silicon unified memory:

* **Default Local Model**: [`mlx-community/Qwen3.5-9B-MLX-4bit`](https://huggingface.co/mlx-community/Qwen3.5-9B-MLX-4bit) (~5.6 GB memory footprint).
* **High-Performance Intelligence**: Qwen 3.5 9B on Metal GPU for rapid viral metadata generation and visual content compliance.
* **Instant Structured JSON**: Automatically configures `enable_thinking: false` in the MLX chat template, producing direct JSON without reasoning token latency.
* **Multimodal Vision Readiness**: Architecture prepared with `mlx-vlm` support for local vision-language model keyframe inspection.
* **Automated Daemon**: Node automatically launches the server on port `8080` if not already running.
* **Cloud Fallback**: Automatically cascades to Google Gemini (`gemini-3.8-flash` with 1,500 req/day quota) if MLX is unreachable or explicitly disabled.

### Useful MLX Commands
```bash
# Start the background MLX server manually (with thinking disabled):
npm run mlx:start

# Interactive terminal chat with Qwen 3.5 9B:
npm run mlx:chat

# Or directly with Python:
.venv-mlx/bin/python -m mlx_lm chat --model mlx-community/Qwen3.5-9B-MLX-4bit

# Run quick one-off generation:
.venv-mlx/bin/python -m mlx_lm generate --model mlx-community/Qwen3.5-9B-MLX-4bit --prompt "Write 3 viral short titles for GTA 6"
```

---

## 🚫 Anti-Repetition & Duplicate Prevention

To guarantee your YouTube channel never uploads the same video twice:

* **Canonical Normalization**: Standardizes URLs across all variations:
  * `https://youtube.com/shorts/DManF7dWTJM` ➔ `DManF7dWTJM`
  * `https://www.youtube.com/watch?v=DManF7dWTJM` ➔ `DManF7dWTJM`
  * `https://youtu.be/DManF7dWTJM` ➔ `DManF7dWTJM`
  * `https://instagram.com/reel/C-xyz123/` ➔ `C-xyz123`
* **4-Gate Enforcement**:
  1. **Scanner Intake Gate**: Skips known videos before candidate extraction completes.
  2. **AutoPilot Pool Gate**: Filters remaining candidates before sending prompts to the AI.
  3. **Pre-Download Gate**: Validates the winning video's canonical ID right before triggering network download.
  4. **Manual Upload Gate**: Rejects duplicate URLs pasted into the single-video upload form.
* **Persistent History**: `history.json` retains up to 5,000 processed videos (both uploaded and permanently rejected), preventing duplicates across days, weeks, and months.

---

## 📝 Video Descriptions & 25–30 Hashtags Engine

Every generated video description adheres to a strict SEO formula:

1. **Context-Aware Summary**: 2–3 engaging sentences explaining the specific highlight, gameplay clutch, or scene.
2. **Call to Action (CTA)**: Encourages engagement (`Drop a like if you enjoyed this, share your thoughts in the comments, and don't forget to subscribe for more daily shorts!`).
3. **Anti-Hallucination Genre Guard**: Filters and locks hashtags strictly to the detected genre (Anime, Gaming, Marvel/Cinema, Tech), preventing cross-genre contamination (e.g. no gaming hashtags on movie edits).
4. **Hashtag Bank (Guaranteed 25–30 Tags)**:
   * **Anime**: `#shorts #anime #animedit #jujutsukaisen #demonslayer #naruto #onepiece #otaku #animefight #amv ...`
   * **Gaming**: `#shorts #gaming #minecraft #gta6 #eldenring #valorant #clutch #gamers #gameplay #nextgen ...`
   * **Marvel / Film**: `#shorts #marvel #avengers #mcu #doomsday #cinema #cinematography #hollywood #filmtok ...`
   * **Tech / Innovation**: `#shorts #technology #tech #innovation #gadgets #ai #robotics #futuretech #smartdevices ...`
   * **Viral Velocity**: `#shorts #viral #trending #fyp #foryou #viralshorts #trendingshorts #explore #reels ...`

---

## 📋 Prerequisites

* **Operating System**: macOS 13.5+ (Optimized for Apple Silicon M1 / M2 / M3 / M4)
* **Node.js**: v18.0.0 or higher
* **Python**: 3.10+ (Homebrew Python 3.12 recommended)
* **System Binaries**:
  ```bash
  brew install ffmpeg yt-dlp
  ```

---

## 🚀 Quick Setup & Installation

### 1. Clone the Repository
```bash
git clone https://github.com/DINESH-1121/yt-shorts-uploader.git
cd yt-shorts-uploader
```

### 2. Install Node Dependencies
```bash
npm install
```

### 3. Set Up Local MLX Environment (Apple Silicon)
```bash
# Create dedicated Python virtual environment:
/opt/homebrew/bin/python3.12 -m venv .venv-mlx

# Install Apple Silicon Metal MLX packages (including Vision-Language support):
.venv-mlx/bin/pip install mlx mlx-lm mlx-vlm
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
# Place a Netscape-formatted cookies.txt in the project root:
YTDLP_COOKIES=cookies.txt
# Alternatively, read cookies directly from your browser:
# YTDLP_COOKIES_FROM_BROWSER=chrome
```

> [!TIP]
> **Bypassing YouTube "Sign in to confirm you're not a bot" checks**:
> YouTube actively blocks anonymous video downloads. To ensure smooth automated downloads:
> 1. Export your logged-in YouTube session cookies using a browser extension (such as *Get cookies.txt LOCALLY*) and save it as `cookies.txt` in the root folder.
> 2. Alternatively, set `YTDLP_COOKIES_FROM_BROWSER=chrome` in `.env`. If using macOS, grant **Full Disk Access** to your Terminal / IDE in *System Settings ➔ Privacy & Security* so Node can read Chrome's cookie database.

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
    "intervalValue": 30,
    "intervalUnit": "minutes"
  },
  "sources": [
    {
      "type": "keyword",
      "url": "Anime",
      "name": "Anime Highlights",
      "percentage": 25
    },
    {
      "type": "keyword",
      "url": "Marvel Avengers Doomsday",
      "name": "Marvel & Cinema",
      "percentage": 25
    },
    {
      "type": "keyword",
      "url": "insane viral gaming clips shorts",
      "name": "Gaming Clutches",
      "percentage": 25
    },
    {
      "type": "keyword",
      "url": "futuristic tech innovations gadgets shorts",
      "name": "Tech & AI",
      "percentage": 25
    }
  ],
  "maxCandidates": 12
}
```

---

## 🛡️ License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
