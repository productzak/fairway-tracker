"""
Fairway Tracker — Flask API Server

This is the backend for the Fairway Tracker golf practice and round tracking app.
It provides endpoints for session management, AI-powered note parsing, voice memo
transcription, stats computation, AI coaching, and golf course API integration.

Required environment variables:
    ANTHROPIC_API_KEY      — Your Anthropic API key for Claude AI features

Optional environment variables:
    GOLF_COURSE_API_KEY    — Your GolfCourseAPI.com key for course search/details

Optional system dependencies (for voice memo support):
    - ffmpeg (audio conversion)
    - openai-whisper (speech-to-text transcription)
"""

import json
import os
import uuid
import tempfile
import subprocess
import time
import requests
from datetime import datetime, timedelta
from collections import Counter

from flask import Flask, request, jsonify
from flask_cors import CORS
import anthropic

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = Flask(__name__)

frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000")
CORS(app, origins=[frontend_url, "http://localhost:3000"])

DATA_DIR = os.environ.get("DATA_DIR", os.path.join(os.path.dirname(__file__), "data"))
DATA_FILE = os.path.join(DATA_DIR, "sessions.json")
COURSE_CACHE_FILE = os.path.join(DATA_DIR, "course_cache.json")
CUSTOM_TEES_FILE = os.path.join(DATA_DIR, "custom_tees.json")

# Claude model used for all AI features
CLAUDE_MODEL = "claude-sonnet-4-5-20250514"

# Golf Course API
GOLF_COURSE_API_URL = "https://api.golfcourseapi.com"
COURSE_CACHE_MAX_AGE_DAYS = 30

# In-memory search cache to reduce API calls (query -> {results, timestamp})
_search_cache = {}

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
# Course cache helpers
# ---------------------------------------------------------------------------


def _read_course_cache():
    """Read the course cache from disk."""
    if not os.path.exists(COURSE_CACHE_FILE):
        return {}
    with open(COURSE_CACHE_FILE, "r") as f:
        return json.load(f)


def _write_course_cache(cache):
    """Write the course cache to disk."""
    _ensure_data_file()
    with open(COURSE_CACHE_FILE, "w") as f:
        json.dump(cache, f, indent=2)


def _get_cached_course(course_id):
    """Get course details from cache if fresh (within COURSE_CACHE_MAX_AGE_DAYS)."""
    cache = _read_course_cache()
    key = str(course_id)
    if key in cache:
        entry = cache[key]
        cached_at = datetime.fromisoformat(entry.get("_cached_at", "2000-01-01"))
        if (datetime.now() - cached_at).days < COURSE_CACHE_MAX_AGE_DAYS:
            return entry
    return None


def _set_cached_course(course_id, data):
    """Store course details in disk cache with a timestamp."""
    cache = _read_course_cache()
    data["_cached_at"] = datetime.now().isoformat()
    cache[str(course_id)] = data
    _write_course_cache(cache)


def _read_custom_tees():
    """Read custom tees from disk."""
    if not os.path.exists(CUSTOM_TEES_FILE):
        return {}
    with open(CUSTOM_TEES_FILE, "r") as f:
        return json.load(f)


def _write_custom_tees(data):
    """Write custom tees to disk."""
    _ensure_data_file()
    with open(CUSTOM_TEES_FILE, "w") as f:
        json.dump(data, f, indent=2)


def _golf_api_headers():
    """Return headers for the GolfCourseAPI."""
    api_key = os.environ.get("GOLF_COURSE_API_KEY", "")
    return {
        "Authorization": f"Key {api_key}",
        "Content-Type": "application/json",
    }


# ---------------------------------------------------------------------------
# Scorecard parsing
# ---------------------------------------------------------------------------


import re


def _clean_tee_name(raw_name):
    """Clean a tee name from scorecard data (remove trailing colons, parens, etc.)."""
    name = raw_name.strip().rstrip(":")
    # Remove parenthetical year/info e.g. "Blue (2023)"
    name = re.sub(r'\s*\([^)]*\)\s*$', '', name)
    # Remove leading/trailing whitespace
    return name.strip()


