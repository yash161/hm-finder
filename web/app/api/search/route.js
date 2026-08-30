import { NextResponse } from "next/server";

const TINYFISH_API_KEY = process.env.TINYFISH_API_KEY || "";
const TINYFISH_SEARCH_URL = "https://api.search.tinyfish.ai";

// ===== Boilerplate & Noise Markers =====
const STOP_WORDS = new Set([
  "the job", "the role", "this role", "the position", "our team", "the company",
  "this job", "in progress", "clicked apply", "notifications", "messaging",
  "home", "my network", "jobs", "for business", "advertise", "verified job",
  "job match", "tailor my resume", "start application", "apply now", "why", "about",
  "careers", "working at", "skip to content", "equal opportunity employer",
  "back to jobs", "back to careers", "apply for this job", "select",
  "first name", "last name", "email", "phone", "resume", "cover letter",
  "voluntary self-identification", "disability status", "veteran status",
  "gender", "public burden statement", "form cc-305", "powered by",
  "accessibility", "talent solutions", "community guidelines", "marketing solutions",
  "privacy & terms", "ad choices", "sales solutions", "mobile", "small business",
  "safety center", "help center", "manage your account", "recommendation transparency",
  "select language", "status is online", "messaging overlay", "navigating to jobs",
  "low match", "high match", "resume match", "only matches", "tailor resume", "no field found",
  "company focus areas", "exclusive job seeker insights", "the latest hiring trend", "competitors",
  "show premium insights", "interested in working with us", "see more jobs like this", "looking for talent",
  "post a job", "people you can reach out to", "recent software engineer hires",
  "wide", "level", "entry", "senior", "junior", "staff", "lead", "the", "and", "for", "our",
]);

const FORM_CUTOFF_MARKERS = [
  /apply\s+for\s+this\s+job/i,
  /voluntary\s+self[-\s]?identification/i,
  /indicates\s+a\s+required\s+field/i,
  /first\s+name\*/i,
  /resume\/cv\*/i,
  /equal\s+opportunity\s+statement/i,
  /equal\s+employment\s+opportunity/i,
  /we\s+are\s+a\s+federal\s+contractor/i,
  /form\s+cc-305/i,
  /powered\s+by\s*\n/i,
  /site\s+powered\s+by/i,
  /See\s+how\s+you\s+compare/i,
  /Exclusive\s+Job\s+Seeker\s+Insights/i,
  /Set\s+alert\s+for\s+similar\s+jobs/i,
  /More\s+jobs\b/i,
  /People\s+you\s+can\s+reach\s+out\s+to/i,
  /Show\s+Premium\s+Insights/i,
  /Interested\s+in\s+working\s+with\s+us/i,
];

const LINKEDIN_HEADER_MARKERS = [
  /About\s+the\s+job\b/i,
  /Job\s+description\b/i,
];

const KNOWN_BRANDS = [
  "Sony Interactive Entertainment", "PlayStation", "Belvedere Trading", "Stripe", "Notion",
  "OpenAI", "Anthropic", "Databricks", "Snowflake", "Figma", "Ramp", "Brex", "Roblox",
  "ByteDance", "TikTok", "Apple", "Google", "Microsoft", "Amazon", "Meta", "Netflix",
  "Uber", "Airbnb", "Lyft", "DoorDash", "Instacart", "Coinbase", "Palantir", "SpaceX",
  "Tesla", "Waymo", "Cruise", "Aurora", "Nuro", "Toast", "Square", "Block", "Cloudflare",
  "HashiCorp", "Twilio", "Datadog", "Splunk", "Elastic", "MongoDB", "Confluent",
  "Lab37", "Lab37 Robotics", "Citadel", "Citadel Securities", "Two Sigma", "Jane Street",
  "DRW", "Jump Trading", "Hudson River Trading", "Akuna Capital", "IMC Trading", "Optiver"
];

