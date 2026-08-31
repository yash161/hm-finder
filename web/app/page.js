"use client";

import { useState, useCallback, useEffect } from "react";

const THEME_KEY = "hm-finder-theme";

// ===== Icon System =====
const ICON_PATHS = {
  sparkles: "M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z|M19 15l.7 2.1L22 18l-2.3.9L19 21l-.7-2.1L16 18l2.3-.9L19 15z",
  "file-text": "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z|M14 2v6h6|M8 13h8|M8 17h5",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z|M21 21l-4.35-4.35",
  mail: "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z|M22 6l-10 7L2 6",
  star: "M12 2.5l2.9 6 6.6.9-4.8 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5-4.8-4.6 6.6-.9z",
  "bar-chart": "M6 20V13|M12 20V4|M18 20v-8",
  building: "M4 3h16v18H4z|M9 8h.01|M15 8h.01|M9 12h.01|M15 12h.01|M9 21v-4h6v4",
  briefcase: "M3 7h18v13H3z|M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2|M3 12h18",
  "map-pin": "M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z|M12 10.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  tag: "M20.6 13.4L13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10z|M7 7h.01",
  "arrow-left": "M19 12H5|M12 19l-7-7 7-7",
  "external-link": "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6|M15 3h6v6|M10 14L21 3",
  copy: "M9 9h11v11H9z|M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1",
  check: "M20 6L9 17l-5-5",
  x: "M18 6L6 18|M6 6l12 12",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z|M12 1v2|M12 21v2|M4.2 4.2l1.4 1.4|M18.4 18.4l1.4 1.4|M1 12h2|M21 12h2|M4.2 19.8l1.4-1.4|M18.4 5.6l1.4-1.4",
  moon: "M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z",
  users: "M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20|M9 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z|M21 20v-1.5a3.5 3.5 0 0 0-2.5-3.35|M15.5 5.15a3.5 3.5 0 0 1 0 6.7",
  "alert-triangle": "M12 3l10 18H2z|M12 10v4|M12 17.5h.01",
  target: "M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z|M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z|M12 12.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1z",
  crown: "M3 8l4 3 5-6 5 6 4-3-2 11H5z",
  clock: "M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z|M12 8v4l3 2",
  handshake: "M8 12l3 3 6-6|M2 12h4l3-3 3 3h4l2 4-3 3-3-2h-4l-3 2-3-3z",
};

function Icon({ name, size = 16, strokeWidth = 1.8, className, style }) {
  const d = ICON_PATHS[name];
  if (!d) return null;
  const isFilled = name === "star" || name === "crown";
  return (
    <svg
      className={`icon-svg ${className || ""}`}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {d.split("|").map((seg, i) => (
        <path key={i} d={seg} fill={isFilled ? "currentColor" : "none"} />
      ))}
    </svg>
  );
}

const CATEGORY_ICONS = [
  { match: /engineering manager|team lead/i, icon: "target" },
  { match: /director|executive/i, icon: "crown" },
  { match: /recruiter|talent/i, icon: "handshake" },
  { match: /past employee/i, icon: "clock" },
];

function categoryIcon(category) {
  const found = CATEGORY_ICONS.find((c) => c.match.test(category));
  return found ? found.icon : "users";
}

function stripLeadingEmoji(text) {
  return text.replace(/^\p{Extended_Pictographic}️?\s*/u, "");
}

// ===== Theme Toggle =====
function ThemeToggle() {
  const [theme, setTheme] = useState(null);

  useEffect(() => {
    setTheme(document.documentElement.getAttribute("data-theme") || "dark");
  }, []);

  const toggle = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (e) {}
  };

  if (!theme) return null;

  return (
    <button className="theme-toggle" onClick={toggle} type="button" aria-label="Toggle light/dark theme">
      <Icon name={theme === "light" ? "moon" : "sun"} size={14} />
      {theme === "light" ? "Dark" : "Light"}
    </button>
  );
}