def _parse_scorecard_row_format(rows):
    """
    Parse the row-based scorecard format where each row is a dict like:
    {"Hole:": "Blue:", "1": "511", "2": "447", ..., "Out": "3580"}
    Returns: (par_data, tee_yardages, handicap_data)
    """
    par_holes = {}
    handicap_holes = {}
    tee_yardages = {}  # {tee_name: {hole_num: yardage}}

    for row in rows:
        label_raw = row.get("Hole:", row.get("Hole", "")).strip()
        label = label_raw.rstrip(":").strip().lower()

        if label == "par":
            for key, val in row.items():
                if key in ("Hole:", "Hole", "Out", "In", "Total"):
                    continue
                try:
                    hole_num = int(key)
                    par_holes[hole_num] = int(val)
                except (ValueError, TypeError):
                    pass

        elif label == "handicap" or label == "hdcp":
            for key, val in row.items():
                if key in ("Hole:", "Hole", "Out", "In", "Total"):
                    continue
                try:
                    hole_num = int(key)
                    handicap_holes[hole_num] = int(val)
                except (ValueError, TypeError):
                    pass

        elif label and label not in ("hole", ""):
            # This is a tee row
            tee_name = _clean_tee_name(label_raw.rstrip(":"))
            hole_yards = {}
            for key, val in row.items():
                if key in ("Hole:", "Hole", "Out", "In", "Total"):
                    continue
                try:
                    hole_num = int(key)
                    yards = int(val)
                    hole_yards[hole_num] = yards
                except (ValueError, TypeError):
                    pass
            # Skip if all zeros or empty
            if hole_yards and sum(hole_yards.values()) > 0:
                tee_yardages[tee_name] = hole_yards

    return par_holes, tee_yardages, handicap_holes


def _parse_scorecard_perhole_format(rows):
    """
    Parse the per-hole scorecard format where each entry is like:
    {"Par": 5, "Hole": 1, "tees": {"teeBox1": {"color": "Blue", "yards": 519}, ...}, "Handicap": 1}
    Returns: (par_data, tee_yardages, handicap_data)
    """
    par_holes = {}
    handicap_holes = {}
    tee_yardages = {}  # {tee_name: {hole_num: yardage}}

    for entry in rows:
        hole_num = entry.get("Hole")
        if hole_num is None:
            continue

        if entry.get("Par") is not None:
            try:
                par_holes[hole_num] = int(entry["Par"])
            except (ValueError, TypeError):
                pass

        if entry.get("Handicap") is not None:
            try:
                handicap_holes[hole_num] = int(entry["Handicap"])
            except (ValueError, TypeError):
                pass

        tees = entry.get("tees", {})
        for tee_key, tee_data in tees.items():
            tee_name = tee_data.get("color") or tee_data.get("name") or tee_key
            tee_name = _clean_tee_name(tee_name)
            yards = tee_data.get("yards") or tee_data.get("yardage")
            if yards is not None:
                if tee_name not in tee_yardages:
                    tee_yardages[tee_name] = {}
                try:
                    tee_yardages[tee_name][hole_num] = int(yards)
                except (ValueError, TypeError):
                    pass

    return par_holes, tee_yardages, handicap_holes


