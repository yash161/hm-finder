"""
Hiring Manager Finder (HM-Finder)
Modular tool to identify the exact hiring manager for any job description using TinyFish API.
Outreach messages generated via Groq LLM, personalized from your skill files.
"""

import os
import re
import sys
import glob
from collections import Counter
from dataclasses import dataclass
from typing import List, Dict, Optional, Any, Tuple
import requests
from groq import Groq

# Load .env file for local development
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # dotenv not installed, rely on shell env vars

API_KEY = os.getenv("TINYFISH_API_KEY", "")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
SKILLS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "skills-files")


# ==========================================
# Data Models
# ==========================================
@dataclass
class JobContext:
    company: str
    aliases: List[str]
    title: str
    subteam: Optional[str] = None
    department: Optional[str] = None
    location: Optional[str] = None
    reports_to: Optional[str] = None
    raw_text: Optional[str] = None


@dataclass
class Candidate:
    name: str
    headline: str
    linkedin_url: str
    category: str
    snippet: str
    confidence: str
    match_score: int
    match_reason: str


# ==========================================
# TinyFish API Client
# ==========================================
class TinyFishClient:
    def __init__(self, api_key: str = API_KEY):
        self.api_key = api_key
        self.search_url = "https://api.search.tinyfish.ai"

    def search(self, query: str, location: str = "US", language: str = "en") -> List[Dict[str, Any]]:
        """Query the TinyFish Search API."""
        headers = {"X-API-Key": self.api_key}
        params = {"query": query, "location": location, "language": language}
        try:
            resp = requests.get(self.search_url, headers=headers, params=params, timeout=20)
            resp.raise_for_status()
            data = resp.json()
            return data.get("results", []) if isinstance(data, dict) else data
        except Exception as e:
            print(f"[Search Error] {query}: {e}")
            return []


