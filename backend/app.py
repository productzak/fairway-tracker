"""
Fairway Tracker — Flask API Server

This is the backend for the Fairway Tracker golf practice and round tracking app.
It provides endpoints for session management, AI-powered note parsing, voice memo
transcription, stats computation, and AI coaching.

Required environment variable:
    ANTHROPIC_API_KEY — Your Anthropic API key for Claude AI features

Optional system dependencies (for voice memo support):
    - ffmpeg (audio conversion)
    - openai-whisper (speech-to-text transcription)
"""

import json
import os
import uuid
import tempfile
import subprocess
from datetime import datetime, timedelta
from collections import Counter

from flask import Flask, request, jsonify
from flask_cors import CORS
import anthropic

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = Flask(__name__)
CORS(app)

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
DATA_FILE = os.path.join(DATA_DIR, "sessions.json")

# Claude model used for all AI features
CLAUDE_MODEL = "claude-sonnet-4-5-20250514"

# ---------------------------------------------------------------------------
# Data helpers
# ---------------------------------------------------------------------------


def _ensure_data_file():
    """Create the data directory and sessions file if they don't exist."""
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(DATA_FILE):
        with open(DATA_FILE, "w") as f:
            json.dump([], f)


def _read_sessions():
    """Read all sessions from the JSON file."""
    _ensure_data_file()
    with open(DATA_FILE, "r") as f:
        return json.load(f)


def _write_sessions(sessions):
    """Write sessions list to the JSON file."""
    _ensure_data_file()
    with open(DATA_FILE, "w") as f:
        json.dump(sessions, f, indent=2)


# ---------------------------------------------------------------------------
# Claude AI helpers
# ---------------------------------------------------------------------------


