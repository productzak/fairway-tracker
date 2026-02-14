# ⛳ Fairway Tracker

A personal golf practice and round tracker with AI-powered coaching. Log range sessions and rounds, track your stats over time, and get personalized coaching advice powered by Claude AI.

## What It Does

- **Log Sessions** — Track range sessions (practice areas, ball count, feel rating, notes) and rounds (course, score, front/back nine, highlights, trouble spots)
- **Voice Memos** — Upload a voice recording from your phone and let AI auto-fill the session form
- **Dashboard** — See your stats at a glance: session counts, streaks, scores, and charts for practice frequency, feel trends, focus distribution, and score progression
- **Session History** — Browse all your past sessions with AI-parsed insights
- **AI Coaching** — Get personalized practice advice and game summaries from an AI golf coach

## Prerequisites

- **Python 3.10+** — [Download Python](https://www.python.org/downloads/)
- **Node.js 18+** — [Download Node.js](https://nodejs.org/)
- **Anthropic API Key** — [Get an API key](https://console.anthropic.com/) (required for AI features)
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

> **Tip:** Add the export line to your `~/.bashrc` or `~/.zshrc` so you don't have to set it every time.

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

## Project Structure

```
fairway-tracker/
├── backend/
│   ├── app.py                # Flask API server (all routes)
│   ├── requirements.txt      # Python dependencies
│   └── data/                 # Auto-created data directory
│       └── sessions.json     # Session data (auto-created)
├── frontend/
│   ├── package.json          # React dependencies + proxy config
│   ├── public/
│   │   └── index.html        # HTML template with Google Fonts
│   └── src/
│       ├── index.js          # React entry point
│       ├── App.js            # All components (Dashboard, Log, History, Coach)
│       └── App.css           # All styles (golf-inspired design)
└── README.md                 # This file
```

## API Endpoints

| Method | Endpoint               | Description                                    |
|--------|------------------------|------------------------------------------------|
| GET    | `/api/sessions`        | Get all sessions (newest first)                |
| POST   | `/api/sessions`        | Create a new session (auto-parses notes with AI) |
| DELETE | `/api/sessions/:id`    | Delete a session                               |
| POST   | `/api/transcribe`      | Upload audio file for transcription + parsing  |
| GET    | `/api/stats`           | Get computed stats for the dashboard           |
| GET    | `/api/coaching/advice` | Get AI coaching advice                         |
| GET    | `/api/coaching/summary`| Get AI game summary                            |

## Data Storage

All session data is stored in `backend/data/sessions.json`. This file is auto-created when you first run the backend. No database setup is needed.

To back up your data, just copy this file. To reset, delete it and restart the backend.

## Ideas for Future Features

Here are some ideas you could build with Claude Code:

- **Hole-by-hole scoring** — Track individual hole scores and stats per round
- **Photo uploads** — Attach swing photos or course pics to sessions
- **Goal setting** — Set practice goals and track progress toward them
- **Weather integration** — Auto-log weather conditions for each round
- **Club distance tracking** — Log and track average distances per club
- **Practice plans** — AI-generated weekly practice plans based on your patterns
- **Export to CSV** — Download your session data as a spreadsheet
- **Dark mode** — Toggle between light and dark themes
- **Social sharing** — Share round summaries or milestones
