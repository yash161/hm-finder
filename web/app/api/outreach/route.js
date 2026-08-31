import { NextResponse } from "next/server";

const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

const CANDIDATE_PROFILE = `
CANDIDATE: Yash Shah — Recent M.S. CS grad (Cal State LA) & Ex-Zipline engineer. Software/Data Engineer with 3+ years experience.

CURRENT ROLE (DataHub):
• Built AI-powered Kubernetes troubleshooting agent for Redshift data platform (FastAPI, Python, LLM, Kubernetes)
• Deployed Coder (self-hosted AI coding agent platform) via Helm onto on-premises Kubernetes cluster
• Built agentic Azure cost investigation platform (React, TypeScript, FastAPI, Azure CLI, OpenAI)
• Built infrastructure drift detection platform in Go (Terraform state vs live cloud API)
• Deployed CI failure diagnosis agent with local Qwen3 model via Ollama

PREVIOUS (Zipline — Drone Delivery):
• Engineered automated label-sync pipeline in Python, eliminating drift across 330+ distributed HIL nodes
• Redesigned HIL claim workflow with automated selection and capability-based validation (Python, Bazel)
• Diagnosed GitHub API token exhaustion, shipped async fallback keeping label updates running
• Built github_email_resolver.py mapping GitHub usernames to verified emails via 4-tier fallback

PREVIOUS (Squadron — Data Engineering):
• Designed metadata-driven ETL pipeline replicating PostgreSQL, Google Analytics, S3 into Snowflake via AWS Step Functions
• Built dual-mode replication engine routing small tables to Lambda, large to Glue Spark workers
• Codified pipeline infrastructure across 34 Terraform files (Lambda, Glue, Step Functions, EventBridge, VPC, IAM)
• Engineered production-grade Scrapy crawling platform serving 8+ client organizations with scrapy-redis
• Built FastAPI middleware ingesting Daimler logistics feeds into TigerGraph

RESEARCH (CSULA):
• SITI-funded MS thesis: IoT ML pipeline for water leak detection (95.83% accuracy)
• NASA JPL-funded computer vision research: YOLOv11 on lunar imagery (92%+ mAP)
`;

// Domain-specific proof points for template fill
const DOMAIN_PROOF_POINTS = {
  "data & ai": {
    skills: ["ETL pipelines", "Snowflake", "AWS Step Functions"],
    zipline: "built an automated label-sync pipeline in Python that eliminated drift across 330+ distributed HIL nodes",
    datahub: "built an AI-powered Kubernetes troubleshooting agent for our Redshift data platform with FastAPI and LLM",
    squadron: "built a metadata-driven ETL pipeline replicating PostgreSQL, GA, and S3 into Snowflake via AWS Step Functions and Lambda/Glue Spark",
  },
  engineering: {
    skills: ["Kubernetes", "Go/Python", "Terraform IaC"],
    zipline: "built an automated label-sync pipeline in Python that eliminated drift across 330+ distributed HIL nodes",
    datahub: "built an infrastructure drift detection platform in Go that compares Terraform state against live cloud APIs",
    squadron: "wrote 34 Terraform files covering Lambda, Glue, Step Functions, EventBridge, VPC, and IAM for our pipeline infra",
  },
  security: {
    skills: ["DevSecOps", "IAM/KMS", "Kubernetes security"],
    zipline: "diagnosed a GitHub API token exhaustion bug and shipped an async fallback that kept label updates running",
    datahub: "built an infrastructure drift detection platform in Go (Terraform state vs live cloud API)",
    squadron: "wrote 34 Terraform files with IAM and VPC controls for our pipeline infrastructure",
  },
  product: {
    skills: ["Full-stack dev", "React/TypeScript", "FastAPI"],
    zipline: "built an automated label-sync pipeline in Python that eliminated drift across 330+ distributed HIL nodes",
    datahub: "built an Azure cost investigation platform with React, TypeScript, FastAPI, and OpenAI",
    squadron: "built a production Scrapy crawling platform serving 8+ client organizations",
  },
};