def _get_claude_client():
    """Return an Anthropic client. Raises an error if the API key is missing."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY environment variable is not set.")
    return anthropic.Anthropic(api_key=api_key)


def _parse_claude_json(text):
    """
    Parse JSON from Claude's response, handling potential markdown code block
    wrapping (```json ... ```).
    """
    text = text.strip()
    if text.startswith("```"):
        # Remove opening fence (with optional language tag)
        first_newline = text.index("\n")
        text = text[first_newline + 1:]
    if text.endswith("```"):
        text = text[:-3]
    return json.loads(text.strip())


def _parse_notes_with_claude(notes):
    """
    Send session notes to Claude and return structured insights as a dict with
    keys: key_focus, positives, issues, swing_thoughts, equipment.
    Returns None if the API key is not set or if parsing fails.
    """
    try:
        client = _get_claude_client()
    except ValueError:
        return None

    try:
        message = client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=1024,
            system=(
                "You are a golf practice note parser. Extract structured insights "
                "from the player's notes. Return ONLY valid JSON with these keys:\n"
                '  "key_focus": a short string summarizing the main focus,\n'
                '  "positives": array of strings — things that went well,\n'
                '  "issues": array of strings — problems or struggles mentioned,\n'
                '  "swing_thoughts": array of strings — any swing cues or thoughts,\n'
                '  "equipment": array of strings — any clubs or equipment mentioned.\n'
                "If a category has nothing relevant, use an empty array. "
                "Do NOT wrap the JSON in markdown code fences."
            ),
            messages=[{"role": "user", "content": notes}],
        )
        return _parse_claude_json(message.content[0].text)
    except Exception as e:
        print(f"[AI parse error] {e}")
        return None


# ---------------------------------------------------------------------------
# API Routes
# ---------------------------------------------------------------------------


# ── Sessions ───────────────────────────────────────────────────────────────


@app.route("/api/sessions", methods=["GET"])
def get_sessions():
    """Return all sessions sorted newest first."""
    sessions = _read_sessions()
    sessions.sort(key=lambda s: s.get("created_at", ""), reverse=True)
    return jsonify(sessions)


@app.route("/api/sessions", methods=["POST"])
def create_session():
    """
    Create a new session. If the notes field has more than 20 characters,
    automatically parse them with Claude AI and attach the insights.
    """
    data = request.get_json()
    session = {
        "id": str(uuid.uuid4()),
        "date": data.get("date", datetime.now().strftime("%Y-%m-%d")),
        "type": data.get("type", "range"),
        "intention": data.get("intention", ""),
        "areas": data.get("areas", []),
        "ball_count": data.get("ball_count"),
        "feel_rating": data.get("feel_rating"),
        "confidence": data.get("confidence"),
        "notes": data.get("notes", ""),
        "equipment_notes": data.get("equipment_notes", ""),
        "course": data.get("course", ""),
        "score": data.get("score"),
        "front_nine": data.get("front_nine"),
        "back_nine": data.get("back_nine"),
        "tees_played": data.get("tees_played", ""),
        "fairways_hit": data.get("fairways_hit"),
        "greens_in_regulation": data.get("greens_in_regulation"),
        "total_putts": data.get("total_putts"),
        "penalties": data.get("penalties"),
        "up_and_downs": data.get("up_and_downs"),
        "highlights": data.get("highlights", ""),
        "trouble_spots": data.get("trouble_spots", ""),
        "conditions": data.get("conditions"),
        "ai_parsed": data.get("ai_parsed"),
        "created_at": datetime.now().isoformat(),
    }

    # Auto-parse notes with Claude if long enough and not already parsed
    if len(session.get("notes", "")) > 20 and not session.get("ai_parsed"):
        parsed = _parse_notes_with_claude(session["notes"])
        if parsed:
            session["ai_parsed"] = parsed

    sessions = _read_sessions()
    sessions.append(session)
    _write_sessions(sessions)

    return jsonify(session), 201


@app.route("/api/sessions/<session_id>", methods=["DELETE"])
def delete_session(session_id):
    """Delete a session by its ID."""
    sessions = _read_sessions()
    sessions = [s for s in sessions if s["id"] != session_id]
    _write_sessions(sessions)
    return jsonify({"deleted": session_id})


# ── Stats ──────────────────────────────────────────────────────────────────


@app.route("/api/stats", methods=["GET"])
def get_stats():
    """
    Compute and return aggregate stats: totals, averages, streaks,
    distributions, and trend data for charts.
    """
    sessions = _read_sessions()
    sessions.sort(key=lambda s: s.get("date", ""))

    total = len(sessions)
    range_sessions = [s for s in sessions if s["type"] == "range"]
    rounds = [s for s in sessions if s["type"] == "round"]

    # Feel ratings
    feel_ratings = [s["feel_rating"] for s in sessions if s.get("feel_rating")]
    avg_feel = round(sum(feel_ratings) / len(feel_ratings), 1) if feel_ratings else 0

    # Ball count
    total_balls = sum(s.get("ball_count") or 0 for s in sessions)

    # Scores
    scores = [s["score"] for s in rounds if s.get("score")]
    best_score = min(scores) if scores else None
    latest_score = scores[-1] if scores else None

    # Day streak (consecutive days ending at today or most recent session)
    unique_dates = sorted(set(s["date"] for s in sessions if s.get("date")))
    streak = 0
    if unique_dates:
        check_date = datetime.now().date()
        most_recent = datetime.strptime(unique_dates[-1], "%Y-%m-%d").date()
        if most_recent < check_date:
            check_date = most_recent
        date_set = set(unique_dates)
        while check_date.strftime("%Y-%m-%d") in date_set:
            streak += 1
            check_date -= timedelta(days=1)

    # Weekly practice frequency (last 8 weeks)
    today = datetime.now().date()
    weekly_counts = []
    for i in range(7, -1, -1):
        week_start = today - timedelta(days=today.weekday() + 7 * i)
        week_end = week_start + timedelta(days=6)
        count = sum(
            1
            for s in sessions
            if s.get("date")
            and week_start <= datetime.strptime(s["date"], "%Y-%m-%d").date() <= week_end
        )
        label = week_start.strftime("%b %d")
        weekly_counts.append({"week": label, "sessions": count})

    # Feel trend (last 20 sessions with feel_rating)
    feel_trend = []
    sessions_with_feel = [s for s in sessions if s.get("feel_rating")]
    for s in sessions_with_feel[-20:]:
        feel_trend.append({"date": s["date"], "rating": s["feel_rating"]})

    # Practice focus distribution
    area_counter = Counter()
    for s in range_sessions:
        for area in s.get("areas", []):
            area_counter[area] += 1
    focus_distribution = [
        {"name": area, "value": count} for area, count in area_counter.most_common()
    ]

    # Score trend
    score_trend = []
    for s in rounds:
        if s.get("score"):
            score_trend.append({"date": s["date"], "score": s["score"]})

    # ── Enhanced round stats ──────────────────────────────────────────────

    # FIR stats
    rounds_with_fir = [s for s in rounds if s.get("fairways_hit") is not None]
    avg_fir = round(sum(s["fairways_hit"] for s in rounds_with_fir) / len(rounds_with_fir), 1) if rounds_with_fir else None
    avg_fir_pct = round((avg_fir / 14) * 100, 1) if avg_fir is not None else None

    # GIR stats
    rounds_with_gir = [s for s in rounds if s.get("greens_in_regulation") is not None]
    avg_gir = round(sum(s["greens_in_regulation"] for s in rounds_with_gir) / len(rounds_with_gir), 1) if rounds_with_gir else None
    avg_gir_pct = round((avg_gir / 18) * 100, 1) if avg_gir is not None else None

    # Putts stats
    rounds_with_putts = [s for s in rounds if s.get("total_putts") is not None]
    avg_putts = round(sum(s["total_putts"] for s in rounds_with_putts) / len(rounds_with_putts), 1) if rounds_with_putts else None

    # Penalties stats
    rounds_with_penalties = [s for s in rounds if s.get("penalties") is not None]
    avg_penalties = round(sum(s["penalties"] for s in rounds_with_penalties) / len(rounds_with_penalties), 1) if rounds_with_penalties else None

    # Scrambling percentage: up_and_downs / (18 - GIR) for rounds with both
    scrambling_pct = None
    scramble_rounds = [s for s in rounds if s.get("up_and_downs") is not None and s.get("greens_in_regulation") is not None]
    if scramble_rounds:
        total_opportunities = sum(max(18 - (s["greens_in_regulation"] or 0), 0) for s in scramble_rounds)
        total_made = sum(s["up_and_downs"] for s in scramble_rounds)
        if total_opportunities > 0:
            scrambling_pct = round((total_made / total_opportunities) * 100, 1)

    # FIR / GIR / Putts trend charts
    fir_trend = []
    for s in rounds:
        if s.get("fairways_hit") is not None:
            fir_trend.append({"date": s["date"], "fir": s["fairways_hit"]})

    gir_trend = []
    for s in rounds:
        if s.get("greens_in_regulation") is not None:
            gir_trend.append({"date": s["date"], "gir": s["greens_in_regulation"]})

    putts_trend = []
    for s in rounds:
        if s.get("total_putts") is not None:
            putts_trend.append({"date": s["date"], "putts": s["total_putts"]})

    # Confidence trend (last 20 sessions with confidence data)
    confidence_trend = []
    sessions_with_conf = [s for s in sessions if s.get("confidence")]
    for s in sessions_with_conf[-20:]:
        entry = {"date": s["date"]}
        entry.update(s["confidence"])
        confidence_trend.append(entry)

    # Recurring themes (issues from ai_parsed)
    issues = []
    for s in sessions:
        if s.get("ai_parsed") and s["ai_parsed"].get("issues"):
            issues.extend(s["ai_parsed"]["issues"])
    seen = set()
    unique_issues = []
    for issue in issues:
        lower = issue.lower()
        if lower not in seen:
            seen.add(lower)
            unique_issues.append(issue)

    return jsonify(
        {
            "total_sessions": total,
            "range_sessions": len(range_sessions),
            "rounds_played": len(rounds),
            "avg_feel": avg_feel,
            "streak": streak,
            "total_balls": total_balls,
            "best_score": best_score,
            "latest_score": latest_score,
            "weekly_counts": weekly_counts,
            "feel_trend": feel_trend,
            "focus_distribution": focus_distribution,
            "score_trend": score_trend,
            "recurring_issues": unique_issues,
            # Enhanced round stats
            "avg_fir": avg_fir,
            "avg_fir_pct": avg_fir_pct,
            "avg_gir": avg_gir,
            "avg_gir_pct": avg_gir_pct,
            "avg_putts": avg_putts,
            "avg_penalties": avg_penalties,
            "scrambling_pct": scrambling_pct,
            "fir_trend": fir_trend,
            "gir_trend": gir_trend,
            "putts_trend": putts_trend,
            "confidence_trend": confidence_trend,
        }
    )


# ── Transcription ──────────────────────────────────────────────────────────


@app.route("/api/transcribe", methods=["POST"])
def transcribe_audio():
    """
    Accept an audio file upload, convert it to WAV with ffmpeg,
    transcribe with OpenAI Whisper (local), then parse the transcript
    with Claude to extract structured session data.
    """
    if "file" not in request.files:
        return jsonify({"error": "No audio file provided"}), 400

    audio_file = request.files["file"]

    try:
        import whisper
    except ImportError:
        return jsonify(
            {"error": "Whisper is not installed. Run: pip install openai-whisper"}
        ), 500

    with tempfile.TemporaryDirectory() as tmpdir:
        # Save uploaded file
        input_path = os.path.join(tmpdir, "input_audio" + os.path.splitext(audio_file.filename)[1])
        audio_file.save(input_path)

        # Convert to WAV with ffmpeg
        wav_path = os.path.join(tmpdir, "audio.wav")
        try:
            subprocess.run(
                ["ffmpeg", "-i", input_path, "-ar", "16000", "-ac", "1", wav_path],
                check=True,
                capture_output=True,
            )
        except FileNotFoundError:
            return jsonify(
                {"error": "ffmpeg is not installed. Please install ffmpeg."}
            ), 500
        except subprocess.CalledProcessError as e:
            return jsonify({"error": f"ffmpeg conversion failed: {e.stderr.decode()}"}), 500

        # Transcribe with Whisper
        model = whisper.load_model("base")
        result = model.transcribe(wav_path)
        transcript = result["text"]

    # Parse transcript with Claude
    parsed = None
    try:
        client = _get_claude_client()
        message = client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=1024,
            system=(
                "You are a golf voice memo parser. The user recorded a voice memo about "
                "their golf practice or round. Parse it into structured data.\n"
                "Return ONLY valid JSON with these keys:\n"
                '  "type": "range" or "round",\n'
                '  "intention": string — what the player was focusing on, or empty string,\n'
                '  "areas": array of practice areas from [driver, woods, long_irons, mid_irons, short_irons, wedges, chipping, putting, bunker],\n'
                '  "ball_count": number or null,\n'
                '  "feel_rating": 1-5 or null,\n'
                '  "confidence": object with keys driver, irons, short_game, putting, course_management (each 1-5 or null) — only include if mentioned,\n'
                '  "notes_summary": string summary of notes,\n'
                '  "equipment_notes": string — any equipment changes mentioned, or empty string,\n'
                '  "course": course name or empty string,\n'
                '  "score": number or null,\n'
                '  "front_nine": number or null,\n'
                '  "back_nine": number or null,\n'
                '  "tees_played": one of "championship", "blue", "white", "gold", "red", "other", or empty string,\n'
                '  "fairways_hit": number or null,\n'
                '  "greens_in_regulation": number or null,\n'
                '  "total_putts": number or null,\n'
                '  "penalties": number or null,\n'
                '  "up_and_downs": number or null,\n'
                '  "conditions": object with keys weather (sunny/cloudy/windy/rainy/hot/cold), wind (calm/light/moderate/strong), course_condition (dry/normal/wet) — only include if mentioned,\n'
                '  "highlights": string or empty,\n'
                '  "trouble_spots": string or empty,\n'
                '  "key_focus": string,\n'
                '  "positives": array of strings,\n'
                '  "issues": array of strings,\n'
                '  "swing_thoughts": array of strings\n'
                "Do NOT wrap the JSON in markdown code fences."
            ),
            messages=[{"role": "user", "content": transcript}],
        )
        parsed = _parse_claude_json(message.content[0].text)
    except Exception as e:
        print(f"[AI transcript parse error] {e}")

    return jsonify({"transcript": transcript, "parsed": parsed})


# ── AI Coaching ────────────────────────────────────────────────────────────


def _format_sessions_for_coaching(sessions, limit=30):
    """Format the most recent sessions as a text summary for the AI coach."""
    sessions_sorted = sorted(
        sessions, key=lambda s: s.get("created_at", ""), reverse=True
    )[:limit]

    lines = []
    for s in sessions_sorted:
        # Common fields
        intention = f" | Intention: {s['intention']}" if s.get("intention") else ""
        equipment = f" | Equipment: {s['equipment_notes']}" if s.get("equipment_notes") else ""

        # Confidence
        conf_str = ""
        if s.get("confidence"):
            c = s["confidence"]
            parts = []
            for key, label in [("driver", "Driver"), ("irons", "Irons"), ("short_game", "Short Game"), ("putting", "Putting"), ("course_management", "Course Mgmt")]:
                if c.get(key):
                    parts.append(f"{label}:{c[key]}/5")
            if parts:
                conf_str = f" | Confidence: {', '.join(parts)}"

        if s["type"] == "range":
            line = (
                f"[Range] {s['date']} — Areas: {', '.join(s.get('areas', []))} | "
                f"Balls: {s.get('ball_count', '?')} | Feel: {s.get('feel_rating', '?')}/5"
                f"{intention}{conf_str}{equipment}"
            )
            if s.get("notes"):
                line += f" | Notes: {s['notes'][:200]}"
            if s.get("ai_parsed"):
                ap = s["ai_parsed"]
                if ap.get("positives"):
                    line += f" | Positives: {', '.join(ap['positives'])}"
                if ap.get("issues"):
                    line += f" | Issues: {', '.join(ap['issues'])}"
        else:
            line = (
                f"[Round] {s['date']} — Course: {s.get('course', '?')} | "
                f"Score: {s.get('score', '?')} (F9: {s.get('front_nine', '?')}, "
                f"B9: {s.get('back_nine', '?')}) | Feel: {s.get('feel_rating', '?')}/5"
                f"{intention}{conf_str}{equipment}"
            )
            # Enhanced round stats
            if s.get("tees_played"):
                line += f" | Tees: {s['tees_played']}"
            if s.get("fairways_hit") is not None:
                line += f" | FIR: {s['fairways_hit']}/14"
            if s.get("greens_in_regulation") is not None:
                line += f" | GIR: {s['greens_in_regulation']}/18"
            if s.get("total_putts") is not None:
                line += f" | Putts: {s['total_putts']}"
            if s.get("penalties") is not None:
                line += f" | Penalties: {s['penalties']}"
            if s.get("up_and_downs") is not None:
                line += f" | Up&Downs: {s['up_and_downs']}"
            # Conditions
            if s.get("conditions"):
                cond = s["conditions"]
                cond_parts = []
                if cond.get("weather"):
                    cond_parts.append(cond["weather"])
                if cond.get("wind"):
                    cond_parts.append(f"wind:{cond['wind']}")
                if cond.get("course_condition"):
                    cond_parts.append(f"course:{cond['course_condition']}")
                if cond_parts:
                    line += f" | Conditions: {', '.join(cond_parts)}"
            if s.get("highlights"):
                line += f" | Highlights: {s['highlights'][:150]}"
            if s.get("trouble_spots"):
                line += f" | Trouble: {s['trouble_spots'][:150]}"
            if s.get("notes"):
                line += f" | Notes: {s['notes'][:200]}"
        lines.append(line)

    return "\n".join(lines)


@app.route("/api/coaching/advice", methods=["GET"])
def get_coaching_advice():
    """Return AI coaching advice based on the player's session history."""
    sessions = _read_sessions()
    if not sessions:
        return jsonify(
            {"advice": "I don't have any sessions to analyze yet! Log a few practice sessions or rounds, and I'll be able to give you personalized advice."}
        )

    summary = _format_sessions_for_coaching(sessions)

    try:
        client = _get_claude_client()
        message = client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=1024,
            system=(
                "You are a supportive, knowledgeable golf coach analyzing a player's "
                "practice and play history. You have access to their session data including "
                "practice areas, round stats (FIR, GIR, putts, penalties, scrambling), feel "
                "ratings, confidence levels across different parts of their game, pre-session "
                "intentions, playing conditions, and equipment changes. Give specific, "
                "actionable advice based on patterns you see. Compare their intentions to "
                "their actual sessions — are they following through? Look at confidence "
                "trends — where are they gaining or losing confidence? Analyze their round "
                "stats to identify the biggest scoring opportunities (e.g., if they're losing "
                "strokes to penalties or putting). Be encouraging but honest. Keep your "
                "response to 3-4 short paragraphs. Use a conversational, coach-like tone. "
                "Reference specific data points from their sessions."
            ),
            messages=[
                {
                    "role": "user",
                    "content": f"Here is my recent practice history:\n\n{summary}\n\nWhat should I work on?",
                }
            ],
        )
        return jsonify({"advice": message.content[0].text})
    except ValueError:
        return jsonify({"advice": "ANTHROPIC_API_KEY is not set. Please set it to use AI coaching."}), 500
    except Exception as e:
        return jsonify({"advice": f"Error getting coaching advice: {e}"}), 500