# ==========================================
# Intelligent Multi-Format Job Analyzer
# ==========================================
class JobAnalyzer:
    """Parses arbitrary job description text dumps (career sites, LinkedIn, etc.)
    into a structured JobContext with company, title, location, department."""

    # Boilerplate phrases that should never be treated as company/role
    STOP_WORDS = {
        "the job", "the role", "this role", "the position", "our team", "the company",
        "this job", "in progress", "clicked apply", "notifications", "messaging",
        "home", "my network", "jobs", "for business", "advertise", "verified job",
        "job match", "tailor my resume", "start application", "apply now", "why", "about",
        "careers", "working at", "skip to content", "equal opportunity employer",
        "back to jobs", "back to careers", "apply for this job", "select",
        "first name", "last name", "email", "phone", "resume", "cover letter",
        "voluntary self-identification", "disability status", "veteran status",
        "gender", "public burden statement", "form cc-305", "powered by",
        "report", "autofill", "resume score", "profile", "autofill this page",
        "preview resume", "tailor resume", "improve my match", "no job description",
    }

    # Common application form noise markers — everything after these is stripped
    FORM_CUTOFF_MARKERS = [
        r"apply\s+for\s+this\s+job",
        r"voluntary\s+self[-\s]?identification",
        r"indicates\s+a\s+required\s+field",
        r"first\s+name\*",
        r"resume/cv\*",
        r"equal\s+opportunity\s+statement",
        r"equal\s+employment\s+opportunity",
        r"we\s+are\s+a\s+federal\s+contractor",
        r"form\s+cc-305",
        r"powered\s+by\s*\n",
        r"site\s+powered\s+by",
        # LinkedIn page noise
        r"See\s+how\s+you\s+compare",
        r"Exclusive\s+Job\s+Seeker\s+Insights",
        r"Set\s+alert\s+for\s+similar\s+jobs",
        r"More\s+jobs\b",
        r"People\s+you\s+can\s+reach\s+out\s+to",
        r"Show\s+Premium\s+Insights",
        r"Interested\s+in\s+working\s+with\s+us",
    ]

    # LinkedIn/job-board navigation noise — strip everything before "About the job"
    LINKEDIN_HEADER_MARKERS = [
        r"About\s+the\s+job\b",
        r"Job\s+description\b",
    ]

    DEPARTMENT_KEYWORDS = {
        "data & ai": ["data engineer", "data engineering", "flink", "kafka", "spark", "etl", "data platform", "data pipeline", "data scientist", "machine learning", "ml engineer", "ai engineer", "analytics"],
        "engineering": ["software engineer", "backend", "frontend", "fullstack", "infrastructure", "devops", "platform engineer", "sre", "systems engineer", "cloud engineer", "developer experience", "build engineer", "release engineer", "ci/cd", "c++", "c#", "java", "low latency", "distributed systems", "middleware"],
        "product": ["product manager", "product lead", "pm", "technical product", "group product"],
        "design": ["product designer", "ui/ux", "ux designer", "design lead", "brand designer"],
        "trading": ["trader", "quantitative trader", "market maker", "execution trader"],
        "security": ["security engineer", "appsec", "infosec", "cybersecurity"],
    }

    MANAGER_TITLES = {
        "data & ai": [
            "Data Engineering Manager", "Director of Data", "Head of Data", "Data Engineering Lead",
            "Software Engineering Manager", "Director of Engineering", "Engineering Manager"
        ],
        "engineering": [
            "Software Engineering Manager", "Engineering Manager", "Director of Engineering",
            "Head of Engineering", "Software Engineering Team Lead", "Director of Technology",
            "VP of Software Engineering", "Platform Engineering Manager", "DevOps Manager",
            "Head of Platform", "Director of Platform Engineering"
        ],
        "product": ["Director of Product", "Head of Product", "Group Product Manager", "VP of Product"],
        "design": ["Design Manager", "Head of Design", "Director of Product Design"],
        "trading": ["Head of Trading", "Trading Lead", "Managing Director"],
        "security": ["Head of Security", "Director of Security", "Security Engineering Manager"],
    }

    # Well-known brands for fuzzy recognition
    KNOWN_BRANDS = [
        "Sony Interactive Entertainment", "PlayStation", "Belvedere Trading", "Stripe", "Notion",
        "OpenAI", "Anthropic", "Databricks", "Snowflake", "Figma", "Ramp", "Brex", "Roblox",
        "ByteDance", "TikTok", "Apple", "Google", "Microsoft", "Amazon", "Meta", "Netflix",
        "Uber", "Airbnb", "Lyft", "DoorDash", "Instacart", "Coinbase", "Palantir", "SpaceX",
        "Tesla", "Waymo", "Cruise", "Aurora", "Nuro", "Toast", "Square", "Block", "Cloudflare",
        "HashiCorp", "Twilio", "Datadog", "Splunk", "Elastic", "MongoDB", "Confluent",
        "Lab37", "Lab37 Robotics",
    ]

    # Alias map for parent/subsidiary relationships
    ALIAS_MAP = {
        "sony interactive entertainment": ["PlayStation", "SIE", "Sony"],
        "playstation": ["Sony Interactive Entertainment", "SIE"],
        "sie": ["Sony Interactive Entertainment", "PlayStation"],
        "bytedance": ["TikTok"],
        "tiktok": ["ByteDance"],
        "block": ["Square", "Cash App"],
        "square": ["Block"],
        "meta": ["Facebook", "Instagram", "WhatsApp"],
        "lab37 robotics": ["Lab37"],
        "lab37": ["Lab37 Robotics"],
    }

    @classmethod
    def _strip_form_boilerplate(cls, text: str) -> str:
        """Remove application form noise and LinkedIn page chrome from pasted JDs."""
        # Strip LinkedIn header noise — find "About the job" and discard nav above it
        for marker in cls.LINKEDIN_HEADER_MARKERS:
            m = re.search(marker, text, re.IGNORECASE)
            if m:
                text = text[m.end():].strip()
                break

        # Strip footer/form noise
        for marker in cls.FORM_CUTOFF_MARKERS:
            m = re.search(marker, text, re.IGNORECASE)
            if m:
                text = text[:m.start()].strip()
        return text

    @classmethod
    def extract_company_and_aliases(cls, text: str) -> Tuple[str, List[str]]:
        """Extracts the primary company name and any alternate brand names/aliases."""
        # Explicit label at very top of text (e.g. "Company, Belvedere Trading, LLC.")
        explicit_m = re.search(r"(?:Company|Employer|Organization)[,\s:\-–]+\s*([A-Za-z0-9][\w\s,\.\-&]+?)(?:\s*(?:LLC|Inc|Ltd|Corporation|Corp)\.?)?(?:\n|$)", text, re.IGNORECASE)
        explicit_top_company = None
        if explicit_m:
            val = explicit_m.group(1).strip(" ,.\n\t")
            val = re.sub(r"\s*(LLC|Inc|Ltd|Corporation|Corp)\.?$", "", val, flags=re.IGNORECASE).strip(" ,.\n\t")
            if 2 < len(val) < 50 and val.lower() not in cls.STOP_WORDS:
                explicit_top_company = val

        # Strip form boilerplate BEFORE parsing body
        clean_text = cls._strip_form_boilerplate(text)

        primary = ""
        aliases = []
        candidates = []
        if explicit_top_company:
            candidates.append(explicit_top_company)

        # Strategy 0: "Who we are" / "About us" section — look for the first sentence
        # e.g. "Lab37 Robotics, is a technology company..."
        who_patterns = [
            r"(?:Who\s+we\s+are|About\s+us|About\s+the\s+company|Our\s+Company)\s*\n+\s*([A-Za-z0-9][\w\s,\.\-&]+?)(?:,?\s+is\s+a\s+|\s+is\s+the\s+|\s+builds\s+|\s+creates\s+|\s+provides\s+|\s+develops\s+)",
            r"(?:Who\s+we\s+are|About\s+us)\s*\n+\s*At\s+([A-Za-z0-9][\w\s,\.\-&]+?),\s+we\s+",
        ]
        for pat in who_patterns:
            m = re.search(pat, clean_text, re.IGNORECASE)
            if m:
                val = m.group(1).strip(" ,.\n\t")
                val = re.sub(r"\s*(LLC|Inc|Ltd|Corporation|Corp)\.?$", "", val, flags=re.IGNORECASE).strip()
                if 2 < len(val) < 50 and val.lower() not in cls.STOP_WORDS:
                    candidates.append(val)

        # Strategy 1: "Why [Company]?" or "About [Company]" header patterns
        header_patterns = [
            r"Why\s+([A-Za-z0-9\s,\.\-&]+?)\?",
            r"About\s+([A-Za-z0-9\s,\.\-&]+?)(?:\:|\n|\.|\s*—)",
            r"Working\s+At\s+([A-Za-z0-9\s,\.\-&]+?)(?:\n|$)",
            r"([A-Za-z0-9\s,\.\-&]+?)\s+is\s+an\s+Equal\s+Opportunity\s+Employer",
            r"([A-Za-z0-9\s,\.\-&]+?)\s+is\s+a\s+leading",
            r"set\s+forth\s+in\s+([A-Za-z0-9\s,\.\-&]+?)'s\s+Equal",
        ]
        for pat in header_patterns:
            for m in re.finditer(pat, clean_text, re.IGNORECASE):
                val = m.group(1).strip(" ,.\n\t—:?")
                clean_val = re.sub(r"\s*(LLC|Inc|Ltd|Corporation|Corp)\.?$", "", val, flags=re.IGNORECASE).strip(" ,.\n\t")
                if clean_val.lower() not in cls.STOP_WORDS and 2 < len(clean_val) < 45:
                    candidates.append(clean_val)

        # Strategy 2: Known brand recognition in the cleaned text
        for brand in cls.KNOWN_BRANDS:
            if brand.lower() in clean_text.lower():
                candidates.append(brand)

        # Strategy 3: Footer copyright "© 2026 Company Name LLC"
        copyright_m = re.search(r"©\s*\d{4}\s+([A-Za-z0-9\s,\.\-&]+?)(?:LLC|Inc|Ltd|Corporation|\n|$)", clean_text, re.IGNORECASE)
        if copyright_m:
            val = copyright_m.group(1).strip(" ,.\n\t")
            if val.lower() not in cls.STOP_WORDS and 2 < len(val) < 45:
                candidates.append(val)

        if candidates:
            counter = Counter(candidates)
            primary = counter.most_common(1)[0][0]
            for c in counter.keys():
                if c.lower() != primary.lower() and c.lower() not in [a.lower() for a in aliases]:
                    aliases.append(c)

        # Apply alias map
        lookup_key = primary.lower().strip()
        if lookup_key in cls.ALIAS_MAP:
            for alias in cls.ALIAS_MAP[lookup_key]:
                if alias.lower() != primary.lower() and alias.lower() not in [a.lower() for a in aliases]:
                    aliases.append(alias)

        if not primary:
            primary = "Target Company"

        return primary, aliases

    @classmethod
    def extract_title(cls, text: str) -> str:
        """Extracts the job title from the JD text."""
        lines = text.strip().split("\n")

        # Strategy 0: Look at the first ~10 non-empty lines for a standalone title line
        # Common format: line 1 = "Back to jobs", line 2 = "Cloud Platform - Developer Experience Engineer", line 3 = "Pittsburgh, PA"
        # Also handles: line 1 = "Data Engineer II", line 2 = "Aliso Viejo, CA"
        title_keywords = [
            "engineer", "developer", "manager", "scientist", "architect", "lead",
            "director", "designer", "trader", "analyst", "specialist", "coordinator",
            "administrator", "consultant", "strategist", "associate", "intern",
        ]
        for i, line in enumerate(lines[:15]):
            stripped = line.strip()
            if not stripped or len(stripped) < 5 or len(stripped) > 80:
                continue
            # Skip nav/boilerplate lines
            if stripped.lower() in cls.STOP_WORDS:
                continue
            if any(stripped.lower().startswith(s) for s in ["let's", "no job", "improve", "who we"]):
                continue
            # Check if this line looks like a job title
            if any(kw in stripped.lower() for kw in title_keywords):
                # Clean it up
                clean = re.sub(r"\(Verified job\).*", "", stripped).strip(" ,.")
                if 5 < len(clean) < 80:
                    return clean

        # Strategy 1: Explicit patterns "Role:", "Position:", "Title:"
        explicit = re.search(r"(?:Role|Position|Title)\s*:\s*([A-Za-z0-9\s,\-\(\)/]+?)(?:\n|$)", text, re.IGNORECASE)
        if explicit:
            val = explicit.group(1).strip(" ,.\n\t:")
            if 3 < len(val) < 50 and val.lower() not in cls.STOP_WORDS:
                return val

        # Strategy 2: Regex for common title patterns
        m = re.search(
            r"([A-Za-z0-9\s\-/]+\s*(?:Engineer|Developer|Manager|Scientist|Architect|Lead|Director|Designer|Trader|Analyst)(?:\s+(?:I|II|III|IV|V|Staff|Senior|Lead|Entry Level|Graduate|\d{4}))?)",
            text, re.IGNORECASE
        )
        if m:
            val = m.group(1).strip(" ,.\n\t:")
            clean_title = re.sub(r"\(Verified job\).*", "", val).strip(" ,.")
            if 3 < len(clean_title) < 60 and clean_title.lower() not in cls.STOP_WORDS:
                return clean_title

        return "Software Engineer"

    @classmethod
    def extract_location(cls, text: str) -> Optional[str]:
        """Extracts location, prioritizing US City, ST format."""
        # Strip form boilerplate first
        clean_text = cls._strip_form_boilerplate(text)
        lines = clean_text.strip().split("\n")

        # Strategy 0: Look at first ~10 lines for a standalone location line like "Pittsburgh, PA"
        us_states = {
            "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN",
            "IA", "KS", "KY", "LA", "MA", "MD", "ME", "MI", "MN", "MS", "MO", "MT", "NE", "NV",
            "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN",
            "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC",
        }
        for i, line in enumerate(lines[:15]):
            stripped = line.strip()
            m = re.match(r"^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),\s*([A-Z]{2})$", stripped)
            if m and m.group(2) in us_states:
                return m.group(0)

        # Strategy 1: "Location(s): ..." or "Location: ..."
        loc_match = re.search(r"Location(?:\(s\))?\s*:\s*(?:United States,?\s*)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s*[A-Z]{2})", clean_text)
        if loc_match:
            return loc_match.group(1).strip()

        # Strategy 2: General City, ST pattern
        m = re.search(r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),\s*([A-Z]{2})\b", clean_text)
        if m and m.group(2) in us_states:
            return m.group(0)

        return None

    @classmethod
    def extract_subteam(cls, title: str, text: str = "") -> Optional[str]:
        """Tries to identify the specific sub-team from the JD text."""
        clean_text = cls._strip_form_boilerplate(text)
        patterns = [
            r"(?:The\s+([A-Za-z0-9\s]+?\s+Team)\s+fuels)",
            r"(?:join\s+our|part\s+of\s+the|member\s+of\s+the)\s+([A-Za-z0-9\s]+?)\s+(?:team|group|org|platform)",
            r"([A-Za-z0-9\s]+?\s+Data\s+Platform)",
            r"(?:Cloud\s+Streaming|Payment\s+Methods|Low\s+Latency|Core\s+Infrastructure|Proprietary\s+Trading|Developer\s+Experience|Developer\s+Platform)",
        ]
        for pat in patterns:
            m = re.search(pat, clean_text, re.IGNORECASE)
            if m:
                res = m.group(1) if m.groups() and m.group(1) else m.group(0)
                clean = res.strip().title()
                if 2 < len(clean) < 40:
                    return clean
        return None

    @classmethod
    def parse_from_text(cls, text: str) -> JobContext:
        company, aliases = cls.extract_company_and_aliases(text)
        title = cls.extract_title(text)
        location = cls.extract_location(text)
        subteam = cls.extract_subteam(title, text)

        # Determine department from title + cleaned text (no form boilerplate)
        clean_text = cls._strip_form_boilerplate(text)
        combined = f"{title} {subteam or ''} {clean_text}".lower()
        dept = "engineering"
        for d, kws in cls.DEPARTMENT_KEYWORDS.items():
            if any(kw in combined for kw in kws):
                dept = d
                break

        return JobContext(
            company=company,
            aliases=aliases,
            title=title,
            subteam=subteam,
            department=dept,
            location=location,
            raw_text=text,
        )