// ===== LLM Providers =====
async function callGroq(systemPrompt, userPrompt) {
  if (!GROQ_API_KEY) return null;
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "qwen/qwen3.8-27b",
        messages: [
          { role: "system", content: `/no_think\n\n${systemPrompt}` },
          { role: "user", content: `/no_think\n\n${userPrompt}` },
        ],
        temperature: 0.5,
        max_completion_tokens: 2048,
        stream: false,
      }),
    });
    if (!res.ok) {
      console.error("[Groq Error]", res.status, await res.text());
      return null;
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content || null;
  } catch (err) {
    console.error("[Groq Exception]", err);
    return null;
  }
}

async function callGemini(systemPrompt, userPrompt) {
  if (!GEMINI_API_KEY) return null;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ parts: [{ text: userPrompt }] }],
          generationConfig: { temperature: 0.5, maxOutputTokens: 2048 },
        }),
      }
    );
    if (!res.ok) {
      console.error("[Gemini Error]", res.status, await res.text());
      return null;
    }
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (err) {
    console.error("[Gemini Exception]", err);
    return null;
  }
}

// Try Groq first, fall back to Gemini
async function callLLM(systemPrompt, userPrompt) {
  let result = await callGroq(systemPrompt, userPrompt);
  if (result && result.trim().length > 20) {
    console.log("[Outreach] Used Groq");
    return result;
  }
  result = await callGemini(systemPrompt, userPrompt);
  if (result && result.trim().length > 20) {
    console.log("[Outreach] Used Gemini fallback");
    return result;
  }
  return null;
}

// ===== Banned Words (from skill files) =====
const BANNED_WORDS = [
  "codified", "engineered", "architected", "orchestrated", "spearheaded",
  "leveraged", "utilized", "harnessed", "facilitated", "streamlined",
  "cutting-edge", "state-of-the-art", "world-class", "best-in-class",
  "robust", "scalable", "pivotal", "synergy", "paradigm",
  "furthermore", "moreover", "consequently", "notwithstanding",
  "it is worth noting", "delve", "in conclusion",
  "modern DevOps practices", "generic best practices",
  "cross-functional collaboration", "stakeholder", "interpersonal",
  "game-changing", "transformative", "innovative solution",
  "passion for", "passionate about", "excited to",
  "seamless", "seamlessly", "holistic", "synergistic",
  "deep dive", "circle back", "move the needle",
  "touch base", "low-hanging fruit", "take it to the next level",
];

// ===== Clean LLM output =====
function cleanLLMOutput(raw) {
  if (!raw) return raw;
  // Strip <think> tags
  raw = raw.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/<\/?think>/g, "").trim();
  // Strip everything before first section header
  raw = raw.replace(/^[\s\S]*?(?=LINKEDIN CONNECTION NOTE)/i, "");
  // Strip reasoning blocks
  raw = raw.replace(/Thinking Process:[\s\S]*?(?=LINKEDIN CONNECTION NOTE|COLD EMAIL|$)/gi, "");
  raw = raw.replace(/\*\*(?:Deconstruct|Target|Role|Location|Sender|Relevant|Candidate|Rules|Output)[\s\S]*?(?=LINKEDIN CONNECTION NOTE|COLD EMAIL|FOLLOW-UP|$)/gi, "");
  raw = raw.replace(/^\d+\.\s+\*\*[\s\S]*?(?=LINKEDIN CONNECTION NOTE|COLD EMAIL|FOLLOW-UP|$)/gim, "");
  return raw.trim();
}

