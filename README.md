# ⛳ Fairway Tracker

A personal golf practice and round tracker with AI-powered coaching. Log range sessions and rounds with detailed stats, track your game over time, and get personalized coaching advice powered by Claude AI.

## What It Does

- **Log Sessions** — Track range sessions (practice areas, ball count, notes) and rounds (course, score, FIR, GIR, putts, penalties, scrambling, tees played, conditions)
- **Course Search** — Type-ahead course search powered by GolfCourseAPI.com with auto-fill for par, tees (with slope, rating, yardage), city, and state. Results are cached locally to stay within the free API tier. Manual entry fallback available
- **Pre-Session Intentions** — Set a focus for each session so the AI coach can track follow-through
- **Confidence Ratings** — Rate your confidence in Driver, Irons, Short Game, Putting, and Course Management (1-5)
- **Voice Memos** — Upload a voice recording and let AI auto-fill the form (extracts all fields including round stats and conditions)
- **Dashboard** — Stat cards with animated count-up, charts for practice frequency, feel trends, score trends, FIR/GIR/putts trends, practice focus distribution, and a confidence radar chart
- **Session History** — Browse past sessions with round stats pills, conditions, intentions, and AI-parsed insights
- **AI Coaching** — Get personalized advice and game summaries that factor in round stats, confidence trends, intentions, conditions, and equipment changes

## Prerequisites

