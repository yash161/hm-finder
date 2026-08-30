import { NextResponse } from "next/server";

const TINYFISH_API_KEY = process.env.TINYFISH_API_KEY || "";
const TINYFISH_URL = "https://api.tinyfish.io/v1/search";

// ===== JD Parser =====
function parseJobDescription(text) {
  const lower = text.toLowerCase();

  // Company
  let company = "Unknown Company";
  const companyPatterns = [
    /(?:company|employer|organization)\s*[:\-–]\s*(.+)/i,
    /\bat\s+([A-Z][A-Za-z\s&.]+?)(?:\s*[,.\-–]|\s+in\b|\s+is\b|$)/,
    /(?:about|join)\s+(?:us\s+at\s+)?([A-Z][A-Za-z\s&.]+?)(?:\s*[\-–|,]|\s+is\b)/,
    /([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,4})\s+is\s+(?:a|an|the|looking|seeking|hiring)/,
  ];
  for (const p of companyPatterns) {
    const m = text.match(p);
    if (m) {
      const extracted = m[1].trim().replace(/[.,;:]+$/, "");
      if (extracted.length >= 3 && extracted.length <= 60) { company = extracted; break; }
    }
  }

  // Aliases
  const aliases = [];
  const aliasPatterns = [
    /\((?:formerly|aka|also known as|doing business as|d\.?b\.?a\.?)\s+([^)]+)\)/gi,
    /(?:"|")([A-Z][A-Za-z]+)(?:"|")/g,
  ];
  for (const p of aliasPatterns) {
    let m;
    while ((m = p.exec(text)) !== null) {
      const a = m[1].trim();
      if (a.length >= 2 && a.length <= 30 && a !== company) aliases.push(a);
    }
  }

  // Title
  let title = "Software Engineer";
  const titlePatterns = [
    /(?:job\s*title|position|role)\s*[:\-–]\s*(.+)/i,
    /^(?:we(?:'re| are) (?:looking for|hiring|seeking) (?:a |an )?)?(.+?(?:engineer|developer|manager|analyst|architect|lead|director|scientist|specialist|coordinator|designer|administrator)[^\n]*)/im,
  ];
  for (const p of titlePatterns) {
    const m = text.match(p);
    if (m) { title = m[1].trim().replace(/[.,;:]+$/, "").substring(0, 80); break; }
  }

  // Location
  let location = null;
  const locPatterns = [
    /(?:location|based in|office)\s*[:\-–]\s*([^\n,]+(?:,\s*[A-Z]{2})?)/i,
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s*(?:CA|NY|TX|WA|MA|IL|CO|GA|VA|FL|OR|PA|NC|OH|AZ|NJ|MD|MN|WI|CT|UT|TN|MO|IN|SC|MI|NV|DC))\b/,
  ];
  for (const p of locPatterns) {
    const m = text.match(p);
    if (m) { location = m[1].trim(); break; }
  }

  // Department
  const dataKeywords = ["data engineer", "data pipeline", "etl", "snowflake", "kafka", "spark", "data warehouse", "bigquery", "redshift", "dbt", "airflow", "data platform", "analytics engineer", "data scientist"];
  const isData = dataKeywords.some(k => lower.includes(k));
  const department = isData ? "data & ai" : "engineering";

  // Sub-team
  let subteam = null;
  const teamPatterns = [
    /(?:team|group|organization)\s*[:\-–]\s*([^\n]+)/i,
    /(?:join|part of|within)\s+(?:the|our)\s+([A-Z][A-Za-z\s&]+?)\s+(?:team|group|org)/i,
  ];
  for (const p of teamPatterns) {
    const m = text.match(p);
    if (m) { subteam = m[1].trim().substring(0, 60); break; }
  }

  return { company, title, location, department, subteam, aliases };
}

