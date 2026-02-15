import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PRACTICE_AREAS = [
  'Driver', 'Woods', 'Long Irons', 'Mid Irons',
  'Short Irons', 'Wedges', 'Chipping', 'Putting', 'Bunker'
];

const FEEL_LABELS = ['Rough', 'Off', 'Okay', 'Good', 'Dialed In'];

const TEES_OPTIONS = [
  { value: 'championship', label: 'Championship / Black' },
  { value: 'blue', label: 'Blue' },
  { value: 'white', label: 'White' },
  { value: 'gold', label: 'Gold / Senior' },
  { value: 'red', label: 'Red / Forward' },
  { value: 'other', label: 'Other' },
];

const WEATHER_OPTIONS = ['Sunny', 'Cloudy', 'Windy', 'Rainy', 'Hot', 'Cold'];
const WIND_OPTIONS = ['Calm', 'Light', 'Moderate', 'Strong'];
const COURSE_CONDITION_OPTIONS = ['Dry/Fast', 'Normal', 'Wet/Soft'];

const CONFIDENCE_AREAS = [
  { key: 'driver', label: 'Driver' },
  { key: 'irons', label: 'Irons' },
  { key: 'short_game', label: 'Short Game' },
  { key: 'putting', label: 'Putting' },
  { key: 'course_management', label: 'Course Mgmt' },
];

const PIE_COLORS = [
  '#2D5A3D', '#4A7C5C', '#6B9E7B', '#8FC09F', '#B3D9C2',
  '#C49B2A', '#8B6914', '#D4ECDE', '#F0D78C'
];

const RADAR_COLORS = {
  stroke: '#2D5A3D',
  fill: 'rgba(45, 90, 61, 0.2)',
};

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  return res.json();
}

// ---------------------------------------------------------------------------
// Animated number component — counts up from 0 to target
// ---------------------------------------------------------------------------

function AnimatedNumber({ value, decimals = 0, suffix = '' }) {
  const [display, setDisplay] = useState(0);
  const ref = useRef(null);

  useEffect(() => {
    const num = typeof value === 'number' ? value : parseFloat(value);
    if (isNaN(num)) { setDisplay(value); return; }

    let start = 0;
    const duration = 600;
    const startTime = performance.now();

    function tick(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = start + (num - start) * eased;
      setDisplay(decimals > 0 ? current.toFixed(decimals) : Math.round(current));
      if (progress < 1) ref.current = requestAnimationFrame(tick);
    }

    ref.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(ref.current);
  }, [value, decimals]);

  return <>{display}{suffix}</>;
}

// ---------------------------------------------------------------------------
// Skeleton loader
// ---------------------------------------------------------------------------

function Skeleton({ width, height }) {
  return (
    <div
      className="skeleton"
      style={{ width: width || '100%', height: height || '20px' }}
    />
  );
}

// ---------------------------------------------------------------------------
// Voice Memo Upload Component
// ---------------------------------------------------------------------------