- **Python 3.10+** — [Download Python](https://www.python.org/downloads/)
- **Node.js 18+** — [Download Node.js](https://nodejs.org/)
- **Anthropic API Key** — [Get an API key](https://console.anthropic.com/) (required for AI features)
- **Golf Course API Key** *(optional)* — [Get a key at GolfCourseAPI.com](https://golfcourseapi.com/) (free tier: 300 requests/day — enables course search & auto-fill)
- **ffmpeg** *(optional)* — Required only for voice memo transcription
- **openai-whisper** *(optional)* — Required only for voice memo transcription

## Quick Start

### 1. Clone the repo

```bash
git clone <your-repo-url>
cd fairway-tracker
```

### 2. Set your Anthropic API key

```bash
# macOS/Linux
export ANTHROPIC_API_KEY="your-api-key-here"

# Windows (Command Prompt)
set ANTHROPIC_API_KEY=your-api-key-here

# Windows (PowerShell)
$env:ANTHROPIC_API_KEY = "your-api-key-here"
```

> **Tip:** Add the export lines to your `~/.bashrc` or `~/.zshrc` so you don't have to set them every time.

### 2b. Set your Golf Course API key *(optional)*

```bash
# macOS/Linux
export GOLF_COURSE_API_KEY="your-key-here"

# Windows (Command Prompt)
set GOLF_COURSE_API_KEY=your-key-here

# Windows (PowerShell)
$env:GOLF_COURSE_API_KEY = "your-key-here"
```

> Without this key, course search is disabled and you enter course names manually (the app works fine either way).

### 3. Start the backend

```bash
cd backend
pip install -r requirements.txt
python app.py
```

The API server will start on **http://localhost:5000**.

### 4. Start the frontend

Open a new terminal:

```bash
cd frontend
npm install
npm start
```

The app will open in your browser at **http://localhost:3000**.

## Optional: Voice Memo Support

Voice memos require **ffmpeg** and **openai-whisper** to be installed.

### Install ffmpeg

```bash
# macOS (Homebrew)
brew install ffmpeg

# Ubuntu/Debian
sudo apt install ffmpeg

# Windows (Chocolatey)
choco install ffmpeg
```

### Install Whisper

Whisper is included in `requirements.txt` but may need additional setup:

```bash
pip install openai-whisper
```

> **Note:** Whisper downloads a ~140MB model file on first use. The app works fully without voice memo support — it's completely optional.

## Features in Detail

### Enhanced Round Tracking
When logging a round, you can track:
- **FIR (Fairways in Regulation)** — out of 14
- **GIR (Greens in Regulation)** — out of 18
- **Total Putts** — per round
- **Penalties** — lost balls, OB, water
- **Up & Downs / Scrambling** — successful saves
- **Tees Played** — Championship, Blue, White, Gold, Red, or Other
- **Playing Conditions** — weather, wind, course condition

### Confidence Ratings
An optional, collapsible section on the log form lets you rate your confidence (1-5) in five areas: Driver, Irons, Short Game, Putting, and Course Management. These show up as a radar chart on the dashboard and help the AI coach identify patterns.

### Pre-Session Intentions
A "What's your focus today?" field lets you set an intention before each session. The AI coach compares intentions to actual outcomes for more targeted advice.

### Dashboard Stats
The dashboard shows animated stat cards and charts including:
- Core stats: total sessions, streak, balls hit, best/latest score, avg feel
- Round stats: avg FIR, GIR, putts, penalties, scrambling %
- Charts: weekly frequency, feel trend, focus distribution, score trend, FIR/GIR/putts trends, confidence radar

### Design
Modern, premium design inspired by Augusta National meets sports analytics:
- **Fonts:** Playfair Display (headings) + Outfit (body) via Google Fonts
- **Colors:** Deep greens, gold accents, cream/sand backgrounds, white cards
- **Animations:** Fade-in page transitions, staggered card reveals, count-up numbers, skeleton loaders, hover lift effects
- **Mobile:** Bottom navigation bar, responsive grids, touch-friendly targets

## Project Structure

```
fairway-tracker/
├── backend/
│   ├── app.py                # Flask API server (all routes)
│   ├── requirements.txt      # Python dependencies
│   └── data/                 # Auto-created data directory
│       ├── sessions.json     # Session data (auto-created)
│       └── course_cache.json # Cached course details from API (auto-created)
├── frontend/
│   ├── package.json          # React dependencies + proxy config
│   ├── public/
│   │   └── index.html        # HTML template with Google Fonts
│   └── src/
│       ├── index.js          # React entry point
│       ├── App.js            # All components (Dashboard, Log, History, Coach)
│       └── App.css           # All styles (premium golf-inspired design)
└── README.md                 # This file
```

## API Endpoints

| Method | Endpoint               | Description                                    |
|--------|------------------------|------------------------------------------------|
| GET    | `/api/sessions`        | Get all sessions (newest first)                |
| POST   | `/api/sessions`        | Create a new session (auto-parses notes with AI) |
| DELETE | `/api/sessions/:id`    | Delete a session                               |
| POST   | `/api/transcribe`      | Upload audio file for transcription + parsing  |
| GET    | `/api/stats`           | Get computed stats including round stats & confidence |
| GET    | `/api/courses/search`  | Search courses by name (requires GOLF_COURSE_API_KEY) |
| GET    | `/api/courses/:id`     | Get course details with tees (cached 30 days)  |
| GET    | `/api/coaching/advice` | Get AI coaching advice                         |
| GET    | `/api/coaching/summary`| Get AI game summary                            |

## Session Data Schema

```json
{
  "id": "unique-id-string",
  "date": "2025-02-14",
  "type": "range|round",
  "intention": "what I'm focusing on today",
  "areas": ["Driver", "Putting"],
  "ball_count": 100,
  "course": "Course Name",
  "course_id": "api-course-id",
  "course_city": "City",
  "course_state": "ST",
  "course_par": 72,
  "tee_yardage": 6200,
  "tee_slope": 128,
  "tee_rating": 70.5,
  "score": 91,
  "front_nine": 46,
  "back_nine": 45,
  "tees_played": "white",
  "fairways_hit": 7,
  "greens_in_regulation": 5,
  "total_putts": 36,
  "penalties": 2,
  "up_and_downs": 3,
  "highlights": "text",
  "trouble_spots": "text",
  "conditions": { "weather": "sunny", "wind": "moderate", "course_condition": "dry" },
  "feel_rating": 4,
  "confidence": { "driver": 4, "irons": 3, "short_game": 4, "putting": 2, "course_management": 3 },
  "notes": "free text...",
  "equipment_notes": "new driver",
  "ai_parsed": { "key_focus": "...", "positives": [], "issues": [], "swing_thoughts": [], "equipment": [] },
  "created_at": "ISO datetime"
}
```

## Data Storage

All session data is stored in `backend/data/sessions.json`. Course details fetched from the API are cached in `backend/data/course_cache.json` (30-day TTL) to minimize API calls. Both files are auto-created when needed. No database setup required.

To back up your data, just copy these files. To reset, delete them and restart the backend.

## Ideas for Future Features

Here are some ideas you could build with Claude Code:

- **Hole-by-hole scoring** — Track individual hole scores and stats per round
- **Photo uploads** — Attach swing photos or course pics to sessions
- **Goal setting** — Set practice goals and track progress toward them
- **Weather integration** — Auto-log weather conditions via API
- **Club distance tracking** — Log and track average distances per club
- **Practice plans** — AI-generated weekly practice plans based on your patterns
- **Export to CSV** — Download your session data as a spreadsheet
- **Dark mode** — Deep green/charcoal background with gold accents
- **Social sharing** — Share round summaries or milestones
- **Handicap tracking** — Calculate and track your handicap index over time
