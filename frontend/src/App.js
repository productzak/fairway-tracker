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

const TEE_COLORS = {
  black: '#1a1a1a',
  blue: '#2563EB',
  white: '#d4d4d4',
  gold: '#C49B2A',
  yellow: '#C49B2A',
  red: '#DC2626',
  green: '#16A34A',
  silver: '#9ca3af',
  gray: '#9ca3af',
};

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
  '#059669', '#10B981', '#34D399', '#6EE7B7', '#A7F3D0',
  '#D97706', '#F59E0B', '#3B82F6', '#8B5CF6'
];

const RADAR_COLORS = {
  stroke: '#059669',
  fill: 'rgba(5, 150, 105, 0.15)',
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

function _guessTeeColor(teeName) {
  if (!teeName) return 'gray';
  const n = teeName.toLowerCase();
  for (const color of ['black', 'blue', 'white', 'gold', 'red', 'green', 'silver', 'yellow']) {
    if (n.includes(color)) return color;
  }
  if (n.includes('champ')) return 'black';
  if (n.includes('senior') || n.includes('forward')) return 'gold';
  return 'gray';
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
// Course Search Component
// ---------------------------------------------------------------------------

function CourseSearch({ onCourseSelect, onClear, selectedCourse, selectedTee, onTeeSelect, onManualMode }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [showResults, setShowResults] = useState(false);
  const [loading, setLoading] = useState(false);
  const [courseDetails, setCourseDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const debounceRef = useRef(null);
  const wrapperRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setShowResults(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function handleInputChange(val) {
    setQuery(val);
    setManualMode(false);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (val.length < 2) { setResults([]); setShowResults(false); return; }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await api(`/api/courses/search?q=${encodeURIComponent(val)}`);
        const list = Array.isArray(data) ? data : (data.courses || []);
        setResults(list);
        setShowResults(list.length > 0);
      } catch { setResults([]); }
      setLoading(false);
    }, 300);
  }

  async function handleSelect(course) {
    setShowResults(false);
    setQuery('');

    // Immediately show the selected course card with search result data
    onCourseSelect({
      course_id: course.id,
      name: course.name,
      city: course.city || '',
      state: course.state || '',
      par: null,
      tees: [],
    });

    // Then fetch full details (tees, par, etc.)
    setLoadingDetails(true);
    try {
      const details = await api(`/api/courses/${course.id}`);
      if (details && !details.error) {
        setCourseDetails(details);
        onCourseSelect({
          course_id: course.id,
          name: details.name || course.name,
          city: details.city || course.city || '',
          state: details.state || course.state || '',
          par: details.par,
          tees: details.tees || [],
        });
      }
    } catch {
      // Keep the partial selection from above
    }
    setLoadingDetails(false);
  }

  function handleClear() {
    setQuery('');
    setCourseDetails(null);
    setManualMode(false);
    onClear();
  }

  // If a course is already selected, show the selected course card
  if (selectedCourse && !manualMode) {
    const tees = courseDetails?.tees || selectedCourse.tees || [];

    return (
      <div className="course-search-wrapper">
        <label className="form-label">Course</label>
        <div className="selected-course-card">
          <div className="selected-course-info">
            <strong>{selectedCourse.name}</strong>
            {(selectedCourse.city || selectedCourse.state) && (
              <span className="selected-course-location">
                {[selectedCourse.city, selectedCourse.state].filter(Boolean).join(', ')}
              </span>
            )}
            {selectedCourse.par && <span className="selected-course-par">Par {selectedCourse.par}</span>}
          </div>
          <button className="course-clear-btn" onClick={handleClear} title="Change course">&times;</button>
        </div>

        {/* Tee selection from API data */}
        {tees.length > 0 && (
          <>
            <label className="form-label">Select Tees</label>
            <div className="api-tees-grid">
              {tees.map((t, i) => (
                <button
                  key={i}
                  type="button"
                  className={`api-tee-btn ${selectedTee && selectedTee.name === t.name ? 'selected' : ''}`}
                  onClick={() => onTeeSelect(t)}
                >
                  <span className="api-tee-header">
                    <span className="tee-color-dot" style={{ background: TEE_COLORS[t.color] || '#9ca3af' }} />
                    <span className="api-tee-name">{t.name}</span>
                  </span>
                  {t.total_yardage && <span className="api-tee-yards">{t.total_yardage} yds</span>}
                  {(t.slope || t.rating) && (
                    <span className="api-tee-info">
                      {t.slope && `S: ${t.slope}`}{t.slope && t.rating && ' · '}{t.rating && `R: ${t.rating}`}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </>
        )}

        {loadingDetails && <p className="course-loading"><span className="spinner" /> Loading course data...</p>}
      </div>
    );
  }

  return (
    <div className="course-search-wrapper" ref={wrapperRef}>
      <label className="form-label">Course</label>
      <div className="course-search-input-wrap">
        <svg className="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          type="text"
          value={query}
          onChange={e => handleInputChange(e.target.value)}
          onFocus={() => { if (results.length > 0) setShowResults(true); }}
          placeholder="Search for a course..."
          className="form-input course-search-input"
        />
        {loading && <span className="spinner search-spinner" />}
      </div>

      {showResults && (
        <div className="course-results-dropdown fade-in">
          {results.map(c => (
            <button key={c.id} className="course-result-item" onClick={() => handleSelect(c)}>
              <strong>{c.name}</strong>
              {(c.city || c.state) && (
                <span className="course-result-loc">{[c.city, c.state].filter(Boolean).join(', ')}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {!showResults && query.length >= 2 && !loading && results.length === 0 && (
        <p className="course-no-results">
          No courses found.{' '}
          <button className="link-btn" onClick={() => { onClear(); if (onManualMode) onManualMode(); }}>
            Enter manually
          </button>
        </p>
      )}

      {!query && !selectedCourse && (
        <p className="course-manual-link">
          <button className="link-btn" onClick={() => { if (onManualMode) onManualMode(); }}>
            Can't find your course? Enter manually
          </button>
        </p>
      )}
    </div>
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
  // Course search
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [selectedTee, setSelectedTee] = useState(null);
  const [manualCourseMode, setManualCourseMode] = useState(false);
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
    if (parsed.course) {
      setCourse(parsed.course);
      // Try to search for the course via API
      api(`/api/courses/search?q=${encodeURIComponent(parsed.course)}`)
        .then(data => {
          const list = Array.isArray(data) ? data : (data.courses || []);
          if (list.length > 0) {
            const match = list[0];
            api(`/api/courses/${match.id}`).then(details => {
              if (details && !details.error) {
                setSelectedCourse({
                  course_id: match.id,
                  name: details.name || match.name,
                  city: details.city || '',
                  state: details.state || '',
                  par: details.par,
                  tees: details.tees || [],
                });
                setCourse(details.name || match.name);
                // Try to match the tee
                if (parsed.tees_played && details.tees) {
                  const teeName = parsed.tees_played.toLowerCase();
                  const matched = details.tees.find(t =>
                    t.name.toLowerCase().includes(teeName) || t.color === teeName
                  );
                  if (matched) {
                    setSelectedTee(matched);
                    setTeesPlayed(matched.name);
                  }
                }
              }
            }).catch(() => {});
          }
        }).catch(() => {});
    }
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
      course_id: isRound && selectedCourse ? selectedCourse.course_id : null,
      course_city: isRound && selectedCourse ? selectedCourse.city : '',
      course_state: isRound && selectedCourse ? selectedCourse.state : '',
      course_par: isRound && selectedCourse ? selectedCourse.par : null,
      tee_yardage: isRound && selectedTee ? selectedTee.total_yardage : null,
      tee_slope: isRound && selectedTee ? selectedTee.slope : null,
      tee_rating: isRound && selectedTee ? selectedTee.rating : null,
      score: isRound && score ? parseInt(score) : null,
      front_nine: isRound && frontNine ? parseInt(frontNine) : null,
      back_nine: isRound && backNine ? parseInt(backNine) : null,
      tees_played: isRound ? (selectedTee ? selectedTee.name : teesPlayed) : '',
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
      setSelectedCourse(null);
      setSelectedTee(null);
      setManualCourseMode(false);
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
            {/* Course Search */}
            {!manualCourseMode ? (
              <CourseSearch
                selectedCourse={selectedCourse}
                selectedTee={selectedTee}
                onCourseSelect={(c) => {
                  setSelectedCourse(c);
                  setCourse(c.name);
                }}
                onClear={() => {
                  setSelectedCourse(null);
                  setSelectedTee(null);
                  setCourse('');
                  setTeesPlayed('');
                }}
                onTeeSelect={(t) => {
                  setSelectedTee(t);
                  setTeesPlayed(t.name);
                }}
                onManualMode={() => setManualCourseMode(true)}
              />
            ) : (
              <>
                <label className="form-label">Course Name</label>
                <input type="text" value={course} onChange={e => setCourse(e.target.value)} placeholder="e.g. Pebble Beach" className="form-input" />
                <p className="course-manual-link">
                  <button className="link-btn" onClick={() => setManualCourseMode(false)}>
                    Search for course instead
                  </button>
                </p>

                {/* Manual Tees Played */}
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
              </>
            )}

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
        {stats.best_vs_par != null && (
          <StatCard label="Best vs Par" value={stats.best_vs_par >= 0 ? `+${stats.best_vs_par}` : String(stats.best_vs_par)} highlight icon="🎯" />
        )}
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
              <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
              <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#9CA3AF' }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#9CA3AF' }} />
              <Tooltip contentStyle={{ borderRadius: 6, border: '1px solid #E5E7EB', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontFamily: 'DM Sans' }} />
              <Bar dataKey="sessions" fill="#059669" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Feel Rating Trend */}
        <div className="chart-card">
          <h3>Feel Rating Trend</h3>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={stats.feel_trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9CA3AF' }} />
              <YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} tick={{ fontSize: 11, fill: '#9CA3AF' }} />
              <Tooltip contentStyle={{ borderRadius: 6, border: '1px solid #E5E7EB', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontFamily: 'DM Sans' }} />
              <Line type="monotone" dataKey="rating" stroke="#10B981" strokeWidth={2} dot={{ fill: '#059669', r: 3 }} activeDot={{ r: 5 }} />
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
                <Tooltip contentStyle={{ borderRadius: 6, border: '1px solid #E5E7EB', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontFamily: 'DM Sans' }} />
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
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9CA3AF' }} />
                <YAxis reversed domain={['dataMin - 5', 'dataMax + 5']} tick={{ fontSize: 11, fill: '#9CA3AF' }} />
                <Tooltip contentStyle={{ borderRadius: 6, border: '1px solid #E5E7EB', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontFamily: 'DM Sans' }} />
                <Line type="monotone" dataKey="score" stroke="#D97706" strokeWidth={2} dot={{ fill: '#B45309', r: 3 }} activeDot={{ r: 5 }} />
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
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9CA3AF' }} />
                <YAxis domain={[0, 14]} tick={{ fontSize: 11, fill: '#9CA3AF' }} />
                <Tooltip contentStyle={{ borderRadius: 6, border: '1px solid #E5E7EB', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontFamily: 'DM Sans' }} />
                <Line type="monotone" dataKey="fir" stroke="#059669" strokeWidth={2} dot={{ fill: '#059669', r: 3 }} />
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
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9CA3AF' }} />
                <YAxis domain={[0, 18]} tick={{ fontSize: 11, fill: '#9CA3AF' }} />
                <Tooltip contentStyle={{ borderRadius: 6, border: '1px solid #E5E7EB', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontFamily: 'DM Sans' }} />
                <Line type="monotone" dataKey="gir" stroke="#10B981" strokeWidth={2} dot={{ fill: '#10B981', r: 3 }} />
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
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9CA3AF' }} />
                <YAxis reversed domain={['dataMin - 3', 'dataMax + 3']} tick={{ fontSize: 11, fill: '#9CA3AF' }} />
                <Tooltip contentStyle={{ borderRadius: 6, border: '1px solid #E5E7EB', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontFamily: 'DM Sans' }} />
                <Line type="monotone" dataKey="putts" stroke="#3B82F6" strokeWidth={2} dot={{ fill: '#3B82F6', r: 3 }} />
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
                <PolarGrid stroke="#F3F4F6" />
                <PolarAngleAxis dataKey="area" tick={{ fontSize: 11, fill: '#6B7280' }} />
                <PolarRadiusAxis domain={[0, 5]} tick={{ fontSize: 10, fill: '#9CA3AF' }} />
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
            {(s.course_city || s.course_state) && (
              <span className="course-location-small">{[s.course_city, s.course_state].filter(Boolean).join(', ')}</span>
            )}
            {s.score && (
              <span className="round-score">
                Score: {s.score}
                {s.course_par && <span className="vs-par"> ({s.score - s.course_par >= 0 ? '+' : ''}{s.score - s.course_par})</span>}
              </span>
            )}
            {(s.front_nine || s.back_nine) && (
              <span className="nine-scores">
                (F9: {s.front_nine || '—'} / B9: {s.back_nine || '—'})
              </span>
            )}
          </div>
          {/* Tee info */}
          {s.tees_played && (
            <div className="tee-info-row">
              <span className="tee-color-dot" style={{ background: TEE_COLORS[_guessTeeColor(s.tees_played)] || '#9ca3af' }} />
              <span className="tee-info-name">{s.tees_played}</span>
              {s.tee_yardage && <span className="tee-info-detail">{s.tee_yardage} yds</span>}
              {s.tee_slope && <span className="tee-info-detail">Slope {s.tee_slope}</span>}
              {s.tee_rating && <span className="tee-info-detail">Rating {s.tee_rating}</span>}
            </div>
          )}
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