# ==========================================
# Targeted Search & Verification Engine
# ==========================================
class HiringManagerFinder:
    """Searches for the hiring manager using LinkedIn X-ray queries via TinyFish."""

    # US LinkedIn domain patterns (filter OUT non-US results)
    US_LINKEDIN_PATTERN = re.compile(r"^https?://(?:www\.)?linkedin\.com/in/")

    def __init__(self, client: Optional[TinyFishClient] = None):
        self.client = client or TinyFishClient()

    def _is_us_linkedin(self, url: str) -> bool:
        """Only allow linkedin.com/in/ (US). Reject uk.linkedin.com, fr.linkedin.com, etc."""
        return bool(self.US_LINKEDIN_PATTERN.match(url))

    def build_queries(self, job: JobContext) -> List[Dict[str, str]]:
        queries = []
        company_names = [f'"{job.company}"'] + [f'"{a}"' for a in job.aliases[:2] if len(a) > 2]
        company_query_str = " OR ".join(company_names)

        dept = job.department or "engineering"
        manager_titles = JobAnalyzer.MANAGER_TITLES.get(dept, ["Engineering Manager", "Director of Engineering"])
        mgrs_or = " OR ".join([f'"{m}"' for m in manager_titles[:4]])
        loc_str = f' "{job.location}"' if job.location and job.location.lower() != "remote" else ""

        # Tier 1: Location & Department specific leadership
        queries.append({
            "type": "Target Location Managers & Leads",
            "query": f'site:linkedin.com/in ({company_query_str}) ({mgrs_or}){loc_str}'
        })

        # Tier 2: General Department & Technical Managers
        queries.append({
            "type": "Department Engineering Leadership",
            "query": f'site:linkedin.com/in ({company_query_str}) ({mgrs_or})'
        })

        # Tier 3: Senior Technical Leaders & Directors
        queries.append({
            "type": "Executive Directors & VPs",
            "query": f'site:linkedin.com/in ({company_query_str}) ("Director of Engineering" OR "VP of Engineering" OR "Head of Engineering" OR "CTO")'
        })

        # Tier 4: LinkedIn People tab approach — search for team members with relevant titles
        if job.subteam:
            queries.append({
                "type": "Sub-Team Leadership",
                "query": f'site:linkedin.com/in ({company_query_str}) ("{job.subteam}" OR "Manager" OR "Lead")'
            })

        # Tier 5: Technical Recruiters / Talent Acquisition
        queries.append({
            "type": "Technical & Talent Recruiters",
            "query": f'site:linkedin.com/in ({company_query_str}) ("Technical Recruiter" OR "Lead Recruiter" OR "Talent Acquisition")'
        })

        return queries

    def _score_candidate(self, item: Dict[str, Any], job: JobContext) -> Optional[Candidate]:
        raw_title = item.get("title", "")
        url = item.get("url", "")
        snippet = item.get("snippet", "") or item.get("description", "")

        if "linkedin.com/in/" not in url:
            return None

        # US-ONLY FILTER: Reject non-US LinkedIn domains (uk.linkedin.com, etc.)
        if not self._is_us_linkedin(url):
            return None

        # Clean title
        clean = re.sub(r"\s*(\|\s*LinkedIn.*|\-\s*LinkedIn.*)$", "", raw_title, flags=re.IGNORECASE).strip()
        name, headline = "Unknown Name", clean
        for sep in [" - ", " – ", " | "]:
            if sep in clean:
                parts = clean.split(sep, 1)
                name, headline = parts[0].strip(), parts[1].strip()
                break

        full_text = f"{headline} {snippet}".lower()

        # Check against company and all aliases
        all_company_terms = [job.company.lower()] + [a.lower() for a in job.aliases]
        clean_terms = []
        for t in all_company_terms:
            t_clean = re.sub(r"\s*(llc|inc|ltd|corporation|corp)\.?$", "", t).strip()
            if len(t_clean) >= 3:
                clean_terms.append(t_clean)

        # CRITICAL FILTER: Profile MUST match target company or its verified aliases
        matched_company = False
        for term in clean_terms:
            if term in full_text:
                matched_company = True
                break

        if not matched_company:
            return None

        is_current = not ("ex-" in headline.lower() or "former" in headline.lower())
        if not is_current and "present" not in full_text:
            is_past = True
        else:
            is_past = False

        score = 50
        reasons = [f"Works at {job.company}"]

        # Location Bonus
        if job.location and job.location.lower() in full_text:
            score += 15
            reasons.append(f"Located in {job.location}")

        # Discipline & Role Match
        is_manager = any(m in full_text for m in ["manager", "team lead", "lead engineer", "engineering lead", "lead data", "data engineering manager", "software engineering manager", "platform engineering manager"])
        is_exec = any(e in full_text for e in ["director", "head of", "vp", "vice president", "cto"])
        is_recruiter = any(r in full_text for r in ["recruiter", "talent acquisition", "sourcing", "recruiting"])

        # Exact discipline match in headline
        has_exact_discipline = False
        if job.department == "data & ai" and any(k in full_text for k in ["data engineer", "data engineering", "data platform", "data analytics"]):
            has_exact_discipline = True
        elif job.department == "engineering" and any(k in full_text for k in ["software engineer", "software engineering", "backend", "platform engineer", "developer experience", "devops", "ci/cd", "build engineer"]):
            has_exact_discipline = True

        if is_manager and not is_past:
            category = "🎯 Engineering Manager / Team Lead"
            score += 35
            if has_exact_discipline:
                score += 15
                reasons.append(f"Direct manager matching {job.title} domain")
            else:
                reasons.append(f"Engineering manager at {job.company}")
        elif is_exec and not is_past:
            category = "👑 Director / Executive Leader"
            score += 30
            if has_exact_discipline:
                score += 15
                reasons.append(f"Director overseeing {job.department} domain")
            else:
                reasons.append(f"Executive technology leadership at {job.company}")
        elif is_recruiter and not is_past:
            category = "🤝 Technical Recruiter / Talent"
            score += 25
            reasons.append("Technical recruitment partner")
        else:
            category = "👥 Senior Engineer / Team Member"
            score += 15
            reasons.append("Engineer / practitioner at target company")

        if is_past:
            score -= 30
            reasons.append("(Past employee / alumni)")

        confidence = "High Match" if score >= 80 else ("Strong Lead" if score >= 60 else "Related Lead")

        return Candidate(
            name=name,
            headline=headline,
            linkedin_url=url,
            category=category,
            snippet=snippet,
            confidence=confidence,
            match_score=score,
            match_reason="; ".join(reasons),
        )

    def find(self, job: JobContext) -> Dict[str, Any]:
        queries = self.build_queries(job)
        seen_urls = set()
        candidates: List[Candidate] = []

        for q in queries:
            results = self.client.search(q["query"])
            for r in results:
                cand = self._score_candidate(r, job)
                if cand and cand.linkedin_url not in seen_urls:
                    seen_urls.add(cand.linkedin_url)
                    candidates.append(cand)

        candidates.sort(key=lambda c: c.match_score, reverse=True)

        categorized: Dict[str, List[Candidate]] = {
            "🎯 Engineering Manager / Team Lead": [],
            "👑 Director / Executive Leader": [],
            "🤝 Technical Recruiter / Talent": [],
            "👥 Senior Engineer / Team Member": [],
        }

        for c in candidates:
            if c.category in categorized:
                categorized[c.category].append(c)

        top_hm = None
        for cat_key in ["🎯 Engineering Manager / Team Lead", "👑 Director / Executive Leader", "🤝 Technical Recruiter / Talent"]:
            if categorized.get(cat_key):
                top_hm = categorized[cat_key][0]
                break

        return {
            "job_context": job,
            "results": categorized,
            "top_hiring_manager": top_hm,
        }