def _parse_scorecard(scorecard_raw):
    """
    Parse scorecard data from the API. The scorecard field is a JSON string.
    Detects which format (row-based or per-hole) and returns normalized data.
    Returns: {par, handicap, tee_yardages} or None
    """
    if not scorecard_raw:
        return None

    try:
        if isinstance(scorecard_raw, str):
            rows = json.loads(scorecard_raw)
        else:
            rows = scorecard_raw
    except (json.JSONDecodeError, TypeError):
        return None

    if not isinstance(rows, list) or len(rows) == 0:
        return None

    # Detect format: per-hole has "Hole" as an integer key, row-based has "Hole:" as a label
    first = rows[0]
    if isinstance(first.get("Hole"), int) and "tees" in first:
        par_holes, tee_yardages, handicap_holes = _parse_scorecard_perhole_format(rows)
    elif "Hole:" in first or "Hole" in first:
        par_holes, tee_yardages, handicap_holes = _parse_scorecard_row_format(rows)
    else:
        return None

    if not par_holes and not tee_yardages:
        return None

    # Determine number of holes
    all_holes = set()
    all_holes.update(par_holes.keys())
    for ty in tee_yardages.values():
        all_holes.update(ty.keys())
    if not all_holes:
        return None

    num_holes = max(all_holes)
    hole_range = list(range(1, num_holes + 1))

    # Build par structure
    par_list = [par_holes.get(h, 0) for h in hole_range]
    front_holes = [h for h in hole_range if h <= 9]
    back_holes = [h for h in hole_range if h > 9]
    par_front = sum(par_holes.get(h, 0) for h in front_holes)
    par_back = sum(par_holes.get(h, 0) for h in back_holes)
    par_total = par_front + par_back

    par_data = {
        "total": par_total if par_total > 0 else None,
        "front": par_front if par_front > 0 else None,
        "back": par_back if par_back > 0 else None,
        "holes": par_list,
    }

    # Build handicap list
    handicap_list = [handicap_holes.get(h) for h in hole_range]
    has_handicap = any(v is not None for v in handicap_list)

    # Build tee data
    tees_parsed = {}
    for tee_name, hole_yards in tee_yardages.items():
        yard_list = [hole_yards.get(h, 0) for h in hole_range]
        front_yds = sum(hole_yards.get(h, 0) for h in front_holes)
        back_yds = sum(hole_yards.get(h, 0) for h in back_holes)
        total_yds = front_yds + back_yds
        tees_parsed[tee_name] = {
            "hole_yardages": yard_list,
            "front_yardage": front_yds,
            "back_yardage": back_yds,
            "total_yardage": total_yds,
        }

    return {
        "par": par_data,
        "handicap": handicap_list if has_handicap else None,
        "tee_yardages": tees_parsed,
        "num_holes": num_holes,
    }


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
        "course_id": data.get("course_id"),
        "course_city": data.get("course_city", ""),
        "course_state": data.get("course_state", ""),
        "course_par": data.get("course_par"),
        "tee_yardage": data.get("tee_yardage"),
        "tee_slope": data.get("tee_slope"),
        "tee_rating": data.get("tee_rating"),
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
        "score_to_par": data.get("score_to_par"),
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

    # Score trend (include par info when available)
    score_trend = []
    for s in rounds:
        if s.get("score"):
            entry = {"date": s["date"], "score": s["score"]}
            if s.get("course_par"):
                entry["par"] = s["course_par"]
                entry["vs_par"] = s["score"] - s["course_par"]
            score_trend.append(entry)

    # Best score vs par
    best_vs_par = None
    rounds_with_par = [s for s in rounds if s.get("score") and s.get("course_par")]
    if rounds_with_par:
        best_vs_par = min(s["score"] - s["course_par"] for s in rounds_with_par)

    # Stats by course
    course_stats = {}
    for s in rounds:
        if s.get("course") and s.get("score"):
            cname = s["course"]
            if cname not in course_stats:
                course_stats[cname] = {"rounds": 0, "total_score": 0, "best": None}
            course_stats[cname]["rounds"] += 1
            course_stats[cname]["total_score"] += s["score"]
            if course_stats[cname]["best"] is None or s["score"] < course_stats[cname]["best"]:
                course_stats[cname]["best"] = s["score"]
    for cname in course_stats:
        cs = course_stats[cname]
        cs["avg_score"] = round(cs["total_score"] / cs["rounds"], 1)
    course_stats_list = [
        {"course": k, **v} for k, v in sorted(course_stats.items(), key=lambda x: -x[1]["rounds"])
    ]

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
            "best_vs_par": best_vs_par,
            "course_stats": course_stats_list,
        }
    )


# ── Course API ─────────────────────────────────────────────────────────────


@app.route("/api/courses/search", methods=["GET"])
def search_courses():
    """
    Search for golf courses by name using GolfCourseAPI.
    Uses an in-memory cache (5 min TTL) to avoid burning API calls.
    """
    query = request.args.get("q", "").strip()
    if not query or len(query) < 2:
        return jsonify([])

    api_key = os.environ.get("GOLF_COURSE_API_KEY", "")
    if not api_key:
        return jsonify({"error": "GOLF_COURSE_API_KEY is not set", "courses": []}), 200

    # Check in-memory search cache (5 min TTL)
    cache_key = query.lower()
    if cache_key in _search_cache:
        entry = _search_cache[cache_key]
        if time.time() - entry["ts"] < 300:
            return jsonify(entry["results"])

    try:
        resp = requests.get(
            f"{GOLF_COURSE_API_URL}/v1/search",
            headers=_golf_api_headers(),
            params={"search_query": query},
            timeout=10,
        )
        print(f"[Course search] query='{query}' status={resp.status_code}")
        if resp.status_code != 200:
            print(f"[Course search] Non-200 response: {resp.text[:500]}")
            return jsonify([])

        data = resp.json()
        print(f"[Course search] Response keys: {list(data.keys()) if isinstance(data, dict) else type(data)}")
        # Handle various response formats
        if isinstance(data, list):
            courses_raw = data
        else:
            courses_raw = data.get("courses", [])
        print(f"[Course search] Found {len(courses_raw)} courses")

        # Normalize to a simplified list
        courses = []
        for c in courses_raw:
            location = c.get("location", {})
            courses.append({
                "id": c.get("id"),
                "name": c.get("club_name") or c.get("course_name", ""),
                "course_name": c.get("course_name", ""),
                "city": location.get("city", ""),
                "state": location.get("state", ""),
                "holes": c.get("holes", 18),
            })

        _search_cache[cache_key] = {"results": courses, "ts": time.time()}
        return jsonify(courses)

    except Exception as e:
        print(f"[Course search error] {e}")
        return jsonify([])


