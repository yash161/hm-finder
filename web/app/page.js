"use client";

import { useState, useCallback } from "react";

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
      {copied ? "✓ Copied" : "Copy"}
    </button>
  );
}

// ===== Steps Indicator =====
function Steps({ current }) {
  const steps = [
    { id: "input", label: "Paste JD", icon: "📄" },
    { id: "search", label: "Find People", icon: "🔍" },
    { id: "outreach", label: "Generate Outreach", icon: "✉️" },
  ];
  const currentIdx = steps.findIndex((s) => s.id === current);

  return (
    <div className="steps">
      {steps.map((step, i) => (
        <span key={step.id}>
          {i > 0 && <span className="step-divider" />}
          <span className={`step ${i === currentIdx ? "active" : i < currentIdx ? "done" : ""}`}>
            {step.icon} {step.label}
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
          {isTop && <span style={{ marginRight: 6 }}>⭐</span>}
          {candidate.name}
        </div>
        <div className="candidate-headline">{candidate.headline}</div>
        <div className="candidate-meta">
          <span className={`score-badge ${candidate.match_score >= 80 ? "score-high" : "score-mid"}`}>
            {candidate.match_score}/100
          </span>
          <span className="category-tag">{candidate.confidence}</span>
          <a href={candidate.linkedin_url} target="_blank" rel="noopener noreferrer" className="candidate-link">
            LinkedIn ↗
          </a>
        </div>
        <div style={{ marginTop: 8 }}>
          <button
            className="btn-secondary"
            onClick={() => onGenerateOutreach(candidate)}
            disabled={generatingFor === candidate.linkedin_url}
          >
            {generatingFor === candidate.linkedin_url ? "⏳ Generating..." : "✉️ Generate Outreach"}
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
      <div className="app-container">
        {/* Header */}
        <header className="header">
          <div className="header-badge">⚡ AI-Powered</div>
          <h1>HM Finder</h1>
          <p>Paste a job description. We&apos;ll find the hiring manager and generate personalized outreach — all in seconds.</p>
        </header>

        <Steps current={step} />

        {/* Input Section */}
        {step === "input" && (
          <div className="card fade-in">
            <div className="card-title">
              <span className="icon">📄</span> Job Description
            </div>
            <textarea
              className="jd-textarea"
              placeholder="Paste the full job description here...&#10;&#10;We'll extract the company, role, location, and department automatically."
              value={jdText}
              onChange={(e) => setJdText(e.target.value)}
              id="jd-input"
            />
            {error && (
              <div style={{ color: "var(--error)", fontSize: "0.85rem", marginTop: 8 }}>
                ❌ {error}
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
                <>🔍 Find Hiring Managers</>
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
                <span className="icon">📋</span> Detected Job Signals
                <button className="btn-secondary" onClick={handleReset} style={{ marginLeft: "auto" }}>
                  ← New Search
                </button>
              </div>
              <div className="signals-grid">
                <div className="signal-item">
                  <div>
                    <div className="signal-label">Company</div>
                    <div className="signal-value">{job.company}</div>
                  </div>
                </div>
                <div className="signal-item">
                  <div>
                    <div className="signal-label">Role</div>
                    <div className="signal-value">{job.title}</div>
                  </div>
                </div>
                <div className="signal-item">
                  <div>
                    <div className="signal-label">Location</div>
                    <div className="signal-value">{job.location || "Not specified"}</div>
                  </div>
                </div>
                <div className="signal-item">
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
                  <span className="icon">⭐</span> Top Hiring Lead
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
                      <span className="icon">✉️</span> AI-Generated Outreach
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
                <span className="icon">📊</span> All Verified Team Members
                <span className="category-count" style={{ marginLeft: 8 }}>{totalFound} found</span>
              </div>

              {Object.entries(results).map(([category, cands]) => {
                if (!cands?.length) return null;
                return (
                  <div key={category} className="category-section">
                    <div className="category-header">
                      <h3>{category}</h3>
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
                  <div className="icon">🔍</div>
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