function VoiceMemoUpload({ onParsed }) {
  const [uploading, setUploading] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState('');

  async function handleUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    setError('');
    setTranscript('');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/transcribe', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setTranscript(data.transcript || '');
        if (data.parsed) onParsed(data.parsed);
      }
    } catch (err) {
      setError('Upload failed. Make sure the backend is running.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="voice-memo-card">
      <div className="voice-memo-icon">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
          <line x1="12" y1="19" x2="12" y2="23"/>
          <line x1="8" y1="23" x2="16" y2="23"/>
        </svg>
      </div>
      <div className="voice-memo-content">
        <h3>Voice Memo</h3>
        <p className="voice-memo-hint">
          Upload a voice recording — we'll transcribe and fill in the form for you.
        </p>
        <label className={`upload-btn ${uploading ? 'uploading' : ''}`}>
          {uploading ? (
            <><span className="spinner" /> Transcribing...</>
          ) : (
            'Choose Audio File'
          )}
          <input
            type="file"
            accept=".m4a,.mp3,.wav,.mp4,.webm"
            onChange={handleUpload}
            disabled={uploading}
            hidden
          />
        </label>
      </div>
      {error && <p className="error-text">{error}</p>}
      {transcript && (
        <div className="transcript-preview">
          <strong>Transcript:</strong>
          <p>{transcript}</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Log Session Page
// ---------------------------------------------------------------------------

function LogSession({ onSaved }) {
  const [sessionType, setSessionType] = useState('range');
  const [date, setDate] = useState(todayStr());
  const [intention, setIntention] = useState('');
  const [areas, setAreas] = useState([]);
  const [ballCount, setBallCount] = useState('');
  const [feelRating, setFeelRating] = useState(null);
  const [notes, setNotes] = useState('');
  const [equipmentNotes, setEquipmentNotes] = useState('');
  const [course, setCourse] = useState('');
  const [score, setScore] = useState('');
  const [frontNine, setFrontNine] = useState('');
  const [backNine, setBackNine] = useState('');
  const [highlights, setHighlights] = useState('');
  const [troubleSpots, setTroubleSpots] = useState('');
  // New round stats
  const [fairwaysHit, setFairwaysHit] = useState('');
  const [gir, setGir] = useState('');
  const [totalPutts, setTotalPutts] = useState('');
  const [penalties, setPenalties] = useState('');
  const [upAndDowns, setUpAndDowns] = useState('');
  const [teesPlayed, setTeesPlayed] = useState('');
  // Conditions
  const [weather, setWeather] = useState('');
  const [wind, setWind] = useState('');
  const [courseCondition, setCourseCondition] = useState('');
  // Confidence
  const [showConfidence, setShowConfidence] = useState(false);
  const [confidence, setConfidence] = useState({});
  // Save state
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function toggleArea(area) {
    setAreas(prev =>
      prev.includes(area) ? prev.filter(a => a !== area) : [...prev, area]
    );
  }

  function setConfidenceRating(key, val) {
    setConfidence(prev => ({ ...prev, [key]: val }));
  }

  function handleVoiceParsed(parsed) {
    if (parsed.type) setSessionType(parsed.type);
    if (parsed.intention) setIntention(parsed.intention);
    if (parsed.areas && parsed.areas.length) {
      const areaMap = {
        driver: 'Driver', woods: 'Woods', long_irons: 'Long Irons',
        mid_irons: 'Mid Irons', short_irons: 'Short Irons', wedges: 'Wedges',
        chipping: 'Chipping', putting: 'Putting', bunker: 'Bunker'
      };
      setAreas(parsed.areas.map(a => areaMap[a] || a));
    }
    if (parsed.ball_count) setBallCount(String(parsed.ball_count));
    if (parsed.feel_rating) setFeelRating(parsed.feel_rating);
    if (parsed.notes_summary) setNotes(parsed.notes_summary);
    if (parsed.equipment_notes) setEquipmentNotes(parsed.equipment_notes);
    if (parsed.course) setCourse(parsed.course);
    if (parsed.score) setScore(String(parsed.score));
    if (parsed.front_nine) setFrontNine(String(parsed.front_nine));
    if (parsed.back_nine) setBackNine(String(parsed.back_nine));
    if (parsed.highlights) setHighlights(parsed.highlights);
    if (parsed.trouble_spots) setTroubleSpots(parsed.trouble_spots);
    // New fields
    if (parsed.tees_played) setTeesPlayed(parsed.tees_played);
    if (parsed.fairways_hit != null) setFairwaysHit(String(parsed.fairways_hit));
    if (parsed.greens_in_regulation != null) setGir(String(parsed.greens_in_regulation));
    if (parsed.total_putts != null) setTotalPutts(String(parsed.total_putts));
    if (parsed.penalties != null) setPenalties(String(parsed.penalties));
    if (parsed.up_and_downs != null) setUpAndDowns(String(parsed.up_and_downs));
    if (parsed.conditions) {
      if (parsed.conditions.weather) setWeather(parsed.conditions.weather);
      if (parsed.conditions.wind) setWind(parsed.conditions.wind);
      if (parsed.conditions.course_condition) setCourseCondition(parsed.conditions.course_condition);
    }
    if (parsed.confidence) {
      setConfidence(parsed.confidence);
      setShowConfidence(true);
    }
  }

  async function handleSave() {
    setSaving(true);
    const isRound = sessionType === 'round';
    const hasConfidence = Object.values(confidence).some(v => v);
    const hasConditions = weather || wind || courseCondition;

    const session = {
      date,
      type: sessionType,
      intention,
      areas: !isRound ? areas : [],
      ball_count: !isRound && ballCount ? parseInt(ballCount) : null,
      feel_rating: feelRating,
      confidence: hasConfidence ? confidence : null,
      notes,
      equipment_notes: equipmentNotes,
      course: isRound ? course : '',
      score: isRound && score ? parseInt(score) : null,
      front_nine: isRound && frontNine ? parseInt(frontNine) : null,
      back_nine: isRound && backNine ? parseInt(backNine) : null,
      tees_played: isRound ? teesPlayed : '',
      fairways_hit: isRound && fairwaysHit ? parseInt(fairwaysHit) : null,
      greens_in_regulation: isRound && gir ? parseInt(gir) : null,
      total_putts: isRound && totalPutts ? parseInt(totalPutts) : null,
      penalties: isRound && penalties ? parseInt(penalties) : null,
      up_and_downs: isRound && upAndDowns ? parseInt(upAndDowns) : null,
      highlights: isRound ? highlights : '',
      trouble_spots: isRound ? troubleSpots : '',
      conditions: isRound && hasConditions ? {
        weather: weather.toLowerCase(),
        wind: wind.toLowerCase(),
        course_condition: courseCondition.toLowerCase().replace('/', '_').replace(' ', '_'),
      } : null,
    };

    await api('/api/sessions', { method: 'POST', body: JSON.stringify(session) });
    setSaving(false);
    setSaved(true);

    setTimeout(() => {
      setDate(todayStr());
      setIntention('');
      setAreas([]);
      setBallCount('');
      setFeelRating(null);
      setNotes('');
      setEquipmentNotes('');
      setCourse('');
      setScore('');
      setFrontNine('');
      setBackNine('');
      setHighlights('');
      setTroubleSpots('');
      setFairwaysHit('');
      setGir('');
      setTotalPutts('');
      setPenalties('');
      setUpAndDowns('');
      setTeesPlayed('');
      setWeather('');
      setWind('');
      setCourseCondition('');
      setShowConfidence(false);
      setConfidence({});
      setSaved(false);
      onSaved();
    }, 1500);
  }

  return (
    <div className="page fade-in">
      <h2>Log Session</h2>

      <VoiceMemoUpload onParsed={handleVoiceParsed} />

      {/* Pre-session intention */}
      <div className="form-card intention-card">
        <label className="form-label" style={{ marginTop: 0 }}>What's your focus today?</label>
        <input
          type="text"
          value={intention}
          onChange={e => setIntention(e.target.value)}
          placeholder="e.g. Working on tempo with driver, trying to stop coming over the top"
          className="form-input"
        />
      </div>

      {/* Session Type Toggle */}
      <div className="type-toggle">
        <button
          className={sessionType === 'range' ? 'active' : ''}
          onClick={() => setSessionType('range')}
        >
          🏌️ Range
        </button>
        <button
          className={sessionType === 'round' ? 'active' : ''}
          onClick={() => setSessionType('round')}
        >
          ⛳ Round
        </button>
      </div>

      <div className="form-card">
        {/* Date */}
        <label className="form-label">Date</label>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} className="form-input" />

        {sessionType === 'range' ? (
          <>
            <label className="form-label">Practice Areas</label>
            <div className="area-grid">
              {PRACTICE_AREAS.map(area => (
                <button
                  key={area}
                  className={`area-btn ${areas.includes(area) ? 'selected' : ''}`}
                  onClick={() => toggleArea(area)}
                >
                  {area}
                </button>
              ))}
            </div>

            <label className="form-label">Ball Count (approx.)</label>
            <input
              type="number"
              value={ballCount}
              onChange={e => setBallCount(e.target.value)}
              placeholder="e.g. 75"
              className="form-input"
            />
          </>
        ) : (
          <>
            {/* Course & Score */}
            <label className="form-label">Course Name</label>
            <input type="text" value={course} onChange={e => setCourse(e.target.value)} placeholder="e.g. Pebble Beach" className="form-input" />

            <label className="form-label">Total Score</label>
            <input type="number" value={score} onChange={e => setScore(e.target.value)} placeholder="e.g. 92" className="form-input" />

            <div className="score-row">
              <div>
                <label className="form-label">Front 9</label>
                <input type="number" value={frontNine} onChange={e => setFrontNine(e.target.value)} placeholder="e.g. 47" className="form-input" />
              </div>
              <div>
                <label className="form-label">Back 9</label>
                <input type="number" value={backNine} onChange={e => setBackNine(e.target.value)} placeholder="e.g. 45" className="form-input" />
              </div>
            </div>

            {/* Tees Played */}
            <label className="form-label">Tees Played</label>
            <div className="tees-grid">
              {TEES_OPTIONS.map(t => (
                <button
                  key={t.value}
                  className={`tee-btn ${teesPlayed === t.value ? 'selected' : ''}`}
                  onClick={() => setTeesPlayed(teesPlayed === t.value ? '' : t.value)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Round Stats Grid */}
            <label className="form-label section-label">Round Stats</label>
            <div className="round-stats-grid">
              <div className="round-stat-field">
                <label className="mini-label">FIR (out of 14)</label>
                <input type="number" value={fairwaysHit} onChange={e => setFairwaysHit(e.target.value)} placeholder="e.g. 8" className="form-input" min="0" max="14" />
              </div>
              <div className="round-stat-field">
                <label className="mini-label">GIR (out of 18)</label>
                <input type="number" value={gir} onChange={e => setGir(e.target.value)} placeholder="e.g. 6" className="form-input" min="0" max="18" />
              </div>
              <div className="round-stat-field">
                <label className="mini-label">Total Putts</label>
                <input type="number" value={totalPutts} onChange={e => setTotalPutts(e.target.value)} placeholder="e.g. 34" className="form-input" />
              </div>
              <div className="round-stat-field">
                <label className="mini-label">Penalties</label>
                <input type="number" value={penalties} onChange={e => setPenalties(e.target.value)} placeholder="e.g. 2" className="form-input" min="0" />
              </div>
              <div className="round-stat-field">
                <label className="mini-label">Up & Downs</label>
                <input type="number" value={upAndDowns} onChange={e => setUpAndDowns(e.target.value)} placeholder="e.g. 3" className="form-input" min="0" />
              </div>
            </div>

            {/* Playing Conditions */}
            <label className="form-label section-label">Playing Conditions</label>
            <div className="conditions-grid">
              <div>
                <label className="mini-label">Weather</label>
                <select value={weather} onChange={e => setWeather(e.target.value)} className="form-input form-select">
                  <option value="">—</option>
                  {WEATHER_OPTIONS.map(w => <option key={w} value={w}>{w}</option>)}
                </select>
              </div>
              <div>
                <label className="mini-label">Wind</label>
                <select value={wind} onChange={e => setWind(e.target.value)} className="form-input form-select">
                  <option value="">—</option>
                  {WIND_OPTIONS.map(w => <option key={w} value={w}>{w}</option>)}
                </select>
              </div>
              <div>
                <label className="mini-label">Course Condition</label>
                <select value={courseCondition} onChange={e => setCourseCondition(e.target.value)} className="form-input form-select">
                  <option value="">—</option>
                  {COURSE_CONDITION_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            <label className="form-label">Highlights — What went well?</label>
            <input type="text" value={highlights} onChange={e => setHighlights(e.target.value)} placeholder="e.g. Hit 10/14 fairways, putting was great on back 9" className="form-input" />

            <label className="form-label">Trouble Spots — What was tough?</label>
            <input type="text" value={troubleSpots} onChange={e => setTroubleSpots(e.target.value)} placeholder="e.g. Chunked a few chip shots, lost 3 balls off the tee" className="form-input" />
          </>
        )}

        {/* Feel Rating */}
        <label className="form-label">How'd It Feel?</label>
        <div className="feel-row">
          {FEEL_LABELS.map((label, i) => (
            <button
              key={i}
              className={`feel-btn ${feelRating === i + 1 ? 'selected' : ''}`}
              onClick={() => setFeelRating(i + 1)}
            >
              <span className="feel-num">{i + 1}</span>
              <span className="feel-label">{label}</span>
            </button>
          ))}
        </div>

        {/* Confidence Check (collapsible) */}
        <button
          className="confidence-toggle"
          onClick={() => setShowConfidence(!showConfidence)}
        >
          {showConfidence ? '▾' : '▸'} Quick Confidence Check (optional)
        </button>
        {showConfidence && (
          <div className="confidence-section">
            {CONFIDENCE_AREAS.map(({ key, label }) => (
              <div key={key} className="confidence-row">
                <span className="confidence-label">{label}</span>
                <div className="confidence-btns">
                  {[1, 2, 3, 4, 5].map(v => (
                    <button
                      key={v}
                      className={`conf-btn ${confidence[key] === v ? 'selected' : ''}`}
                      onClick={() => setConfidenceRating(key, confidence[key] === v ? null : v)}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Notes */}
        <label className="form-label">Notes</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Felt like I was coming over the top with driver. Short game felt really solid today..."
          className="form-textarea"
          rows={4}
        />
        <p className="form-hint">
          Anything on your mind — swing thoughts, what clicked, what frustrated you. AI will parse this for insights.
        </p>

        {/* Equipment notes */}
        <label className="form-label">Equipment changes? (optional)</label>
        <input
          type="text"
          value={equipmentNotes}
          onChange={e => setEquipmentNotes(e.target.value)}
          placeholder="e.g. New driver, switched to Pro V1x, changed grip"
          className="form-input"
        />

        {/* Save */}
        <button
          className={`save-btn ${saved ? 'saved' : ''}`}
          onClick={handleSave}
          disabled={saving || saved}
        >
          {saved ? '✓ Saved!' : saving ? 'Saving...' : 'Save Session'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard Page
// ---------------------------------------------------------------------------

function Dashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/api/stats').then(data => { setStats(data); setLoading(false); });
  }, []);

  if (loading) {
    return (
      <div className="page fade-in">
        <h2>Dashboard</h2>
        <div className="stat-grid">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="stat-card"><Skeleton height="48px" /><Skeleton width="60%" height="14px" /></div>
          ))}
        </div>
      </div>
    );
  }

  if (!stats || stats.total_sessions === 0) {
    return (
      <div className="page fade-in">
        <h2>Dashboard</h2>
        <div className="empty-state">
          <div className="empty-icon">⛳</div>
          <h3>Welcome to Fairway Tracker</h3>
          <p>Log your first session to start tracking your game!</p>
        </div>
      </div>
    );
  }

  // Build confidence radar data from the latest confidence entry
  const latestConf = stats.confidence_trend && stats.confidence_trend.length > 0
    ? stats.confidence_trend[stats.confidence_trend.length - 1]
    : null;
  const radarData = latestConf ? CONFIDENCE_AREAS.map(({ key, label }) => ({
    area: label,
    value: latestConf[key] || 0,
  })) : [];

  return (
    <div className="page fade-in">
      <h2>Dashboard</h2>

      {/* Core Stat Cards */}
      <div className="stat-grid stagger-in">
        <StatCard label="Total Sessions" value={stats.total_sessions} icon="📋" />
        <StatCard label="Range Sessions" value={stats.range_sessions} icon="🏌️" />
        <StatCard label="Rounds Played" value={stats.rounds_played} icon="⛳" />
        <StatCard label="Avg Feel" value={stats.avg_feel ? stats.avg_feel : '—'} suffix={stats.avg_feel ? '/5' : ''} icon="🎯" />
        <StatCard label="Day Streak" value={stats.streak} suffix={` day${stats.streak !== 1 ? 's' : ''}`} icon="🔥" />
        <StatCard label="Total Balls Hit" value={stats.total_balls} icon="🏐" />
        <StatCard label="Best Score" value={stats.best_score || '—'} highlight icon="🏆" />
        <StatCard label="Latest Score" value={stats.latest_score || '—'} icon="📊" />
      </div>

      {/* Round Stats Section (only if round data exists) */}
      {stats.rounds_played > 0 && (stats.avg_fir != null || stats.avg_gir != null || stats.avg_putts != null) && (
        <>
          <h3 className="section-heading">Round Stats</h3>
          <div className="stat-grid stagger-in">
            {stats.avg_fir != null && (
              <StatCard label="Avg FIR" value={stats.avg_fir} suffix={` (${stats.avg_fir_pct}%)`} accent="green" />
            )}
            {stats.avg_gir != null && (
              <StatCard label="Avg GIR" value={stats.avg_gir} suffix={` (${stats.avg_gir_pct}%)`} accent="green" />
            )}
            {stats.avg_putts != null && (
              <StatCard label="Avg Putts" value={stats.avg_putts} accent="blue" />
            )}
            {stats.avg_penalties != null && (
              <StatCard label="Avg Penalties" value={stats.avg_penalties} accent="red" />
            )}
            {stats.scrambling_pct != null && (
              <StatCard label="Scrambling" value={stats.scrambling_pct} suffix="%" accent="gold" />
            )}
          </div>
        </>
      )}

      {/* Charts */}
      <div className="charts-grid stagger-in">
        {/* Weekly Practice Frequency */}
        <div className="chart-card">
          <h3>Weekly Practice Frequency</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={stats.weekly_counts}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e8e4dc" />
              <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#8a8578' }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#8a8578' }} />
              <Tooltip contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
              <Bar dataKey="sessions" fill="#2D5A3D" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Feel Rating Trend */}
        <div className="chart-card">
          <h3>Feel Rating Trend</h3>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={stats.feel_trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e8e4dc" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#8a8578' }} />
              <YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} tick={{ fontSize: 11, fill: '#8a8578' }} />
              <Tooltip contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
              <Line type="monotone" dataKey="rating" stroke="#4A7C5C" strokeWidth={2.5} dot={{ fill: '#2D5A3D', r: 4 }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Practice Focus Distribution */}
        {stats.focus_distribution.length > 0 && (
          <div className="chart-card">
            <h3>Practice Focus Distribution</h3>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={stats.focus_distribution}
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  innerRadius={50}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  paddingAngle={2}
                >
                  {stats.focus_distribution.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Score Trend */}
        {stats.score_trend.length > 0 && (
          <div className="chart-card">
            <h3>Score Trend</h3>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={stats.score_trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e8e4dc" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#8a8578' }} />
                <YAxis reversed domain={['dataMin - 5', 'dataMax + 5']} tick={{ fontSize: 11, fill: '#8a8578' }} />
                <Tooltip contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                <Line type="monotone" dataKey="score" stroke="#C49B2A" strokeWidth={2.5} dot={{ fill: '#8B6914', r: 4 }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* FIR Trend */}
        {stats.fir_trend && stats.fir_trend.length > 1 && (
          <div className="chart-card">
            <h3>Fairways Hit Trend</h3>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={stats.fir_trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e8e4dc" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#8a8578' }} />
                <YAxis domain={[0, 14]} tick={{ fontSize: 11, fill: '#8a8578' }} />
                <Tooltip contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                <Line type="monotone" dataKey="fir" stroke="#2D5A3D" strokeWidth={2.5} dot={{ fill: '#2D5A3D', r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* GIR Trend */}
        {stats.gir_trend && stats.gir_trend.length > 1 && (
          <div className="chart-card">
            <h3>Greens in Regulation Trend</h3>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={stats.gir_trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e8e4dc" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#8a8578' }} />
                <YAxis domain={[0, 18]} tick={{ fontSize: 11, fill: '#8a8578' }} />
                <Tooltip contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                <Line type="monotone" dataKey="gir" stroke="#4A7C5C" strokeWidth={2.5} dot={{ fill: '#4A7C5C', r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Putts Trend */}
        {stats.putts_trend && stats.putts_trend.length > 1 && (
          <div className="chart-card">
            <h3>Putts per Round Trend</h3>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={stats.putts_trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e8e4dc" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#8a8578' }} />
                <YAxis reversed domain={['dataMin - 3', 'dataMax + 3']} tick={{ fontSize: 11, fill: '#8a8578' }} />
                <Tooltip contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                <Line type="monotone" dataKey="putts" stroke="#6B9E7B" strokeWidth={2.5} dot={{ fill: '#6B9E7B', r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Confidence Radar */}
        {radarData.length > 0 && (
          <div className="chart-card">
            <h3>Confidence Snapshot</h3>
            <ResponsiveContainer width="100%" height={280}>
              <RadarChart data={radarData} cx="50%" cy="50%" outerRadius={90}>
                <PolarGrid stroke="#e8e4dc" />
                <PolarAngleAxis dataKey="area" tick={{ fontSize: 11, fill: '#5a5548' }} />
                <PolarRadiusAxis domain={[0, 5]} tick={{ fontSize: 10, fill: '#8a8578' }} />
                <Radar dataKey="value" stroke={RADAR_COLORS.stroke} fill={RADAR_COLORS.fill} strokeWidth={2} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Recurring Themes */}
      {stats.recurring_issues.length > 0 && (
        <div className="themes-section">
          <h3>Recurring Themes</h3>
          <div className="theme-tags">
            {stats.recurring_issues.map((issue, i) => (
              <span key={i} className="theme-tag">{issue}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, suffix = '', highlight, icon, accent }) {
  const accentClass = accent ? `accent-${accent}` : '';
  return (
    <div className={`stat-card ${highlight ? 'highlight' : ''} ${accentClass}`}>
      {icon && <div className="stat-icon">{icon}</div>}
      <div className="stat-value">
        {typeof value === 'number' ? (
          <AnimatedNumber value={value} decimals={String(value).includes('.') ? 1 : 0} suffix={suffix} />
        ) : (
          <>{value}{suffix}</>
        )}
      </div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// History Page
// ---------------------------------------------------------------------------

function History({ sessions, onDelete }) {
  if (!sessions.length) {
    return (
      <div className="page fade-in">
        <h2>Session History</h2>
        <div className="empty-state">
          <div className="empty-icon">📋</div>
          <h3>No sessions yet</h3>
          <p>Head over to Log Session to get started!</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page fade-in">
      <h2>Session History</h2>
      <div className="stagger-in">
        {sessions.map(s => (
          <SessionCard key={s.id} session={s} onDelete={onDelete} />
        ))}
      </div>
    </div>
  );
}

function SessionCard({ session, onDelete }) {
  const s = session;
  const isRound = s.type === 'round';

  function handleDelete() {
    if (window.confirm('Delete this session? This cannot be undone.')) {
      onDelete(s.id);
    }
  }

  return (
    <div className={`session-card ${isRound ? 'round' : 'range'}`}>
      <button className="delete-btn" onClick={handleDelete} title="Delete session">&times;</button>
      <div className="session-header">
        <span className="session-badge">{isRound ? '⛳ Round' : '🏌️ Range'}</span>
        <span className="session-date">{formatDate(s.date)}</span>
        {s.feel_rating && (
          <span className="session-feel">Feel: {FEEL_LABELS[s.feel_rating - 1]}</span>
        )}
      </div>

      {s.intention && (
        <div className="session-intention">
          <span className="intention-label">Focus:</span> {s.intention}
        </div>
      )}

      {!isRound && (
        <div className="session-details">
          {s.areas && s.areas.length > 0 && (
            <div className="area-tags">
              {s.areas.map(a => <span key={a} className="area-tag">{a}</span>)}
            </div>
          )}
          {s.ball_count && <span className="ball-count">{s.ball_count} balls</span>}
        </div>
      )}

      {isRound && (
        <>
          <div className="session-details">
            {s.course && <span className="course-name">{s.course}</span>}
            {s.score && <span className="round-score">Score: {s.score}</span>}
            {(s.front_nine || s.back_nine) && (
              <span className="nine-scores">
                (F9: {s.front_nine || '—'} / B9: {s.back_nine || '—'})
              </span>
            )}
            {s.tees_played && <span className="tees-badge">{s.tees_played}</span>}
          </div>
          {/* Round stats row */}
          {(s.fairways_hit != null || s.greens_in_regulation != null || s.total_putts != null) && (
            <div className="round-stats-row">
              {s.fairways_hit != null && <span className="round-stat-pill">FIR: {s.fairways_hit}/14</span>}
              {s.greens_in_regulation != null && <span className="round-stat-pill">GIR: {s.greens_in_regulation}/18</span>}
              {s.total_putts != null && <span className="round-stat-pill">Putts: {s.total_putts}</span>}
              {s.penalties != null && s.penalties > 0 && <span className="round-stat-pill penalty">Penalties: {s.penalties}</span>}
              {s.up_and_downs != null && <span className="round-stat-pill scramble">Up&Downs: {s.up_and_downs}</span>}
            </div>
          )}
          {/* Conditions */}
          {s.conditions && (s.conditions.weather || s.conditions.wind || s.conditions.course_condition) && (
            <div className="conditions-row">
              {s.conditions.weather && <span className="condition-pill">{s.conditions.weather}</span>}
              {s.conditions.wind && <span className="condition-pill">Wind: {s.conditions.wind}</span>}
              {s.conditions.course_condition && <span className="condition-pill">{s.conditions.course_condition}</span>}
            </div>
          )}
        </>
      )}

      {s.notes && <p className="session-notes">{s.notes}</p>}
      {s.equipment_notes && <p className="session-equipment">🔧 {s.equipment_notes}</p>}

      {s.ai_parsed && <AiInsights parsed={s.ai_parsed} />}
    </div>
  );
}

function AiInsights({ parsed }) {
  if (!parsed) return null;
  const { positives, issues, swing_thoughts } = parsed;
  const hasContent = (positives && positives.length) || (issues && issues.length) || (swing_thoughts && swing_thoughts.length);
  if (!hasContent) return null;

  return (
    <div className="ai-insights">
      {positives && positives.length > 0 && (
        <div className="insight-row positive">
          <span className="insight-icon">✅</span>
          <span>{positives.join(' • ')}</span>
        </div>
      )}
      {issues && issues.length > 0 && (
        <div className="insight-row issue">
          <span className="insight-icon">⚠️</span>
          <span>{issues.join(' • ')}</span>
        </div>
      )}
      {swing_thoughts && swing_thoughts.length > 0 && (
        <div className="insight-row thought">
          <span className="insight-icon">💡</span>
          <span>{swing_thoughts.join(' • ')}</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI Coach Page
// ---------------------------------------------------------------------------

function Coaching() {
  const [advice, setAdvice] = useState('');
  const [summary, setSummary] = useState('');
  const [loadingAdvice, setLoadingAdvice] = useState(false);
  const [loadingSummary, setLoadingSummary] = useState(false);

  async function getAdvice() {
    setLoadingAdvice(true);
    setAdvice('');
    const data = await api('/api/coaching/advice');
    setAdvice(data.advice);
    setLoadingAdvice(false);
  }

  async function getSummary() {
    setLoadingSummary(true);
    setSummary('');
    const data = await api('/api/coaching/summary');
    setSummary(data.summary);
    setLoadingSummary(false);
  }

  return (
    <div className="page fade-in">
      <h2>AI Golf Coach</h2>
      <div className="coaching-grid">
        <div className="coaching-card">
          <div className="coaching-header">
            <span className="coaching-icon">🎯</span>
            <h3>What should I work on?</h3>
          </div>
          <p className="coaching-desc">Get specific advice based on your recent sessions, round stats, confidence levels, and patterns.</p>
          <button className="coaching-btn" onClick={getAdvice} disabled={loadingAdvice}>
            {loadingAdvice ? <><span className="spinner" /> Thinking...</> : 'Get Advice'}
          </button>
          {advice && <div className="coaching-response">{advice}</div>}
        </div>

        <div className="coaching-card">
          <div className="coaching-header">
            <span className="coaching-icon">📊</span>
            <h3>Game Summary</h3>
          </div>
          <p className="coaching-desc">An AI-powered overview of your practice, rounds, and performance trends.</p>
          <button className="coaching-btn" onClick={getSummary} disabled={loadingSummary}>
            {loadingSummary ? <><span className="spinner" /> Analyzing...</> : 'Get Summary'}
          </button>
          {summary && <div className="coaching-response">{summary}</div>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main App
// ---------------------------------------------------------------------------

export default function App() {
  const [page, setPage] = useState('dashboard');
  const [sessions, setSessions] = useState([]);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 640);

  useEffect(() => {
    function handleResize() { setIsMobile(window.innerWidth <= 640); }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const loadSessions = useCallback(() => {
    api('/api/sessions').then(data => setSessions(data));
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  async function handleDelete(id) {
    await api(`/api/sessions/${id}`, { method: 'DELETE' });
    loadSessions();
  }

  const navItems = [
    { key: 'dashboard', label: 'Dashboard', icon: '📊' },
    { key: 'log', label: 'Log Session', icon: '✏️' },
    { key: 'history', label: 'History', icon: '📋' },
    { key: 'coaching', label: 'AI Coach', icon: '🎯' },
  ];

  return (
    <div className="app">
      {/* Desktop header */}
      <header className="app-header">
        <div className="header-content">
          <h1 className="logo" onClick={() => setPage('dashboard')}>
            <span className="logo-icon">⛳</span> Fairway Tracker
          </h1>
          {!isMobile && (
            <nav className="nav">
              {navItems.map(item => (
                <button
                  key={item.key}
                  className={page === item.key ? 'active' : ''}
                  onClick={() => setPage(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          )}
        </div>
      </header>

      <main className="main-content">
        {page === 'dashboard' && <Dashboard />}
        {page === 'log' && <LogSession onSaved={loadSessions} />}
        {page === 'history' && <History sessions={sessions} onDelete={handleDelete} />}
        {page === 'coaching' && <Coaching />}
      </main>

      {/* Mobile bottom nav */}
      {isMobile && (
        <nav className="bottom-nav">
          {navItems.map(item => (
            <button
              key={item.key}
              className={page === item.key ? 'active' : ''}
              onClick={() => setPage(item.key)}
            >
              <span className="bottom-nav-icon">{item.icon}</span>
              <span className="bottom-nav-label">{item.label}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