@app.route("/api/coaching/summary", methods=["GET"])
def get_coaching_summary():
    """Return an AI-generated game summary based on session history."""
    sessions = _read_sessions()
    if not sessions:
        return jsonify(
            {"summary": "No sessions logged yet. Start tracking your practice and rounds, and I'll provide a detailed summary of your game!"}
        )

    summary = _format_sessions_for_coaching(sessions)

    try:
        client = _get_claude_client()
        message = client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=1024,
            system=(
                "You are a golf analytics assistant providing a comprehensive game summary. "
                "Analyze the player's data including: practice frequency and focus areas, "
                "round scoring trends, fairways hit and greens in regulation percentages, "
                "putting averages, penalty frequency, scrambling rate, confidence trends "
                "across different game areas, how conditions affected their scores, and any "
                "equipment changes. Provide a clear, data-driven summary organized around: "
                "overall trajectory, strengths, areas for improvement, and notable patterns. "
                "Keep it to 3-4 short paragraphs."
            ),
            messages=[
                {
                    "role": "user",
                    "content": f"Here is my recent practice and play history:\n\n{summary}\n\nPlease give me a game summary.",
                }
            ],
        )
        return jsonify({"summary": message.content[0].text})
    except ValueError:
        return jsonify({"summary": "ANTHROPIC_API_KEY is not set. Please set it to use AI features."}), 500
    except Exception as e:
        return jsonify({"summary": f"Error generating summary: {e}"}), 500


# ---------------------------------------------------------------------------
# Run the server
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    _ensure_data_file()
    print("🏌️ Fairway Tracker API running on http://localhost:5000")
    app.run(debug=True, port=5000)