function cleanSection(s) {
  s = s
    .replace(/^\s*\*\*(?:Deconstruct|Target|Role|Location|Sender|Relevant|Candidate|Rules|Output).*$/gim, "")
    .replace(/^\s*\*\s+\*\*.*$/gim, "")
    .replace(/^\s*\d+\.\s+\*\*.*$/gim, "")
    .replace(/^Thinking Process:.*$/gim, "")
    .trim();
  // Strip em-dashes and replace with plain dashes or commas
  s = s.replace(/\s*[\u2014\u2013]\s*/g, " - ");
  // Strip excessive dashes (--- or --)
  s = s.replace(/\s*---+\s*/g, " - ");
  s = s.replace(/\s*--\s*/g, " - ");
  // Strip markdown bold/italic markers
  s = s.replace(/\*\*/g, "").replace(/\*/g, "");
  // Strip any remaining banned words (case-insensitive)
  for (const word of BANNED_WORDS) {
    const regex = new RegExp(word, "gi");
    s = s.replace(regex, "");
  }
  // Clean up double spaces and trailing commas from removals
  s = s.replace(/  +/g, " ").replace(/\s+,/g, ",").replace(/,\s*,/g, ",").trim();
  return s;
}

// ===== Ensure connection note is 285-300 chars =====
const CN_PREFIX = "I'm Yash, a recent M.S. CS grad and Ex-Zipline engineer.";
const CN_SUFFIX = "Would you be open to a quick chat?";

function ensureConnectionNoteLength(note, job, domain) {
  // If already in range and has correct start/end, return as-is
  if (note.length >= 285 && note.length <= 300 &&
      note.startsWith(CN_PREFIX) && note.endsWith(CN_SUFFIX)) {
    return note;
  }

  // Build programmatically to guarantee the range
  const role = job.title || "this role";
  const company = job.company || "your company";
  const loc = job.location && job.location.toLowerCase() !== "remote" ? job.location : null;
  const skills = domain.skills || ["Kubernetes", "Go/Python", "Terraform"];

  // Try multiple middle phrases of varying length
  const midOptions = [
    `I noticed the ${role} role at ${company} and it really caught my attention. My background is in ${skills[0]}, ${skills[1]}, and ${skills[2]} across production systems.`,
    `I came across the ${role} role at ${company} and it caught my eye. I've spent the last few years working with ${skills[0]}, ${skills[1]}, and ${skills[2]}.`,
    `I saw the ${role} role at ${company} and it really resonated with me. I've been working with ${skills[0]}, ${skills[1]}, and ${skills[2]} in production environments.`,
    loc ? `I noticed the ${role} opening at ${company} in ${loc}. My background spans ${skills[0]}, ${skills[1]}, and ${skills[2]} across several production systems.` : null,
    `I came across the ${role} position at ${company}. I've been building with ${skills[0]}, ${skills[1]}, and ${skills[2]} across multiple teams and production systems.`,
    `I saw the ${role} role at ${company} and wanted to reach out. I've worked extensively with ${skills[0]}, ${skills[1]}, and ${skills[2]} in production.`,
    loc ? `I noticed the ${role} role at ${company} in ${loc} and it caught my eye. I've been working with ${skills[0]} and ${skills[1]} across production systems.` : null,
    `I came across the ${role} role at ${company} and it really resonated. I have hands-on experience with ${skills[0]}, ${skills[1]}, and ${skills[2]} in production settings.`,
  ].filter(Boolean);

  for (const mid of midOptions) {
    const candidate = `${CN_PREFIX} ${mid} ${CN_SUFFIX}`;
    if (candidate.length >= 285 && candidate.length <= 300) {
      return candidate;
    }
  }

  // If nothing fits exactly, pick the closest one under 300
  let best = "";
  let bestDiff = Infinity;
  for (const mid of midOptions) {
    const candidate = `${CN_PREFIX} ${mid} ${CN_SUFFIX}`;
    if (candidate.length <= 300) {
      const diff = Math.abs(candidate.length - 292);
      if (diff < bestDiff) {
        best = candidate;
        bestDiff = diff;
      }
    }
  }

  return best || `${CN_PREFIX} ${midOptions[0]} ${CN_SUFFIX}`.substring(0, 300);
}