@app.route("/api/courses/<course_id>", methods=["GET"])
def get_course_details(course_id):
    """
    Fetch full course details (tees, par, scorecard) from GolfCourseAPI.
    The API returns data wrapped in a "course" key, with tees organized
    by gender (male/female), each containing per-hole yardage/par/handicap.
    Uses a local JSON file cache (30-day TTL) to stay within rate limits.
    """
    # Check disk cache first
    cached = _get_cached_course(course_id)
    if cached:
        result = _merge_custom_tees(course_id, cached)
        return jsonify(result)

    api_key = os.environ.get("GOLF_COURSE_API_KEY", "")
    if not api_key:
        return jsonify({"error": "GOLF_COURSE_API_KEY is not set"}), 200

    try:
        resp = requests.get(
            f"{GOLF_COURSE_API_URL}/v1/courses/{course_id}",
            headers=_golf_api_headers(),
            timeout=10,
        )
        if resp.status_code != 200:
            return jsonify({"error": f"API returned {resp.status_code}"}), 200

        raw = resp.json()

        # The API wraps the data in a "course" key
        course_obj = raw.get("course", raw)

        location = course_obj.get("location", {})
        tees_raw = course_obj.get("tees", {})

        print(f"[Course details] Top-level keys: {list(raw.keys())}")
        print(f"[Course details] Course keys: {list(course_obj.keys())}")
        print(f"[Course details] Tees sections: {list(tees_raw.keys()) if isinstance(tees_raw, dict) else type(tees_raw)}")

        # --- Parse teeBoxes for slope/rating (if present) ---
        tee_box_info = {}
        tee_boxes_raw = course_obj.get("teeBoxes") or course_obj.get("tee_boxes")
        if tee_boxes_raw:
            try:
                if isinstance(tee_boxes_raw, str):
                    tee_boxes_raw = json.loads(tee_boxes_raw)
                for tb in (tee_boxes_raw or []):
                    tb_name = _clean_tee_name(tb.get("name", tb.get("tee_name", ""))).lower()
                    if tb_name:
                        tee_box_info[tb_name] = {
                            "slope": tb.get("slope") or tb.get("slope_rating"),
                            "rating": tb.get("rating") or tb.get("course_rating"),
                        }
            except (json.JSONDecodeError, TypeError):
                pass

        # --- Parse tees from male + female sections ---
        # The API format: each tee has tee_name, total_yards, par_total,
        # slope_rating, course_rating, and a "holes" array with per-hole data.
        final_tees = {}
        par_data = None
        handicap_data = None
        course_par = None
        num_holes = 18

        for gender in ["male", "female"]:
            for t in tees_raw.get(gender, []):
                tee_name = _clean_tee_name(t.get("tee_name", "Unknown"))
                key = tee_name.lower()

                if key in final_tees:
                    continue  # Already have this tee from male section

                # Extract per-hole data from the tee's "holes" array
                holes_arr = t.get("holes", [])
                hole_yardages = []
                hole_pars = []
                hole_handicaps = []

                for h in holes_arr:
                    hole_yardages.append(h.get("yardage", 0))
                    hole_pars.append(h.get("par", 0))
                    hole_handicaps.append(h.get("handicap"))

                total_yards = t.get("total_yards") or sum(hole_yardages)
                n_holes = t.get("number_of_holes") or len(holes_arr) or 18
                num_holes = n_holes

                # Compute front/back yardages
                front_yds = sum(hole_yardages[:9]) if len(hole_yardages) >= 9 else sum(hole_yardages)
                back_yds = sum(hole_yardages[9:]) if len(hole_yardages) > 9 else 0

                # Get slope and rating — try multiple field names
                slope = t.get("slope_rating") or t.get("slope")
                rating = t.get("course_rating") or t.get("rating")

                final_tees[key] = {
                    "name": tee_name,
                    "color": _guess_tee_color(tee_name),
                    "total_yardage": total_yards,
                    "front_yardage": front_yds,
                    "back_yardage": back_yds,
                    "hole_yardages": hole_yardages if hole_yardages else None,
                    "slope": slope,
                    "rating": rating,
                    "par": t.get("par_total"),
                }

                # Build par data from the first tee that has hole data
                if par_data is None and hole_pars and any(p > 0 for p in hole_pars):
                    par_front = sum(hole_pars[:9]) if len(hole_pars) >= 9 else sum(hole_pars)
                    par_back = sum(hole_pars[9:]) if len(hole_pars) > 9 else 0
                    par_total = t.get("par_total") or (par_front + par_back)
                    par_data = {
                        "total": par_total,
                        "front": par_front if par_front > 0 else None,
                        "back": par_back if par_back > 0 else None,
                        "holes": hole_pars,
                    }
                    course_par = par_total

                # Build handicap data from the first tee
                if handicap_data is None and hole_handicaps and any(h is not None for h in hole_handicaps):
                    handicap_data = hole_handicaps

                # Set course_par from any tee if not set yet
                if not course_par and t.get("par_total"):
                    course_par = t["par_total"]

        # Layer on teeBoxes slope/rating
        for key, tb in tee_box_info.items():
            if key in final_tees:
                if tb.get("slope") and not final_tees[key].get("slope"):
                    final_tees[key]["slope"] = tb["slope"]
                if tb.get("rating") and not final_tees[key].get("rating"):
                    final_tees[key]["rating"] = tb["rating"]

        # --- Also try parsing a separate scorecard field if it exists ---
        scorecard_data = _parse_scorecard(course_obj.get("scorecard"))
        if scorecard_data:
            # Use scorecard par if we don't have it yet
            if par_data is None:
                par_data = scorecard_data["par"]
                course_par = par_data.get("total")
            if handicap_data is None:
                handicap_data = scorecard_data["handicap"]

            # Merge scorecard tee yardages
            for tee_name, yard_data in scorecard_data["tee_yardages"].items():
                key = tee_name.lower()
                if key in final_tees:
                    # Enrich existing tee with hole-by-hole data if missing
                    if not final_tees[key].get("hole_yardages"):
                        final_tees[key]["hole_yardages"] = yard_data["hole_yardages"]
                        final_tees[key]["front_yardage"] = yard_data["front_yardage"]
                        final_tees[key]["back_yardage"] = yard_data["back_yardage"]
                else:
                    final_tees[key] = {
                        "name": tee_name,
                        "color": _guess_tee_color(tee_name),
                        "total_yardage": yard_data["total_yardage"],
                        "front_yardage": yard_data["front_yardage"],
                        "back_yardage": yard_data["back_yardage"],
                        "hole_yardages": yard_data["hole_yardages"],
                        "slope": None,
                        "rating": None,
                    }

        # Convert to list, sorted by yardage (longest first)
        tees_list = sorted(
            final_tees.values(),
            key=lambda t: t.get("total_yardage") or 0,
            reverse=True,
        )

        print(f"[Course details] Parsed {len(tees_list)} tees, par={course_par}, holes={num_holes}")

        result = {
            "id": course_id,
            "name": course_obj.get("club_name") or course_obj.get("course_name", ""),
            "course_name": course_obj.get("course_name", ""),
            "city": location.get("city", ""),
            "state": location.get("state", ""),
            "holes": num_holes,
            "par": par_data if par_data else {"total": course_par},
            "tees": tees_list,
            "handicap": handicap_data,
        }

        _set_cached_course(course_id, result)
        result = _merge_custom_tees(course_id, result)
        return jsonify(result)

    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"[Course details error] {e}")
        return jsonify({"error": str(e)}), 200