// ===== Golden Gate Bridge Silhouette =====
function BridgeSilhouette() {
  return (
    <div className="bg-bridge" aria-hidden="true">
      <svg viewBox="0 0 1200 300" preserveAspectRatio="xMidYMax slice">
        <g fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          {/* deck */}
          <line x1="20" y1="220" x2="1180" y2="220" strokeWidth="3" />
          {/* main cables */}
          <path d="M 40 200 Q 190 70 340 45 Q 470 90 600 150 Q 730 90 860 45 Q 1010 70 1160 200" />
          {/* hangers */}
          {[
            [80, 179], [160, 138], [240, 97], [320, 55],
            [400, 69], [480, 102], [560, 134],
            [640, 134], [720, 102], [800, 69],
            [880, 55], [960, 97], [1040, 138], [1120, 179],
          ].map(([x, y]) => (
            <line key={x} x1={x} y1={y} x2={x} y2="220" strokeWidth="1.25" />
          ))}
          {/* towers */}
          {[340, 860].map((cx) => (
            <g key={cx}>
              <line x1={cx - 14} y1="35" x2={cx - 14} y2="235" strokeWidth="4" />
              <line x1={cx + 14} y1="35" x2={cx + 14} y2="235" strokeWidth="4" />
              <line x1={cx - 14} y1="70" x2={cx + 14} y2="70" strokeWidth="2" />
              <line x1={cx - 14} y1="120" x2={cx + 14} y2="120" strokeWidth="2" />
              <line x1={cx - 14} y1="170" x2={cx + 14} y2="170" strokeWidth="2" />
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}

// ===== Copy Button Component =====
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button className={`copy-btn ${copied ? "copied" : ""}`} onClick={handleCopy}>
      <Icon name={copied ? "check" : "copy"} size={13} />
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// ===== Steps Indicator =====
function Steps({ current }) {
  const steps = [
    { id: "input", label: "Paste JD", icon: "file-text" },
    { id: "search", label: "Find People", icon: "search" },
    { id: "outreach", label: "Generate Outreach", icon: "mail" },
  ];
  const currentIdx = steps.findIndex((s) => s.id === current);

  return (
    <div className="steps">
      {steps.map((step, i) => (
        <span key={step.id}>
          {i > 0 && <span className="step-divider" />}
          <span className={`step ${i === currentIdx ? "active" : i < currentIdx ? "done" : ""}`}>
            <Icon name={step.icon} size={14} /> {step.label}
          </span>
        </span>
      ))}
    </div>
  );
}

// ===== Candidate Card =====
function CandidateCard({ candidate, isTop, onGenerateOutreach, generatingFor }) {
  const initials = candidate.name !== "Unknown Name"
    ? candidate.name.split(" ").map((n) => n[0]).join("").substring(0, 2)
    : "?";

  return (
    <div className={`candidate-card ${isTop ? "top-pick" : ""}`}>
      <div className="candidate-avatar">{initials}</div>
      <div className="candidate-info">
        <div className="candidate-name">
          {isTop && <Icon name="star" size={14} className="top-star" style={{ marginRight: 8 }} />}
          {candidate.name}
        </div>
        <div className="candidate-headline">{candidate.headline}</div>
        <div className="candidate-meta">
          <span className={`score-badge ${candidate.match_score >= 80 ? "score-high" : "score-mid"}`}>
            {candidate.match_score}/100
          </span>
          <span className="category-tag">{candidate.confidence}</span>
          <a href={candidate.linkedin_url} target="_blank" rel="noopener noreferrer" className="candidate-link">
            LinkedIn <Icon name="external-link" size={12} />
          </a>
        </div>
        <div style={{ marginTop: 8 }}>
          <button
            className="btn-secondary"
            onClick={() => onGenerateOutreach(candidate)}
            disabled={generatingFor === candidate.linkedin_url}
          >
            {generatingFor === candidate.linkedin_url ? (
              <>
                <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />
                Generating...
              </>
            ) : (
              <>
                <Icon name="mail" size={13} /> Generate Outreach
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ===== Outreach Display =====
function OutreachDisplay({ outreach }) {
  if (!outreach) return null;
  return (
    <div className="outreach-section fade-in">
      <div className="outreach-block">
        <div className="outreach-label">
          <span className="outreach-label-text">LinkedIn Connection Note</span>
          <span className="char-count">{outreach.connection_note?.length || 0}/300 chars</span>
        </div>
        <div className="outreach-text">
          <CopyButton text={outreach.connection_note} />
          {outreach.connection_note}
        </div>
      </div>

      <div className="outreach-block">
        <div className="outreach-label">
          <span className="outreach-label-text">Cold Email / InMail</span>
        </div>
        <div className="outreach-text">
          <CopyButton text={outreach.email} />
          {outreach.email}
        </div>
      </div>

      {outreach.followup && (
        <div className="outreach-block">
          <div className="outreach-label">
            <span className="outreach-label-text">Follow-Up (5-7 days later)</span>
          </div>
          <div className="outreach-text">
            <CopyButton text={outreach.followup} />
            {outreach.followup}
          </div>
        </div>
      )}
    </div>
  );
}

// ===== Main Page =====
export default function Home() {
  const [jdText, setJdText] = useState("");
  const [step, setStep] = useState("input");
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [job, setJob] = useState(null);
  const [results, setResults] = useState(null);
  const [topHM, setTopHM] = useState(null);
  const [totalFound, setTotalFound] = useState(0);
  const [outreachMap, setOutreachMap] = useState({});
  const [generatingFor, setGeneratingFor] = useState(null);
  const [error, setError] = useState(null);

  const handleSearch = useCallback(async () => {
    if (!jdText.trim()) return;
    setLoading(true);
    setError(null);
    setStep("search");
    setLoadingMsg("Parsing job description & searching LinkedIn...");

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jd_text: jdText }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Search failed");
      }

      const data = await res.json();
      setJob(data.job);
      setResults(data.results);
      setTopHM(data.top_hiring_manager);
      setTotalFound(data.total_found);

      // Auto-generate outreach for top HM
      if (data.top_hiring_manager) {
        setStep("outreach");
        await generateOutreach(data.top_hiring_manager, data.job);
      }
    } catch (err) {
      setError(err.message);
      setStep("input");
    } finally {
      setLoading(false);
    }
  }, [jdText]);

  const generateOutreach = async (candidate, jobCtx = job) => {
    setGeneratingFor(candidate.linkedin_url);
    try {
      const res = await fetch("/api/outreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidate, job: jobCtx }),
      });

      if (!res.ok) throw new Error("Outreach generation failed");
      const data = await res.json();
      setOutreachMap((prev) => ({ ...prev, [candidate.linkedin_url]: data }));
    } catch (err) {
      console.error("Outreach error:", err);
    } finally {
      setGeneratingFor(null);
    }
  };

  const handleReset = () => {
    setStep("input");
    setJob(null);
    setResults(null);
    setTopHM(null);
    setOutreachMap({});
    setError(null);
  };

  return (
    <>
      <div className="bg-gradient" />
      <BridgeSilhouette />
      <ThemeToggle />
      <div className="app-container">
        {/* Header */}
        <header className="header">
          <div className="header-badge"><Icon name="sparkles" size={13} /> AI-Powered</div>
          <h1>HM Finder</h1>
          <p>Paste a job description. We&apos;ll find the hiring manager and generate personalized outreach - all in seconds.</p>
        </header>

        <Steps current={step} />

        {/* Input Section */}
        {step === "input" && (
          <div className="card fade-in">
            <div className="card-title">
              <Icon name="file-text" size={15} className="icon" /> Job Description
              {jdText.length > 0 && (
                <button
                  className="btn-ghost"
                  onClick={() => setJdText("")}
                  style={{ marginLeft: "auto" }}
                  type="button"
                >
                  <Icon name="x" size={12} /> Clear
                </button>
              )}
            </div>
            <div className="jd-textarea-wrap">
              <textarea
                className="jd-textarea"
                placeholder="Paste the full job description here...&#10;&#10;We'll extract the company, role, location, and department automatically."
                value={jdText}
                onChange={(e) => setJdText(e.target.value)}
                id="jd-input"
              />
              <div className="jd-textarea-footer">
                <span>{jdText.trim() ? jdText.trim().split(/\s+/).length : 0} words</span>
                <span>{jdText.length} chars</span>
              </div>
            </div>
            {error && (
              <div className="error-banner">
                <Icon name="alert-triangle" size={15} /> {error}
              </div>
            )}
            <button
              className="btn-primary"
              onClick={handleSearch}
              disabled={!jdText.trim() || loading}
              id="search-btn"
            >
              {loading ? (
                <>
                  <span className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
                  Searching...
                </>
              ) : (
                <>
                  <Icon name="search" size={17} /> Find Hiring Managers
                </>
              )}
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && step !== "input" && (
          <div className="card">
            <div className="loading-container">
              <div className="spinner" />
              <div className="loading-text">{loadingMsg}</div>
              <div className="loading-sub">Scanning US-based LinkedIn profiles...</div>
            </div>
          </div>
        )}

        {/* Results */}
        {!loading && job && results && (
          <>
            {/* Job Signals */}
            <div className="card fade-in">
              <div className="card-title">
                <Icon name="bar-chart" size={15} className="icon" /> Detected Job Signals
                <button className="btn-secondary" onClick={handleReset} style={{ marginLeft: "auto" }}>
                  <Icon name="arrow-left" size={13} /> New Search
                </button>
              </div>
              <div className="signals-grid">
                <div className="signal-item">
                  <span className="signal-icon"><Icon name="building" size={18} /></span>
                  <div>
                    <div className="signal-label">Company</div>
                    <div className="signal-value">{job.company}</div>
                  </div>
                </div>
                <div className="signal-item">
                  <span className="signal-icon"><Icon name="briefcase" size={18} /></span>
                  <div>
                    <div className="signal-label">Role</div>
                    <div className="signal-value">{job.title}</div>
                  </div>
                </div>
                <div className="signal-item">
                  <span className="signal-icon"><Icon name="map-pin" size={18} /></span>
                  <div>
                    <div className="signal-label">Location</div>
                    <div className="signal-value">{job.location || "Not specified"}</div>
                  </div>
                </div>
                <div className="signal-item">
                  <span className="signal-icon"><Icon name="tag" size={18} /></span>
                  <div>
                    <div className="signal-label">Department</div>
                    <div className="signal-value">{job.department}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Top Hiring Manager + Outreach */}
            {topHM && (
              <div className="card fade-in fade-in-delay-1">
                <div className="card-title">
                  <Icon name="star" size={15} className="icon" /> Top Hiring Lead
                </div>
                <CandidateCard
                  candidate={topHM}
                  isTop={true}
                  onGenerateOutreach={generateOutreach}
                  generatingFor={generatingFor}
                />
                {outreachMap[topHM.linkedin_url] && (
                  <div style={{ marginTop: "1.5rem" }}>
                    <div className="card-title">
                      <Icon name="mail" size={15} className="icon" /> AI-Generated Outreach
                    </div>
                    <OutreachDisplay outreach={outreachMap[topHM.linkedin_url]} />
                  </div>
                )}
                {generatingFor === topHM.linkedin_url && (
                  <div className="loading-container" style={{ padding: "1.5rem 0" }}>
                    <div className="spinner" />
                    <div className="loading-text">Generating personalized outreach via AI...</div>
                  </div>
                )}
              </div>
            )}

            {/* All Results */}
            <div className="card fade-in fade-in-delay-2">
              <div className="card-title">
                <Icon name="users" size={15} className="icon" /> All Verified Team Members
                <span className="category-count" style={{ marginLeft: 8 }}>{totalFound} found</span>
              </div>

              {Object.entries(results).map(([category, cands]) => {
                if (!cands?.length) return null;
                return (
                  <div key={category} className="category-section">
                    <div className="category-header">
                      <span className="category-icon"><Icon name={categoryIcon(category)} size={15} /></span>
                      <h3>{stripLeadingEmoji(category)}</h3>
                      <span className="category-count">{cands.length}</span>
                    </div>
                    <div className="candidate-list">
                      {cands.slice(0, 5).map((cand) => (
                        <div key={cand.linkedin_url}>
                          <CandidateCard
                            candidate={cand}
                            isTop={false}
                            onGenerateOutreach={generateOutreach}
                            generatingFor={generatingFor}
                          />
                          {outreachMap[cand.linkedin_url] && (
                            <div style={{ marginLeft: 60, marginTop: 8, marginBottom: 12 }}>
                              <OutreachDisplay outreach={outreachMap[cand.linkedin_url]} />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              {totalFound === 0 && (
                <div className="empty-state">
                  <div className="icon"><Icon name="users" size={32} /></div>
                  <h3>No US-based profiles found</h3>
                  <p>The company may be too small or new for LinkedIn coverage.</p>
                </div>
              )}
            </div>
          </>
        )}

        {/* Footer */}
        <footer style={{ textAlign: "center", marginTop: "2rem", color: "var(--text-muted)", fontSize: "0.75rem" }}>
          Built by Yash Shah · Powered by TinyFish + Groq AI
        </footer>
      </div>
    </>
  );
}