const ALIAS_MAP = {
  "sony interactive entertainment": ["PlayStation", "SIE", "Sony"],
  "playstation": ["Sony Interactive Entertainment", "SIE"],
  "sie": ["Sony Interactive Entertainment", "PlayStation"],
  "bytedance": ["TikTok"],
  "tiktok": ["ByteDance"],
  "block": ["Square", "Cash App"],
  "square": ["Block"],
  "meta": ["Facebook", "Instagram", "WhatsApp"],
  "citadel securities": ["Citadel"],
  "citadel": ["Citadel Securities"],
};

const DEPARTMENT_KEYWORDS = {
  "data & ai": ["data engineer", "data engineering", "flink", "kafka", "spark", "etl", "data platform", "data pipeline", "data scientist", "machine learning", "ml engineer", "ai engineer", "analytics"],
  "engineering": ["software engineer", "backend", "frontend", "fullstack", "infrastructure", "devops", "platform engineer", "sre", "systems engineer", "cloud engineer", "developer experience", "build engineer", "release engineer", "ci/cd", "c++", "c#", "java", "low latency", "distributed systems", "middleware"],
  "product": ["product manager", "product lead", "pm", "technical product", "group product"],
  "design": ["product designer", "ui/ux", "ux designer", "design lead", "brand designer"],
  "trading": ["trader", "quantitative trader", "market maker", "execution trader"],
};

const MANAGER_TITLES = {
  "data & ai": ["Data Engineering Manager", "Analytics Manager", "Data Platform Lead", "Head of Data", "Director of Data Engineering"],
  "engineering": ["Software Engineering Manager", "Engineering Manager", "Director of Engineering", "Head of Engineering", "Software Engineering Team Lead", "Director of Technology", "VP of Software Engineering", "Platform Engineering Manager"],
  "product": ["Director of Product", "Head of Product", "Group Product Manager", "VP of Product"],
  "design": ["Design Manager", "Head of Design", "Director of Product Design"],
  "trading": ["Head of Trading", "Trading Lead", "Managing Director"],
};

function stripFormBoilerplate(text) {
  let cleaned = text;
  for (const marker of LINKEDIN_HEADER_MARKERS) {
    const m = cleaned.match(marker);
    if (m) {
      cleaned = cleaned.substring(m.index + m[0].length).trim();
      break;
    }
  }
  for (const marker of FORM_CUTOFF_MARKERS) {
    const m = cleaned.match(marker);
    if (m) {
      cleaned = cleaned.substring(0, m.index).trim();
    }
  }
  return cleaned;
}