# ==========================================
# Skill File Loader (Role-Aware)
# ==========================================
class SkillFileLoader:
    """Reads candidate skill files and builds a role-specific profile summary for the LLM.
    Filters experience sections to match the target job's domain/department."""

    # Files to read (order = priority)
    PROFILE_FILES = [
        "datahub-workex.md",    # Current role
        "zipline_workex.md",    # Zipline internship
        "squadron-workex.md",   # Squadron experience
        "csula-workex.md",      # CSULA research
    ]

    # Map job department to keywords that identify relevant experience sections
    DOMAIN_KEYWORDS = {
        "data & ai": [
            "etl", "data engineer", "data pipeline", "snowflake", "kafka", "flink",
            "spark", "glue", "step functions", "data platform", "analytics",
            "postgresql", "dbt", "data processing", "batch processing", "stream processing",
            "redshift", "opensearch", "data warehouse", "lambda", "serverless",
        ],
        "engineering": [
            "software engineer", "backend", "api", "fastapi", "flask", "node.js",
            "kubernetes", "docker", "ci/cd", "github actions", "terraform",
            "infrastructure", "devops", "platform", "bazel", "ansible",
            "distributed systems", "microservices", "deployment",
        ],
        "security": [
            "security", "encryption", "kms", "iam", "compliance", "devsecops",
            "vulnerability", "secret scanning",
        ],
        "product": [
            "product", "analytics", "dashboard", "visualization", "recharts",
        ],
    }

    @classmethod
    def _clean_latex(cls, text: str) -> str:
        """Strip LaTeX formatting for LLM readability."""
        text = re.sub(r"\\textbf\{([^}]+)\}", r"\1", text)
        text = re.sub(r"\\item\s*", "• ", text)
        text = re.sub(r"\\char37\{?\}?", "%", text)
        text = re.sub(r"%\s*CC:.*", "", text)
        text = re.sub(r"\\&", "&", text)
        return text

    @classmethod
    def _extract_relevant_sections(cls, content: str, department: str) -> str:
        """Extract only the bullet sections relevant to the target role's domain."""
        keywords = cls.DOMAIN_KEYWORDS.get(department, cls.DOMAIN_KEYWORDS["engineering"])

        # Split by ## headers (each section is a different project/experience block)
        sections = re.split(r"(?=^## )", content, flags=re.MULTILINE)

        scored_sections = []
        for section in sections:
            if len(section.strip()) < 20:
                continue
            lower = section.lower()
            score = sum(1 for kw in keywords if kw in lower)
            if score > 0:
                scored_sections.append((score, section.strip()))

        # Sort by relevance score descending, take top 4
        scored_sections.sort(key=lambda x: x[0], reverse=True)
        best = [s[1] for s in scored_sections[:4]]

        return "\n\n".join(best) if best else content[:1200]

    @classmethod
    def load_profile_summary(cls, skills_dir: str = SKILLS_DIR, department: str = "engineering") -> str:
        """Load work experience files and produce a role-specific profile summary."""
        if not os.path.isdir(skills_dir):
            return ""

        all_relevant = []
        for fname in cls.PROFILE_FILES:
            fpath = os.path.join(skills_dir, fname)
            if not os.path.exists(fpath):
                continue
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    content = f.read()
                clean = cls._clean_latex(content)
                relevant = cls._extract_relevant_sections(clean, department)
                if relevant:
                    all_relevant.append(relevant)
            except Exception:
                continue

        if not all_relevant:
            return ""

        # Combine and cap total length for LLM context
        combined = "\n\n---\n\n".join(all_relevant)
        return combined[:4000]