def _merge_custom_tees(course_id, course_data):
    """Merge user-saved custom tee data into course data."""
    custom = _read_custom_tees()
    key = str(course_id)
    if key not in custom:
        return course_data

    custom_tees = custom[key].get("tees", [])
    existing_names = {t.get("name", "").lower() for t in course_data.get("tees", [])}

    for ct in custom_tees:
        ct_name = ct.get("name", "").lower()
        if ct_name in existing_names:
            # Update slope/rating on existing tee
            for t in course_data.get("tees", []):
                if t.get("name", "").lower() == ct_name:
                    if ct.get("slope") and not t.get("slope"):
                        t["slope"] = ct["slope"]
                    if ct.get("rating") and not t.get("rating"):
                        t["rating"] = ct["rating"]
                    if ct.get("yardage") and not t.get("total_yardage"):
                        t["total_yardage"] = ct["yardage"]
                    break
        else:
            # Add new custom tee
            course_data.setdefault("tees", []).append({
                "name": ct["name"],
                "color": _guess_tee_color(ct["name"]),
                "total_yardage": ct.get("yardage"),
                "slope": ct.get("slope"),
                "rating": ct.get("rating"),
                "front_yardage": None,
                "back_yardage": None,
                "hole_yardages": None,
                "added_by_user": True,
            })

    return course_data