function extractCompanyAndAliases(text) {
  let explicitTopCompany = null;
  const explicitM = text.match(/(?:Company|Employer|Organization)[,\s:\-–]+\s*([A-Za-z0-9][\w\s,\.\-&]+?)(?:\s*(?:LLC|Inc|Ltd|Corporation|Corp)\.?)?(?:\n|$)/i);
  if (explicitM) {
    let val = explicitM[1].trim().replace(/^[,\s]+|[,\s]+$/g, "");
    val = val.replace(/\s*(LLC|Inc|Ltd|Corporation|Corp)\.?$/i, "").trim();
    if (val.length > 2 && val.length < 50 && !STOP_WORDS.has(val.toLowerCase())) {
      explicitTopCompany = val;
    }
  }

  const cleanText = stripFormBoilerplate(text);
  const candidates = [];
  if (explicitTopCompany) candidates.push(explicitTopCompany);

  // Strategy 0: Who we are / About us
  const whoPatterns = [
    /(?:Who\s+we\s+are|About\s+us|About\s+the\s+company|Our\s+Company)\s*\n+\s*([A-Za-z0-9][\w\s,\.\-&]+?)(?:,?\s+is\s+a\s+|\s+is\s+the\s+|\s+builds\s+|\s+creates\s+|\s+provides\s+|\s+develops\s+)/i,
    /(?:Who\s+we\s+are|About\s+us)\s*\n+\s*At\s+([A-Za-z0-9][\w\s,\.\-&]+?),\s+we\s+/i,
  ];
  for (const pat of whoPatterns) {
    const m = cleanText.match(pat);
    if (m) {
      let val = m[1].trim().replace(/^[,\s]+|[,\s]+$/g, "");
      val = val.replace(/\s*(LLC|Inc|Ltd|Corporation|Corp)\.?$/i, "").trim();
      if (val.length > 2 && val.length < 50 && !STOP_WORDS.has(val.toLowerCase())) {
        candidates.push(val);
      }
    }
  }

  // Strategy 1: Header patterns
  const headerPatterns = [
    /Why\s+([A-Za-z0-9\s,\.\-&]+?)\?/i,
    /About\s+([A-Za-z0-9\s,\.\-&]+?)(?:\:|\n|\.|\s*—)/i,
    /Working\s+At\s+([A-Za-z0-9\s,\.\-&]+?)(?:\n|$)/i,
    /([A-Za-z0-9\s,\.\-&]+?)\s+is\s+an\s+Equal\s+Opportunity\s+Employer/i,
    /([A-Za-z0-9\s,\.\-&]+?)\s+is\s+a\s+leading/i,
  ];
  for (const pat of headerPatterns) {
    const matches = cleanText.matchAll(new RegExp(pat.source, "gi"));
    for (const m of matches) {
      let val = m[1].trim().replace(/^[,\s—:?]+|[,\s—:?]+$/g, "");
      val = val.replace(/\s*(LLC|Inc|Ltd|Corporation|Corp)\.?$/i, "").trim();
      if (val.length > 2 && val.length < 45 && !STOP_WORDS.has(val.toLowerCase())) {
        candidates.push(val);
      }
    }
  }

  // Strategy 2: Known brand recognition
  for (const brand of KNOWN_BRANDS) {
    if (cleanText.toLowerCase().includes(brand.toLowerCase()) || text.toLowerCase().includes(brand.toLowerCase())) {
      candidates.push(brand);
    }
  }

  let primary = "";
  const aliases = [];
  if (candidates.length > 0) {
    const counts = {};
    for (const c of candidates) counts[c] = (counts[c] || 0) + 1;
    primary = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    // DO NOT add other candidates as aliases — they're often competitor brands
    // from LinkedIn's "Competitors", "More jobs", or sidebar sections.
  }

  // Only add verified parent/subsidiary aliases from ALIAS_MAP
  const lookupKey = primary.toLowerCase().trim();
  if (ALIAS_MAP[lookupKey]) {
    for (const alias of ALIAS_MAP[lookupKey]) {
      if (alias.toLowerCase() !== primary.toLowerCase() && !aliases.some(a => a.toLowerCase() === alias.toLowerCase())) {
        aliases.push(alias);
      }
    }
  }

  return { company: primary || "Target Company", aliases };
}