# ==========================================
# Groq-Powered Outreach Generator
# ==========================================
class OutreachGenerator:
    """Generates personalized outreach messages using Groq LLM,
    informed by the candidate's actual skill files and following
    proven outreach templates."""

    HUMAN_VOICE_PROMPT = (
        "Rewrite the following text so it sounds like a real person explaining their thoughts "
        "in a casual conversation over coffee. Vary your sentence lengths—mix very short sentences "
        "with longer, flowing ones. Use contractions naturally (like don't, I've, or it's). "
        "Strictly avoid robotic AI transition words and filler phrases, such as: 'furthermore', "
        "'moreover', 'consequently', 'it is worth noting', 'delve', 'pivotal', 'in conclusion', "
        "and 'notwithstanding'. Do not use excessive em dashes or forced bulleted lists unless "
        "explicitly asked. Write with a clear, direct, and slightly opinionated voice."
    )

    OUTREACH_TEMPLATES = {
        "hiring_manager": {
            "linkedin": (
                "Hi {name},\n\n"
                "I recently applied for the {role} role on your team and wanted to personally "
                "introduce myself. My background includes {key_skill} with a focus on {impact}.\n\n"
                "I'd love to learn what success looks like in this role over the first 6–12 months.\n\n"
                "Thanks,\n{candidate_name}"
            ),
            "email": (
                "Subject: Quick introduction – {role} candidate\n\n"
                "Hi {name},\n\n"
                "I recently applied for the {role} position on your team. My experience in "
                "{domain} aligns closely with the team's work.\n\n"
                "I'd appreciate the opportunity to briefly introduce myself and learn more about "
                "what you value most in this role.\n\n"
                "Thank you,\n{candidate_name}\n"
                "LinkedIn: {linkedin_url}"
            ),
        },
        "recruiter": {
            "linkedin": (
                "Hi {name},\n\n"
                "I came across the {role} opening at {company} and noticed you recruit for this team. "
                "With {experience_summary}, I'd love to stay on your radar.\n\n"
                "Would you be open to a quick chat, or is there anything specific you look for "
                "in strong candidates for this role?\n\n"
                "Thanks,\n{candidate_name}"
            ),
            "email": (
                "Subject: Interest in {role} at {company}\n\n"
                "Hi {name},\n\n"
                "I'm reaching out regarding the {role} role at {company}. I have "
                "{experience_summary}, most recently working on {recent_achievement}.\n\n"
                "I'd love to understand what you look for in top candidates and whether my "
                "background could be a fit.\n\n"
                "Best,\n{candidate_name}\n"
                "LinkedIn: {linkedin_url}"
            ),
        },
        "team_member": {
            "linkedin": (
                "Hi {name},\n\n"
                "I hope you're doing well. I saw that you're at {company} and I'm currently "
                "exploring opportunities in {domain}.\n\n"
                "If you're comfortable, I'd love to ask a few questions about the team and your "
                "experience—and potentially whether a referral makes sense.\n\n"
                "Totally understand either way. Thanks so much,\n{candidate_name}"
            ),
            "email": (
                "Subject: Quick question about {company}\n\n"
                "Hi {name},\n\n"
                "I'm currently exploring roles in {domain} and noticed your work at {company}.\n\n"
                "I'd love to hear about your experience and get your perspective on the team.\n\n"
                "Thanks in advance,\n{candidate_name}\n"
                "LinkedIn: {linkedin_url}"
            ),
        },
    }

    def __init__(self, groq_api_key: str = GROQ_API_KEY, skills_dir: str = SKILLS_DIR, department: str = "engineering"):
        self.groq_client = Groq(api_key=groq_api_key)
        self.department = department
        self.candidate_profile = SkillFileLoader.load_profile_summary(skills_dir, department=department)

    def _get_template_type(self, candidate: Candidate) -> str:
        if "Recruiter" in candidate.category:
            return "recruiter"
        elif "Engineer" in candidate.category or "Team Member" in candidate.category:
            return "team_member"
        else:
            return "hiring_manager"

    def _call_groq(self, prompt: str) -> str:
        """Call Groq API and return clean response text."""
        try:
            completion = self.groq_client.chat.completions.create(
                model="qwen/qwen3.6-27b",
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "/no_think\n\n"
                            "You are an elite career coach and executive copywriter. "
                            "You write concise, high-converting job search outreach messages. "
                            f"{self.HUMAN_VOICE_PROMPT}\n\n"
                            "CRITICAL RULES:\n"
                            "- LinkedIn connection notes MUST be under 300 characters total\n"
                            "- Emails should be 4-6 sentences max, punchy and direct\n"
                            "- Never use generic filler like 'I hope this finds you well'\n"
                            "- Always include a specific low-friction CTA (10-min call, quick chat)\n"
                            "- ONLY reference experience that DIRECTLY matches the target role's domain\n"
                            "- For a data engineering role: mention ETL, pipelines, Snowflake, Kafka, Flink, data platforms — NOT CI/CD label sync or Ansible\n"
                            "- For a platform/devops role: mention Kubernetes, Terraform, CI/CD, Docker — NOT ETL or data warehouses\n"
                            "- Output ONLY the final messages. No thinking, no explanations, no commentary, no reasoning."
                        ),
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0.5,
                max_completion_tokens=4096,
                stream=False,
            )
            raw = completion.choices[0].message.content or ""
            # Strip <think>...</think> reasoning tags (greedy to catch all)
            raw = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL)
            # Also strip any remaining think-like patterns
            raw = re.sub(r"</?think>", "", raw)
            # Strip any leading/trailing whitespace artifacts
            return raw.strip()
        except Exception as e:
            print(f"  [Groq API Error] {e}")
            return ""

    def generate(self, candidate: Candidate, job: JobContext) -> Dict[str, str]:
        """Generate personalized outreach using Groq LLM + candidate skill files."""
        first_name = candidate.name.split()[0] if candidate.name and candidate.name != "Unknown Name" else "there"
        template_type = self._get_template_type(candidate)

        # Build the LLM prompt with role-filtered experience
        profile_section = ""
        if self.candidate_profile:
            profile_section = (
                f"\n\n--- CANDIDATE'S {self.department.upper()} EXPERIENCE (use ONLY these role-relevant facts) ---\n"
                f"{self.candidate_profile[:3000]}\n"
                f"--- END CANDIDATE PROFILE ---\n"
                f"IMPORTANT: The target role is {job.title} in {job.department}. "
                f"Reference ONLY experience that matches this domain. "
                f"Do NOT mention unrelated experience from other domains."
            )

        prompt = f"""Generate TWO outreach messages for this specific situation:

TARGET PERSON:
- Name: {candidate.name}
- Title/Headline: {candidate.headline}
- Category: {template_type.replace('_', ' ').title()}
- LinkedIn: {candidate.linkedin_url}
- Company: {job.company}

JOB CONTEXT:
- Role: {job.title}
- Company: {job.company}
- Location: {job.location or 'Not specified'}
- Department: {job.department}
- Sub-team: {job.subteam or 'General'}

YOUR NAME (the person sending the message): Yash

TEMPLATE TO FOLLOW (adapt, don't copy verbatim):
LinkedIn Message Template:
{self.OUTREACH_TEMPLATES[template_type]['linkedin']}

Email Template:
{self.OUTREACH_TEMPLATES[template_type]['email']}
{profile_section}

OUTPUT FORMAT (exactly like this):
LINKEDIN CONNECTION NOTE:
[your note here, MUST be under 300 characters]

COLD EMAIL:
[your email here]

FOLLOW-UP (send after 5-7 days if no response):
[short follow-up message]
"""

        llm_response = self._call_groq(prompt)

        if not llm_response:
            # Fallback to template-based generation if Groq fails
            return self._fallback_generate(candidate, job, first_name, template_type)

        # Parse the LLM response into sections
        connection_note = ""
        email_draft = ""
        followup = ""

        sections = re.split(r"(?:LINKEDIN CONNECTION NOTE|COLD EMAIL|FOLLOW-UP)\s*:?\s*\n", llm_response, flags=re.IGNORECASE)
        if len(sections) >= 3:
            connection_note = sections[1].strip()
            email_draft = sections[2].strip()
        if len(sections) >= 4:
            followup = sections[3].strip()

        # If parsing failed, try a simpler split
        if not connection_note and not email_draft:
            parts = llm_response.split("\n\n", 2)
            connection_note = parts[0] if parts else ""
            email_draft = parts[1] if len(parts) > 1 else ""

        # Enforce 300-char limit on connection note
        if len(connection_note) > 300:
            connection_note = connection_note[:297] + "..."

        return {
            "connection_note": connection_note,
            "inmail_draft": email_draft,
            "followup": followup,
        }

    def _fallback_generate(self, candidate: Candidate, job: JobContext, first_name: str, template_type: str) -> Dict[str, str]:
        """Static fallback if Groq API is unavailable."""
        templates = self.OUTREACH_TEMPLATES[template_type]
        connection_note = templates["linkedin"].format(
            name=first_name,
            role=job.title,
            company=job.company,
            key_skill="distributed systems and cloud infrastructure",
            impact="building production-grade data and platform tooling",
            candidate_name="Yash",
            experience_summary="experience in Python, Kubernetes, AWS, and CI/CD",
            domain=job.department or "engineering",
            linkedin_url="",
        )[:295]

        email_draft = templates["email"].format(
            name=first_name,
            role=job.title,
            company=job.company,
            domain=job.department or "engineering",
            candidate_name="Yash",
            linkedin_url="[LinkedIn]",
            experience_summary="experience in Python, Kubernetes, AWS, and CI/CD infrastructure",
            recent_achievement="building AI-powered Kubernetes troubleshooting agents",
        )

        return {
            "connection_note": connection_note,
            "inmail_draft": email_draft,
            "followup": f"Hi {first_name},\n\nJust following up on my message below in case it got buried. I'd still love to connect if you're open to it.\n\nThanks again,\nYash",
        }


