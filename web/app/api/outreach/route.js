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
    zipline: "engineered automated label-sync pipeline in Python, eliminating drift across 330+ distributed HIL nodes",
    datahub: "built AI-powered Kubernetes troubleshooting agent for Redshift data platform using FastAPI + LLM",
    squadron: "designed metadata-driven ETL pipeline replicating PostgreSQL, GA, S3 → Snowflake via AWS Step Functions + Lambda/Glue Spark",
  },
  engineering: {
    skills: ["Kubernetes", "Go/Python", "Terraform IaC"],
    zipline: "engineered automated label-sync pipeline in Python, eliminating drift across 330+ distributed HIL nodes",
    datahub: "built infrastructure drift detection platform in Go comparing Terraform state vs live cloud APIs",
    squadron: "codified pipeline infrastructure across 34 Terraform files (Lambda, Glue, Step Functions, EventBridge, VPC, IAM)",
  },
  security: {
    skills: ["DevSecOps", "IAM/KMS", "Kubernetes security"],
    zipline: "diagnosed GitHub API token exhaustion, shipped async fallback keeping label updates running",
    datahub: "built infrastructure drift detection platform in Go (Terraform state vs live cloud API)",
    squadron: "codified secure pipeline infrastructure across 34 Terraform files with IAM and VPC controls",
  },
  product: {
    skills: ["Full-stack dev", "React/TypeScript", "FastAPI"],
    zipline: "engineered automated label-sync pipeline in Python, eliminating drift across 330+ distributed HIL nodes",
    datahub: "built agentic Azure cost investigation platform (React, TypeScript, FastAPI, Azure CLI, OpenAI)",
    squadron: "engineered production-grade Scrapy crawling platform serving 8+ client organizations",
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
  return s
    .replace(/^\s*\*\*(?:Deconstruct|Target|Role|Location|Sender|Relevant|Candidate|Rules|Output).*$/gim, "")
    .replace(/^\s*\*\s+\*\*.*$/gim, "")
    .replace(/^\s*\d+\.\s+\*\*.*$/gim, "")
    .replace(/^Thinking Process:.*$/gim, "")
    .trim();
}

export async function POST(req) {
  try {
    const { candidate, job } = await req.json();

    const firstName = candidate.name !== "Unknown Name" ? candidate.name.split(" ")[0] : "there";
    const domain = DOMAIN_PROOF_POINTS[job.department] || DOMAIN_PROOF_POINTS.engineering;

    const systemPrompt = `You are an elite career coach and executive copywriter. Output ONLY the final messages. No thinking, no explanations, no reasoning, no commentary. No markdown formatting. Plain text only.`;

    const userPrompt = `Generate personalized outreach messages for this situation:

TARGET: ${candidate.name} (${candidate.headline}) at ${job.company}
ROLE: ${job.title} — ${job.department}
LOCATION: ${job.location || "Not specified"}
SENDER: Yash Shah (Recent M.S. CS grad from Cal State LA, Ex-Zipline engineer)

FULL CANDIDATE PROFILE:
${CANDIDATE_PROFILE}

TEMPLATES TO FOLLOW (fill in the brackets with real content from the profile above):

=== CONNECTION NOTE TEMPLATE ===
I'm Yash, a recent M.S. CS grad and Ex-Zipline engineer. I saw your post about the [Role] role at [Company]. My background is in [Skill 1], [Skill 2], and [Skill 3]. Would love to connect.

=== COLD EMAIL TEMPLATE ===
Subject: [Role] at [Company] — [what you built] | [outcome or tech stack]

Hi [Name],

Saw your post about the [Role] role at [Company] and wanted to reach out directly.

I'm a recent M.S. CS grad and Ex-Zipline engineer. At Zipline I [most relevant Zipline proof point]. At DataHub I [second proof point with metric]. At Squadron I [third proof point with metric].

[One sentence on why this company/role specifically.]

Resume: Attached
LinkedIn: https://www.linkedin.com/in/yash-shah-b7129b1bb/
GitHub: https://github.com/yash161
Portfolio: https://portfolio-two-liard-51.vercel.app/
Research: https://www.proquest.com/docview/3351316152

Best,
Yash Shah
yashshah3698@gmail.com | +1 213-301-8249

=== FOLLOW-UP TEMPLATE ===
Hi [Name], just floating this to the top of your inbox. Still really interested in the [Role] role at [Company]. Happy to chat for 10 minutes whenever works. Best, Yash

CRITICAL RULES:
- Fill the templates above with REAL proof points from the candidate profile
- LinkedIn note MUST be under 300 characters total
- For ${job.department} roles: pick the 3 most relevant skills from: ${domain.skills.join(", ")}
- Pick proof points that are MOST relevant to the ${job.department} domain and ${job.title} role
- The "what you built" in the email subject should be a specific project relevant to this role
- The "why this company" sentence should reference something specific about ${job.company}
- Keep the tone casual and direct — no corporate buzzwords
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
      const connectionNote = `I'm Yash, a recent M.S. CS grad and Ex-Zipline engineer. I saw your post about the ${job.title} role at ${job.company}. My background is in ${domain.skills.join(", ")}. Would love to connect.`;

      const email = `Subject: ${job.title} at ${job.company} — ${domain.zipline.split(",")[0]} | ${domain.skills[0]}

Hi ${firstName},

Saw your post about the ${job.title} role at ${job.company} and wanted to reach out directly.

I'm a recent M.S. CS grad and Ex-Zipline engineer. At Zipline I ${domain.zipline}. At DataHub I ${domain.datahub}. At Squadron I ${domain.squadron}.

I'm drawn to ${job.company} because of the technical depth the team seems to value.

Resume: Attached
LinkedIn: https://www.linkedin.com/in/yash-shah-b7129b1bb/
GitHub: https://github.com/yash161
Portfolio: https://portfolio-two-liard-51.vercel.app/
Research: https://www.proquest.com/docview/3351316152

Best,
Yash Shah
yashshah3698@gmail.com | +1 213-301-8249`;

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

    if (connectionNote.length > 300) connectionNote = connectionNote.substring(0, 297) + "...";

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