// ===== TinyFish Search =====
async function searchTinyFish(query) {
  try {
    const res = await fetch(TINYFISH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TINYFISH_API_KEY}` },
      body: JSON.stringify({ query, num_results: 10 }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || data.organic_results || data || [];
  } catch { return []; }
}

// ===== Score Candidates =====
function isUSLinkedIn(url) {
  return /^https?:\/\/(?:www\.)?linkedin\.com\/in\//.test(url);
}

function scoreCandidate(item, job) {
  const rawTitle = item.title || "";
  const url = item.url || "";
  const snippet = item.snippet || item.description || "";

  if (!url.includes("linkedin.com/in/")) return null;
  if (!isUSLinkedIn(url)) return null;

  let clean = rawTitle.replace(/\s*(\|\s*LinkedIn.*|-\s*LinkedIn.*)$/i, "").trim();
  let name = "Unknown Name", headline = clean;
  for (const sep of [" - ", " – ", " | "]) {
    if (clean.includes(sep)) {
      const parts = clean.split(sep);
      name = parts[0].trim();
      headline = parts.slice(1).join(sep).trim();
      break;
    }
  }

  const fullText = `${headline} ${snippet}`.toLowerCase();
  const allTerms = [job.company.toLowerCase(), ...job.aliases.map(a => a.toLowerCase())];
  const cleanTerms = allTerms.map(t => t.replace(/\s*(llc|inc|ltd|corporation|corp)\.?$/i, "").trim()).filter(t => t.length >= 3);

  if (!cleanTerms.some(t => fullText.includes(t))) return null;

  const isPast = headline.toLowerCase().includes("ex-") || headline.toLowerCase().includes("former");
  let score = 50;
  const reasons = [`Works at ${job.company}`];

  if (job.location && fullText.includes(job.location.toLowerCase())) {
    score += 15;
    reasons.push(`Located in ${job.location}`);
  }

  const isManager = ["manager", "team lead", "lead engineer", "engineering lead"].some(m => fullText.includes(m));
  const isExec = ["director", "head of", "vp", "vice president", "cto"].some(e => fullText.includes(e));
  const isRecruiter = ["recruiter", "talent acquisition", "sourcing", "recruiting"].some(r => fullText.includes(r));

  const hasDiscipline = job.department === "data & ai"
    ? ["data engineer", "data engineering", "data platform", "data analytics"].some(k => fullText.includes(k))
    : ["software engineer", "software engineering", "backend", "platform engineer"].some(k => fullText.includes(k));

  let category;
  if (isManager && !isPast) {
    category = "🎯 Engineering Manager / Team Lead";
    score += 35;
    if (hasDiscipline) { score += 15; reasons.push(`Direct manager matching ${job.title} domain`); }
    else reasons.push(`Engineering manager at ${job.company}`);
  } else if (isExec && !isPast) {
    category = "👑 Director / Executive Leader";
    score += 30;
    if (hasDiscipline) { score += 15; reasons.push(`Director overseeing ${job.department} domain`); }
    else reasons.push(`Executive technology leadership at ${job.company}`);
  } else if (isRecruiter && !isPast) {
    category = "🤝 Technical Recruiter / Talent";
    score += 25;
    reasons.push("Technical recruitment partner");
  } else {
    category = "👥 Senior Engineer / Team Member";
    score += 15;
    reasons.push("Engineer / practitioner at target company");
  }

  if (isPast) { score -= 30; reasons.push("(Past employee)"); }

  return {
    name, headline, linkedin_url: url, category, snippet,
    confidence: score >= 80 ? "High Match" : score >= 60 ? "Strong Lead" : "Related Lead",
    match_score: score,
    match_reason: reasons.join("; "),
  };
}

// ===== Main Handler =====
export async function POST(req) {
  try {
    const { jd_text } = await req.json();
    if (!jd_text || jd_text.trim().length < 20) {
      return NextResponse.json({ error: "Job description too short" }, { status: 400 });
    }

    const job = parseJobDescription(jd_text);

    // Build search queries
    const companyNames = [`"${job.company}"`, ...job.aliases.slice(0, 2).filter(a => a.length > 2).map(a => `"${a}"`)];
    const companyQ = companyNames.join(" OR ");
    const dept = job.department || "engineering";

    const MANAGER_TITLES = {
      "data & ai": ["Data Engineering Manager", "Analytics Manager", "Data Platform Lead", "Head of Data"],
      engineering: ["Engineering Manager", "Software Engineering Manager", "Platform Engineering Manager"],
    };
    const titles = MANAGER_TITLES[dept] || MANAGER_TITLES.engineering;
    const mgrsOr = titles.slice(0, 4).map(m => `"${m}"`).join(" OR ");
    const locStr = job.location && job.location.toLowerCase() !== "remote" ? ` "${job.location}"` : "";

    const queries = [
      `site:linkedin.com/in (${companyQ}) (${mgrsOr})${locStr}`,
      `site:linkedin.com/in (${companyQ}) (${mgrsOr})`,
      `site:linkedin.com/in (${companyQ}) ("Director of Engineering" OR "VP of Engineering" OR "CTO")`,
      `site:linkedin.com/in (${companyQ}) ("Technical Recruiter" OR "Lead Recruiter" OR "Talent Acquisition")`,
    ];

    // Execute searches
    const seenUrls = new Set();
    const candidates = [];

    for (const q of queries) {
      const results = await searchTinyFish(q);
      for (const r of results) {
        const cand = scoreCandidate(r, job);
        if (cand && !seenUrls.has(cand.linkedin_url)) {
          seenUrls.add(cand.linkedin_url);
          candidates.push(cand);
        }
      }
    }

    candidates.sort((a, b) => b.match_score - a.match_score);

    const categorized = {
      "🎯 Engineering Manager / Team Lead": [],
      "👑 Director / Executive Leader": [],
      "🤝 Technical Recruiter / Talent": [],
      "👥 Senior Engineer / Team Member": [],
    };

    for (const c of candidates) {
      if (categorized[c.category]) categorized[c.category].push(c);
    }

    let topHM = null;
    for (const cat of ["🎯 Engineering Manager / Team Lead", "👑 Director / Executive Leader", "🤝 Technical Recruiter / Talent"]) {
      if (categorized[cat]?.length) { topHM = categorized[cat][0]; break; }
    }

    return NextResponse.json({
      job,
      results: categorized,
      top_hiring_manager: topHM,
      total_found: candidates.length,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