function extractTitle(text) {
  const lines = text.trim().split("\n");
  const titleKeywords = [
    "engineer", "developer", "manager", "scientist", "architect", "lead",
    "director", "designer", "trader", "analyst", "specialist", "coordinator",
    "administrator", "consultant", "strategist", "associate", "intern",
  ];

  // Strategy 0: Look at first 20 lines
  for (const line of lines.slice(0, 25)) {
    const stripped = line.trim();
    if (!stripped || stripped.length < 5 || stripped.length > 80) continue;
    if (STOP_WORDS.has(stripped.toLowerCase())) continue;
    if (["let's", "no job", "improve", "who we", "about the"].some(s => stripped.toLowerCase().startsWith(s))) continue;

    if (titleKeywords.some(kw => stripped.toLowerCase().includes(kw))) {
      let clean = stripped.replace(/\(verified\s*job\).*/gi, "").trim().replace(/^[,\s.]+|[,\s.]+$/g, "");
      // If repeated like "Software Engineer - Entry Level 2027 Software Engineer - Entry Level 2027"
      if (clean.length > 20) {
        const half = Math.floor(clean.length / 2);
        if (clean.substring(0, half).trim() === clean.substring(half).trim()) {
          clean = clean.substring(0, half).trim();
        }
      }
      if (clean.length > 5 && clean.length < 80) return clean;
    }
  }

  // Strategy 1: Explicit labels
  const explicit = text.match(/(?:Role|Position|Title|Job\s*Title)\s*[:\-–]\s*([^\n]+)/i);
  if (explicit) {
    let val = explicit[1].trim().replace(/\(verified\s*job\).*/gi, "").replace(/^[,\s.]+|[,\s.]+$/g, "");
    if (val.length > 3 && val.length < 60 && !STOP_WORDS.has(val.toLowerCase())) return val;
  }

  // Strategy 2: Body regex
  const m = text.match(/([A-Za-z0-9\s\-/]+\s*(?:Engineer|Developer|Manager|Scientist|Architect|Lead|Director|Designer|Trader|Analyst)(?:\s+(?:I|II|III|IV|V|Staff|Senior|Lead|Entry Level|Graduate|\d{4}))?)/i);
  if (m) {
    let clean = m[1].replace(/\(verified\s*job\).*/gi, "").trim().replace(/^[,\s.]+|[,\s.]+$/g, "");
    if (clean.length > 3 && clean.length < 60 && !STOP_WORDS.has(clean.toLowerCase())) return clean;
  }

  return "Software Engineer";
}

function extractLocation(text) {
  const usStates = new Set([
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN",
    "IA", "KS", "KY", "LA", "MA", "MD", "ME", "MI", "MN", "MS", "MO", "MT", "NE", "NV",
    "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN",
    "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC",
  ]);

  const lines = text.trim().split("\n");
  for (const line of lines.slice(0, 25)) {
    const stripped = line.trim();
    if (!stripped || stripped.length < 3 || stripped.length > 60) continue;
    // Check for "Chicago, IL" or "Belvedere Trading, LLC • Chicago, IL (Hybrid)"
    const stateM = stripped.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),\s*([A-Z]{2})\b/);
    if (stateM && usStates.has(stateM[2])) {
      return `${stateM[1]}, ${stateM[2]}`;
    }
  }

  const explicitM = text.match(/(?:Location|Based\s+in|Office)\s*[:\-–]\s*([^\n,]+(?:,\s*[A-Z]{2})?)/i);
  if (explicitM) {
    let loc = explicitM[1].trim().replace(/[.,;:]+$/, "").trim();
    if (loc.length > 2 && loc.length < 50 && !STOP_WORDS.has(loc.toLowerCase())) return loc;
  }

  return null;
}

function parseJobDescription(text) {
  const { company, aliases } = extractCompanyAndAliases(text);
  const title = extractTitle(text);
  const location = extractLocation(text);

  const cleanText = stripFormBoilerplate(text);
  const combined = `${title} ${cleanText}`.toLowerCase();
  let department = "engineering";
  for (const [dept, kws] of Object.entries(DEPARTMENT_KEYWORDS)) {
    if (kws.some(kw => combined.includes(kw))) {
      department = dept;
      break;
    }
  }

  let subteam = null;
  const teamPatterns = [
    /(?:join|part of|within)\s+(?:the|our)\s+([A-Za-z0-9\s&]+?)\s+(?:team|group|org)/i,
    /(?:team|group|organization)\s*[:\-–]\s*([^\n]+)/i,
  ];
  for (const pat of teamPatterns) {
    const m = cleanText.match(pat);
    if (m) {
      let st = m[1].trim().replace(/[.,;:]+$/, "");
      if (st.length > 3 && st.length < 40 && !STOP_WORDS.has(st.toLowerCase())) {
        subteam = st;
        break;
      }
    }
  }

  return { company, aliases, title, location, department, subteam };
}