# ==========================================
# Main CLI Runner
# ==========================================
def run_hm_finder(jd_filepath: str = "job_description.txt"):
    if not os.path.exists(jd_filepath):
        print(f"❌ Error: File '{jd_filepath}' not found.")
        return

    with open(jd_filepath, "r", encoding="utf-8") as f:
        jd_text = f.read().strip()

    if not jd_text:
        print(f"❌ Error: '{jd_filepath}' is empty.")
        return

    print("=" * 75)
    print("🎯 HIRING MANAGER FINDER — POWERED BY TINYFISH + GROQ AI")
    print(f"📄 Reading Job Description from: {jd_filepath}")
    print("=" * 75)

    job = JobAnalyzer.parse_from_text(jd_text)
    print(f"\n📋 Detected Job Signals:")
    print(f"   • Company:    {job.company}" + (f" (aka {', '.join(job.aliases)})" if job.aliases else ""))
    print(f"   • Role:       {job.title}")
    print(f"   • Location:   {job.location or 'Not specified'}")
    print(f"   • Discipline: {job.department}")
    if job.subteam:
        print(f"   • Sub-Team:   {job.subteam}")
    print(f"   🇺🇸 Filtering to US-based LinkedIn profiles only")

    # Load candidate profile from skill files
    profile_loaded = os.path.isdir(SKILLS_DIR)
    if profile_loaded:
        print(f"   📂 Loaded candidate skills from: skills-files/")
    else:
        print(f"   ⚠️  No skills-files/ directory found. Using generic outreach.")

    finder = HiringManagerFinder()
    search_data = finder.find(job)
    top_hm = search_data["top_hiring_manager"]

    if top_hm:
        print("\n" + "=" * 75)
        print(f"⭐ TOP HIRING LEAD FOR {job.company.upper()}:")
        print(f"   Name:        {top_hm.name}")
        print(f"   Headline:    {top_hm.headline}")
        print(f"   Category:    {top_hm.category}")
        print(f"   Match Score: {top_hm.match_score}/100 ({top_hm.confidence})")
        print(f"   LinkedIn:    {top_hm.linkedin_url}")
        print(f"   Signal:      {top_hm.match_reason}")
        print("=" * 75)

        print(f"\n🤖 Generating AI-personalized outreach via Groq (filtered for {job.department} experience)...")
        outreach_gen = OutreachGenerator(department=job.department)
        outreach = outreach_gen.generate(top_hm, job)

        print("\n✉️  PERSONALIZED OUTREACH (AI-generated from your skill files):")
        print(f"\n{'─'*50}")
        print(f"1. LinkedIn Connection Request (<300 chars):")
        print(f"{'─'*50}")
        print(outreach["connection_note"])

        print(f"\n{'─'*50}")
        print(f"2. Cold Email / InMail Draft:")
        print(f"{'─'*50}")
        print(outreach["inmail_draft"])

        if outreach.get("followup"):
            print(f"\n{'─'*50}")
            print(f"3. Follow-Up (send after 5-7 days):")
            print(f"{'─'*50}")
            print(outreach["followup"])
    else:
        print(f"\n⚠️  No verified US-based hiring leads found for {job.company}.")
        print("   Try pasting a cleaner job description with fewer application form elements.")

    print(f"\n📊 ALL VERIFIED {job.company.upper()} TEAM MEMBERS (US only):")
    any_results = False
    for category, cands in search_data["results"].items():
        if not cands:
            continue
        any_results = True
        print(f"\n{category} ({len(cands)} verified):")
        for cand in cands[:4]:
            print(f"  • [{cand.match_score} pts] {cand.name} — {cand.headline}")
            print(f"    LinkedIn: {cand.linkedin_url}")
            print(f"    Signal:   {cand.match_reason}\n")

    if not any_results:
        print("\n   No US-based profiles matched. The company may be too small or new for LinkedIn coverage.")


if __name__ == "__main__":
    filepath = sys.argv[1] if len(sys.argv) > 1 else "job_description.txt"
    run_hm_finder(filepath)

