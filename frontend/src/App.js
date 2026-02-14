import React, { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PRACTICE_AREAS = [
  'Driver', 'Woods', 'Long Irons', 'Mid Irons',
  'Short Irons', 'Wedges', 'Chipping', 'Putting', 'Bunker'
];

const FEEL_LABELS = ['Rough', 'Off', 'Okay', 'Good', 'Dialed In'];

const PIE_COLORS = [
  '#2D5A3D', '#4A7C5C', '#6B9E7B', '#8FC09F', '#B3D9C2',
  '#C49B2A', '#8B6914', '#D4ECDE', '#F0D78C'
];

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
      <h3>🎙️ Voice Memo (optional)</h3>
      <p className="voice-memo-hint">
        Record a voice memo on your iPhone and upload it — we'll fill in the form for you.
      </p>
      <label className={`upload-btn ${uploading ? 'uploading' : ''}`}>
        {uploading ? 'Transcribing...' : 'Choose Audio File'}
        <input
          type="file"
          accept=".m4a,.mp3,.wav,.mp4,.webm"
          onChange={handleUpload}
          disabled={uploading}
          hidden
        />
      </label>
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
  const [areas, setAreas] = useState([]);
  const [ballCount, setBallCount] = useState('');
  const [feelRating, setFeelRating] = useState(null);
  const [notes, setNotes] = useState('');
  const [course, setCourse] = useState('');
  const [score, setScore] = useState('');
  const [frontNine, setFrontNine] = useState('');
  const [backNine, setBackNine] = useState('');
  const [highlights, setHighlights] = useState('');
  const [troubleSpots, setTroubleSpots] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function toggleArea(area) {
    setAreas(prev =>
      prev.includes(area) ? prev.filter(a => a !== area) : [...prev, area]
    );
  }

  function handleVoiceParsed(parsed) {
    if (parsed.type) setSessionType(parsed.type);
    if (parsed.areas && parsed.areas.length) {
      // Map area keys back to display names
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
    if (parsed.course) setCourse(parsed.course);
    if (parsed.score) setScore(String(parsed.score));
    if (parsed.front_nine) setFrontNine(String(parsed.front_nine));
    if (parsed.back_nine) setBackNine(String(parsed.back_nine));
    if (parsed.highlights) setHighlights(parsed.highlights);
    if (parsed.trouble_spots) setTroubleSpots(parsed.trouble_spots);
  }

  async function handleSave() {
    setSaving(true);
    const session = {
      date,
      type: sessionType,
      areas: sessionType === 'range' ? areas : [],
      ball_count: sessionType === 'range' && ballCount ? parseInt(ballCount) : null,
      feel_rating: feelRating,
      notes,
      course: sessionType === 'round' ? course : '',
      score: sessionType === 'round' && score ? parseInt(score) : null,
      front_nine: sessionType === 'round' && frontNine ? parseInt(frontNine) : null,
      back_nine: sessionType === 'round' && backNine ? parseInt(backNine) : null,
      highlights: sessionType === 'round' ? highlights : '',
      trouble_spots: sessionType === 'round' ? troubleSpots : '',
    };

    await api('/api/sessions', { method: 'POST', body: JSON.stringify(session) });
    setSaving(false);
    setSaved(true);

    // Reset form
    setTimeout(() => {
      setDate(todayStr());
      setAreas([]);
      setBallCount('');
      setFeelRating(null);
      setNotes('');
      setCourse('');
      setScore('');
      setFrontNine('');
      setBackNine('');
      setHighlights('');
      setTroubleSpots('');
      setSaved(false);
      onSaved();
    }, 1500);
  }

  return (
    <div className="page">
      <h2>Log Session</h2>

      <VoiceMemoUpload onParsed={handleVoiceParsed} />

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
            {/* Practice Areas */}
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

            {/* Ball Count */}
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
            {/* Round fields */}
            <label className="form-label">Course Name</label>
            <input
              type="text"
              value={course}
              onChange={e => setCourse(e.target.value)}
              placeholder="e.g. Pebble Beach"
              className="form-input"
            />

            <label className="form-label">Total Score</label>
            <input
              type="number"
              value={score}
              onChange={e => setScore(e.target.value)}
              placeholder="e.g. 92"
              className="form-input"
            />

            <div className="score-row">
              <div>
                <label className="form-label">Front 9</label>
                <input
                  type="number"
                  value={frontNine}
                  onChange={e => setFrontNine(e.target.value)}
                  placeholder="e.g. 47"
                  className="form-input"
                />
              </div>
              <div>
                <label className="form-label">Back 9</label>
                <input
                  type="number"
                  value={backNine}
                  onChange={e => setBackNine(e.target.value)}
                  placeholder="e.g. 45"
                  className="form-input"
                />
              </div>
            </div>

            <label className="form-label">Highlights — What went well?</label>
            <input
              type="text"
              value={highlights}
              onChange={e => setHighlights(e.target.value)}
              placeholder="e.g. Hit 10/14 fairways, putting was great on back 9"
              className="form-input"
            />

            <label className="form-label">Trouble Spots — What was tough?</label>
            <input
              type="text"
              value={troubleSpots}
              onChange={e => setTroubleSpots(e.target.value)}
              placeholder="e.g. Chunked a few chip shots, lost 3 balls off the tee"
              className="form-input"
            />
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

  if (loading) return <div className="page"><p className="loading">Loading dashboard...</p></div>;
  if (!stats || stats.total_sessions === 0) {
    return (
      <div className="page">
        <h2>Dashboard</h2>
        <div className="empty-state">
          <p>⛳ Welcome to Fairway Tracker — Log your first session to start tracking your game!</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <h2>Dashboard</h2>

      {/* Stat Cards */}
      <div className="stat-grid">
        <StatCard label="Total Sessions" value={stats.total_sessions} />
        <StatCard label="Range Sessions" value={stats.range_sessions} />
        <StatCard label="Rounds Played" value={stats.rounds_played} />
        <StatCard label="Avg Feel" value={stats.avg_feel ? `${stats.avg_feel}/5` : '—'} />
        <StatCard label="Day Streak" value={`${stats.streak} day${stats.streak !== 1 ? 's' : ''}`} />
        <StatCard label="Total Balls Hit" value={stats.total_balls.toLocaleString()} />
        <StatCard label="Best Score" value={stats.best_score || '—'} highlight />
        <StatCard label="Latest Score" value={stats.latest_score || '—'} />
      </div>

      {/* Charts */}
      <div className="charts-grid">
        {/* Weekly Practice Frequency */}
        <div className="chart-card">
          <h3>Weekly Practice Frequency</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={stats.weekly_counts}>
              <CartesianGrid strokeDasharray="3 3" stroke="#D4ECDE" />
              <XAxis dataKey="week" tick={{ fontSize: 12 }} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="sessions" fill="#2D5A3D" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Feel Rating Trend */}
        <div className="chart-card">
          <h3>Feel Rating Trend</h3>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={stats.feel_trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#D4ECDE" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} />
              <Tooltip />
              <Line type="monotone" dataKey="rating" stroke="#4A7C5C" strokeWidth={2} dot={{ fill: '#2D5A3D' }} />
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
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                  {stats.focus_distribution.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
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
                <CartesianGrid strokeDasharray="3 3" stroke="#D4ECDE" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis reversed domain={['dataMin - 5', 'dataMax + 5']} />
                <Tooltip />
                <Line type="monotone" dataKey="score" stroke="#C49B2A" strokeWidth={2} dot={{ fill: '#8B6914' }} />
              </LineChart>
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

function StatCard({ label, value, highlight }) {
  return (
    <div className={`stat-card ${highlight ? 'highlight' : ''}`}>
      <div className="stat-value">{value}</div>
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
      <div className="page">
        <h2>Session History</h2>
        <div className="empty-state">
          <p>No sessions logged yet. Head over to Log Session to get started!</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <h2>Session History</h2>
      {sessions.map(s => (
        <SessionCard key={s.id} session={s} onDelete={onDelete} />
      ))}
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
      <button className="delete-btn" onClick={handleDelete} title="Delete session">×</button>
      <div className="session-header">
        <span className="session-badge">{isRound ? '⛳ Round' : '🏌️ Range'}</span>
        <span className="session-date">{formatDate(s.date)}</span>
        {s.feel_rating && (
          <span className="session-feel">Feel: {FEEL_LABELS[s.feel_rating - 1]}</span>
        )}
      </div>

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
        <div className="session-details">
          {s.course && <span className="course-name">{s.course}</span>}
          {s.score && <span className="round-score">Score: {s.score}</span>}
          {(s.front_nine || s.back_nine) && (
            <span className="nine-scores">
              (F9: {s.front_nine || '—'} / B9: {s.back_nine || '—'})
            </span>
          )}
        </div>
      )}

      {s.notes && <p className="session-notes">{s.notes}</p>}

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
    <div className="page">
      <h2>AI Golf Coach</h2>
      <div className="coaching-grid">
        <div className="coaching-card">
          <h3>🎯 What should I work on?</h3>
          <p className="coaching-desc">Get specific advice based on your recent sessions and patterns.</p>
          <button className="coaching-btn" onClick={getAdvice} disabled={loadingAdvice}>
            {loadingAdvice ? 'Thinking...' : 'Get Advice'}
          </button>
          {advice && <div className="coaching-response">{advice}</div>}
        </div>

        <div className="coaching-card">
          <h3>📊 Game Summary</h3>
          <p className="coaching-desc">An AI-powered overview of your recent practice and play.</p>
          <button className="coaching-btn" onClick={getSummary} disabled={loadingSummary}>
            {loadingSummary ? 'Analyzing...' : 'Get Summary'}
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

  const loadSessions = useCallback(() => {
    api('/api/sessions').then(data => setSessions(data));
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  async function handleDelete(id) {
    await api(`/api/sessions/${id}`, { method: 'DELETE' });
    loadSessions();
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          <h1 className="logo" onClick={() => setPage('dashboard')}>⛳ Fairway Tracker</h1>
          <nav className="nav">
            <button className={page === 'dashboard' ? 'active' : ''} onClick={() => setPage('dashboard')}>Dashboard</button>
            <button className={page === 'log' ? 'active' : ''} onClick={() => setPage('log')}>Log Session</button>
            <button className={page === 'history' ? 'active' : ''} onClick={() => setPage('history')}>History</button>
            <button className={page === 'coaching' ? 'active' : ''} onClick={() => setPage('coaching')}>AI Coach</button>
          </nav>
        </div>
      </header>

      <main className="main-content">
        {page === 'dashboard' && <Dashboard />}
        {page === 'log' && <LogSession onSaved={loadSessions} />}
        {page === 'history' && <History sessions={sessions} onDelete={handleDelete} />}
        {page === 'coaching' && <Coaching />}
      </main>
    </div>
  );
}