export async function POST(req) {
  try {
    const { candidate, job } = await req.json();

    const firstName = candidate.name !== "Unknown Name" ? candidate.name.split(" ")[0] : "there";
    const domain = DOMAIN_PROOF_POINTS[job.department] || DOMAIN_PROOF_POINTS.engineering;

    const systemPrompt = `You are a career coach who writes like a real human, not an AI. Output ONLY the final messages. No thinking, no explanations, no reasoning, no commentary. No markdown formatting. Plain text only. No em-dashes. No bold. No italic.`;

    const userPrompt = `Generate personalized outreach messages for this situation:

TARGET: ${candidate.name} (${candidate.headline}) at ${job.company}
ROLE: ${job.title} - ${job.department}
LOCATION: ${job.location || "Not specified"}
SENDER: Yash Shah (Recent M.S. CS grad from Cal State LA, Ex-Zipline engineer)

FULL CANDIDATE PROFILE:
${CANDIDATE_PROFILE}

TEMPLATES TO FOLLOW (fill in the brackets with real content from the profile above):

=== CONNECTION NOTE RULES ===
HARD LIMIT: The note MUST be between 285 and 300 characters. Under 280 = FAILURE. Over 300 = FAILURE.
MUST start with exactly: "I'm Yash, a recent M.S. CS grad and Ex-Zipline engineer."
MUST end with exactly: "Would you be open to a quick chat?"
Between those two fixed parts, write 2-3 conversational sentences that:
- Mention the specific role and company name
- Include location when it fits naturally
- Name 2-3 relevant skills or technologies matching the role
No em-dashes. No forced metrics. No JD wording. Complete sentences only.

EXAMPLE 1 (290 chars):
I'm Yash, a recent M.S. CS grad and Ex-Zipline engineer. I came across the Platform Engineer role at Datadog and it caught my eye. I've spent the last few years working with Kubernetes, Terraform, and Go across production systems. Would you be open to a quick chat?

EXAMPLE 2 (295 chars):
I'm Yash, a recent M.S. CS grad and Ex-Zipline engineer. I noticed the Data Engineer role at Snowflake and it really caught my attention. My background is in building ETL pipelines, AWS Step Functions, and Spark across multiple production environments. Would you be open to a quick chat?

=== COLD EMAIL TEMPLATE ===
Hi [Name],

I'm Yash, a recent M.S. CS grad and Ex-Zipline engineer. The [Role] role at [Company] caught my eye because of [one specific thing about the role or company that genuinely interests you].

At Zipline I [most relevant Zipline proof point], at DataHub I [second proof point], and at Squadron I [third proof point], so I've seen [relevant domain] from multiple sides.

I'd bring that same [key strength] to this role, along with a real interest in [one genuine thing about the team or mission].

Would love to connect and hear more about the role. Happy to chat whenever works for you.

Best,
Yash Shah
yashshah3698@gmail.com | +1 213-301-8249
LinkedIn: https://www.linkedin.com/in/yash-shah-b7129b1bb/
GitHub: https://github.com/yash161
Portfolio: https://portfolio-two-liard-51.vercel.app/
Research: https://www.proquest.com/docview/3351316152
Resume: Attached

=== FOLLOW-UP TEMPLATE ===
Hi [Name], just floating this to the top of your inbox. Still really interested in the [Role] role at [Company]. Happy to chat for 10 minutes whenever works. Best, Yash

ABSOLUTE RULES (VIOLATIONS = FAILURE):
- Fill the templates above with REAL proof points from the candidate profile
- LinkedIn note MUST be 285-300 characters. Count carefully. Under 285 = too short. Over 300 = FAIL.
- For ${job.department} roles: pick the 3 most relevant skills from: ${domain.skills.join(", ")}
- Pick proof points that are MOST relevant to the ${job.department} domain and ${job.title} role
- The "what you built" in the email subject should be a specific project relevant to this role
- The "why this company" sentence should reference something specific about ${job.company}
- NO em-dashes (the long dash character). Use regular hyphens (-) or commas instead.
- NO markdown formatting. No **bold**, no *italic*, no ### headers.
- BANNED WORDS (never use any of these): codified, engineered, architected, orchestrated, spearheaded, leveraged, utilized, harnessed, facilitated, streamlined, cutting-edge, state-of-the-art, world-class, robust, scalable, pivotal, synergy, furthermore, moreover, consequently, notwithstanding, delve, in conclusion, modern DevOps practices, cross-functional collaboration, stakeholder, seamless, seamlessly, holistic, game-changing, transformative, innovative solution, passionate about, excited to
- Write like a real person texting a friend about their job. Use contractions. Short sentences. No corporate speak.
- DO NOT add any extra text, explanations, or commentary

OUTPUT FORMAT (exactly):
LINKEDIN CONNECTION NOTE:
[filled template]

COLD EMAIL:
[filled template]

FOLLOW-UP:
[filled template]`;

    const raw = await callLLM(systemPrompt, userPrompt);

    if (!raw) {
      // If both LLMs fail, generate from template directly
      const connectionNote = ensureConnectionNoteLength("", job, domain);

      const email = `Subject: ${job.title} at ${job.company} - ${domain.zipline.split(",")[0]} | ${domain.skills[0]}

Hi ${firstName},

I'm Yash, a recent M.S. CS grad and Ex-Zipline engineer. The ${job.title} role at ${job.company} caught my eye because of the technical depth the team seems to value.

At Zipline I ${domain.zipline}, at DataHub I ${domain.datahub}, and at Squadron I ${domain.squadron}, so I've seen ${job.department} from multiple sides.

I'd bring that same hands-on approach to this role, along with a real interest in what ${job.company} is building.

Would love to connect and hear more about the role. Happy to chat whenever works for you.

Best,
Yash Shah
yashshah3698@gmail.com | +1 213-301-8249
LinkedIn: https://www.linkedin.com/in/yash-shah-b7129b1bb/
GitHub: https://github.com/yash161
Portfolio: https://portfolio-two-liard-51.vercel.app/
Research: https://www.proquest.com/docview/3351316152
Resume: Attached`;

      const followup = `Hi ${firstName}, just floating this to the top of your inbox. Still really interested in the ${job.title} role at ${job.company}. Happy to chat for 10 minutes whenever works. Best, Yash`;

      return NextResponse.json({
        connection_note: connectionNote.length > 300 ? connectionNote.substring(0, 297) + "..." : connectionNote,
        email,
        followup,
      });
    }

    // Parse LLM response
    const cleaned = cleanLLMOutput(raw);

    let connectionNote = "", email = "", followup = "";
    const sections = cleaned.split(/(?:LINKEDIN CONNECTION NOTE|COLD EMAIL|FOLLOW-UP)\s*:?\s*\n/i);
    if (sections.length >= 3) {
      connectionNote = cleanSection(sections[1] || "");
      email = cleanSection(sections[2] || "");
    }
    if (sections.length >= 4) {
      followup = cleanSection(sections[3] || "");
    }

    // Fallback if parsing failed
    if (!connectionNote && !email) {
      const parts = cleaned.split("\n\n").filter(p => p.trim().length > 10);
      connectionNote = parts[0] || "";
      email = parts[1] || "";
      followup = parts[2] || "";
    }

    // Enforce 285-300 char connection note programmatically (LLMs can't count chars)
    connectionNote = ensureConnectionNoteLength(connectionNote, job, domain);

    return NextResponse.json({
      connection_note: connectionNote,
      email: email,
      followup: followup,
    });
  } catch (err) {
    console.error("[Outreach Error]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