// ===== TinyFish Search via GET =====
async function searchTinyFish(query) {
  try {
    const params = new URLSearchParams({
      query: query,
      location: "US",
      language: "en",
    });
    const url = `${TINYFISH_SEARCH_URL}/?${params.toString()}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "X-API-Key": TINYFISH_API_KEY,
      },
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error(`[TinyFish Error ${res.status}]`, errText);
      return [];
    }
    const data = await res.json();
    return data.results || (Array.isArray(data) ? data : []);
  } catch (err) {
    console.error("[Search Exception]", err);
    return [];
  }
}

// ===== Candidate Scoring =====
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
  let name = "Unknown Name";
  let headline = clean;
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
  const cleanTerms = allTerms
    .map(t => t.replace(/\s*(llc|inc|ltd|corporation|corp)\.?$/i, "").trim())
    .filter(t => t.length >= 3);

  if (!cleanTerms.some(term => fullText.includes(term))) {
    return null;
  }

  const isPast = headline.toLowerCase().includes("ex-") || headline.toLowerCase().includes("former");
  let score = 50;
  const reasons = [`Works at ${job.company}`];

  if (job.location && fullText.includes(job.location.toLowerCase())) {
    score += 15;
    reasons.push(`Located in ${job.location}`);
  }

  const isManager = ["manager", "team lead", "lead engineer", "engineering lead", "tech lead"].some(m => fullText.includes(m));
  const isExec = ["director", "head of", "vp", "vice president", "cto"].some(e => fullText.includes(e));
  const isRecruiter = ["recruiter", "talent acquisition", "sourcing", "recruiting"].some(r => fullText.includes(r));

  const hasDiscipline = job.department === "data & ai"
    ? ["data engineer", "data engineering", "data platform", "data analytics"].some(k => fullText.includes(k))
    : ["software engineer", "software engineering", "backend", "platform engineer", "systems", "trading"].some(k => fullText.includes(k));

  let category = "";
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

  if (isPast) {
    score -= 30;
    reasons.push("(Past employee)");
  }

  return {
    name,
    headline,
    linkedin_url: url,
    category,
    snippet,
    confidence: score >= 80 ? "High Match" : score >= 60 ? "Strong Lead" : "Related Lead",
    match_score: score,
    match_reason: reasons.join("; "),
  };
}

// ===== Main Search Handler =====
export async function POST(req) {
  try {
    const { jd_text } = await req.json();
    if (!jd_text || jd_text.trim().length < 20) {
      return NextResponse.json({ error: "Job description too short" }, { status: 400 });
    }

    const job = parseJobDescription(jd_text);

    // Build targeted query tiers
    const companyNames = [`"${job.company}"`, ...job.aliases.slice(0, 2).filter(a => a.length > 2).map(a => `"${a}"`)];
    const companyQ = companyNames.join(" OR ");
    const dept = job.department || "engineering";
    const mgrTitles = MANAGER_TITLES[dept] || MANAGER_TITLES.engineering;
    const mgrsOr = mgrTitles.slice(0, 4).map(m => `"${m}"`).join(" OR ");
    const locStr = job.location && job.location.toLowerCase() !== "remote" ? ` "${job.location}"` : "";

    const queries = [
      `site:linkedin.com/in (${companyQ}) (${mgrsOr})${locStr}`,
      `site:linkedin.com/in (${companyQ}) (${mgrsOr})`,
      `site:linkedin.com/in (${companyQ}) ("Director of Engineering" OR "VP of Engineering" OR "Head of Engineering" OR "CTO")`,
      `site:linkedin.com/in (${companyQ}) ("Technical Recruiter" OR "Lead Recruiter" OR "Talent Acquisition")`,
    ];

    const seenUrls = new Set();
    const candidates = [];

    // Run queries in parallel
    const searchPromises = queries.map(q => searchTinyFish(q));
    const queryResults = await Promise.all(searchPromises);

    for (const results of queryResults) {
      for (const item of results) {
        const cand = scoreCandidate(item, job);
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
      if (categorized[cat]?.length > 0) {
        topHM = categorized[cat][0];
        break;
      }
    }

    return NextResponse.json({
      job,
      results: categorized,
      top_hiring_manager: topHM,
      total_found: candidates.length,
    });
  } catch (err) {
    console.error("Search API exception:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