def _guess_tee_color(tee_name):
    """Map a tee name to a standard color string for frontend display."""
    name = tee_name.lower()
    for color in ["black", "blue", "white", "gold", "red", "green", "silver", "yellow"]:
        if color in name:
            if color == "yellow":
                return "gold"
            return color
    if "champ" in name or "tips" in name:
        return "black"
    if "back" in name:
        return "blue"
    if "middle" in name:
        return "white"
    if "senior" in name or "forward" in name or "ladies" in name:
        return "red"
    if "bronze" in name or "copper" in name:
        return "gold"
    return "gray"


@app.route("/api/courses/<course_id>/raw", methods=["GET"])
def get_course_raw(course_id):
    """Debug: return raw API response for a course."""
    api_key = os.environ.get("GOLF_COURSE_API_KEY", "")
    if not api_key:
        return jsonify({"error": "GOLF_COURSE_API_KEY is not set"}), 200
    try:
        resp = requests.get(
            f"{GOLF_COURSE_API_URL}/v1/courses/{course_id}",
            headers=_golf_api_headers(),
            timeout=10,
        )
        return jsonify(resp.json())
    except Exception as e:
        return jsonify({"error": str(e)}), 200


@app.route("/api/courses/<course_id>/custom-tees", methods=["POST"])
def save_custom_tee(course_id):
    """Save user-entered tee data for a course."""
    data = request.get_json()
    if not data or not data.get("name"):
        return jsonify({"error": "Tee name is required"}), 400

    custom = _read_custom_tees()
    key = str(course_id)
    if key not in custom:
        custom[key] = {"course_name": data.get("course_name", ""), "tees": []}

    # Update or add tee
    tee_entry = {
        "name": data["name"],
        "yardage": data.get("yardage"),
        "slope": data.get("slope"),
        "rating": data.get("rating"),
        "added_by_user": True,
    }

    existing = custom[key]["tees"]
    found = False
    for i, t in enumerate(existing):
        if t.get("name", "").lower() == data["name"].lower():
            existing[i] = tee_entry
            found = True
            break
    if not found:
        existing.append(tee_entry)

    _write_custom_tees(custom)

    # Invalidate the disk cache for this course so next fetch merges fresh
    cache = _read_course_cache()
    if key in cache:
        del cache[key]
        _write_course_cache(cache)

    return jsonify({"saved": True, "tee": tee_entry})


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
            course_info = s.get('course', '?')
            if s.get('course_par'):
                course_info += f" (Par {s['course_par']}"
                if s.get('tee_slope'):
                    course_info += f", Slope {s['tee_slope']}"
                if s.get('tee_rating'):
                    course_info += f", Rating {s['tee_rating']}"
                if s.get('tee_yardage'):
                    course_info += f", {s['tee_yardage']}yds"
                course_info += ")"
            score_str = str(s.get('score', '?'))
            if s.get('score_to_par') is not None:
                stp = s['score_to_par']
                score_str += f" ({'+' if stp >= 0 else ''}{stp} vs par)"

            line = (
                f"[Round] {s['date']} — Course: {course_info} | "
                f"Score: {score_str} (F9: {s.get('front_nine', '?')}, "
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
    port = int(os.environ.get("PORT", 5000))
    print(f"🏌️ Fairway Tracker API running on http://localhost:{port}")
    app.run(host="0.0.0.0", debug=True, port=port)
