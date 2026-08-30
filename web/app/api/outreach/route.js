import { NextResponse } from "next/server";

const GROQ_API_KEY = process.env.GROQ_API_KEY || "";

const HUMAN_VOICE = `Write like a real person in a casual conversation over coffee. Vary sentence lengths—mix short punchy ones with longer flowing ones. Use contractions (don't, I've, it's). Avoid: 'furthermore', 'moreover', 'consequently', 'it is worth noting', 'delve', 'pivotal', 'in conclusion', 'notwithstanding'. No excessive em dashes. Clear, direct, slightly opinionated voice.`;

const CANDIDATE_PROFILE = `
CANDIDATE: Yash Shah — Software/Data Engineer with 3+ years experience.

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

// Domain-specific experience extraction
const DOMAIN_EXPERIENCE = {
  "data & ai": `ETL pipelines (PostgreSQL → Snowflake via Step Functions), dual-mode Lambda/Glue Spark replication, 34-file Terraform IaC, Scrapy web crawling platform for 8+ clients, dbt containerization on ECS, AI Kubernetes troubleshooting for Redshift data platform, metadata-driven pipeline orchestration`,
  engineering: `Kubernetes platform tooling, FastAPI backend services, Go-based Terraform drift detection, CI/CD automation (GitHub Actions, Bazel), Python automation across 330+ distributed nodes, Docker/Helm deployments, Azure cost investigation platform (React/TypeScript)`,
  security: `DevSecOps PR security review system, IAM/KMS encryption, Kubernetes upgrade readiness assessment, infrastructure drift detection`,
};

export async function POST(req) {
  try {
    const { candidate, job } = await req.json();

    const firstName = candidate.name !== "Unknown Name" ? candidate.name.split(" ")[0] : "there";
    const isRecruiter = candidate.category.includes("Recruiter");
    const isTeamMember = candidate.category.includes("Engineer") || candidate.category.includes("Team Member");
    const templateType = isRecruiter ? "recruiter" : isTeamMember ? "team_member" : "hiring_manager";

    const domainExp = DOMAIN_EXPERIENCE[job.department] || DOMAIN_EXPERIENCE.engineering;

    const prompt = `/no_think

Generate THREE outreach messages for this situation:

TARGET: ${candidate.name} (${candidate.headline}) at ${job.company}
ROLE: ${job.title} — ${job.department}
LOCATION: ${job.location || "Not specified"}
SENDER: Yash Shah

RELEVANT EXPERIENCE FOR THIS ${job.department.toUpperCase()} ROLE:
${domainExp}

FULL PROFILE:
${CANDIDATE_PROFILE}

RULES:
- LinkedIn note MUST be under 300 characters
- Email: 4-6 sentences, punchy
- ONLY reference experience matching ${job.department} domain
- For data roles: mention ETL, pipelines, Snowflake, Spark — NOT CI/CD label sync
- For engineering roles: mention Kubernetes, Terraform, CI/CD — NOT ETL
- Sign as "Yash"
- ${HUMAN_VOICE}

OUTPUT FORMAT (exactly):
LINKEDIN CONNECTION NOTE:
[under 300 chars]

COLD EMAIL:
[4-6 sentence email with subject line]

FOLLOW-UP:
[short follow-up for 5-7 days later]`;

    const completion = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "qwen/qwen3.6-27b",
        messages: [
          {
            role: "system",
            content: `/no_think\n\nYou are an elite career coach and executive copywriter. Output ONLY the final messages. No thinking, no explanations, no reasoning, no commentary.`,
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.5,
        max_completion_tokens: 2048,
        stream: false,
      }),
    });

    if (!completion.ok) {
      const err = await completion.text();
      return NextResponse.json({ error: `Groq API error: ${err}` }, { status: 500 });
    }

    const data = await completion.json();
    let raw = data.choices?.[0]?.message?.content || "";

    // Strip <think> tags (multiple formats)
    raw = raw.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/<\/?think>/g, "").trim();

    // Strip reasoning blocks: "Thinking Process:", numbered analysis lists, bold markdown reasoning
    raw = raw.replace(/^[\s\S]*?(?=LINKEDIN CONNECTION NOTE)/i, ""); // Everything before first section header
    raw = raw.replace(/Thinking Process:[\s\S]*?(?=LINKEDIN CONNECTION NOTE|COLD EMAIL|$)/gi, "");
    raw = raw.replace(/\*\*(?:Deconstruct|Target|Role|Location|Sender|Relevant|Candidate|Rules|Output)[\s\S]*?(?=LINKEDIN CONNECTION NOTE|COLD EMAIL|FOLLOW-UP|$)/gi, "");
    raw = raw.replace(/^\d+\.\s+\*\*[\s\S]*?(?=LINKEDIN CONNECTION NOTE|COLD EMAIL|FOLLOW-UP|$)/gim, "");
    raw = raw.trim();

    // Parse sections
    let connectionNote = "", email = "", followup = "";
    const sections = raw.split(/(?:LINKEDIN CONNECTION NOTE|COLD EMAIL|FOLLOW-UP)\s*:?\s*\n/i);
    if (sections.length >= 3) {
      connectionNote = sections[1]?.trim() || "";
      email = sections[2]?.trim() || "";
    }
    if (sections.length >= 4) {
      followup = sections[3]?.trim() || "";
    }

    // Clean each section — strip residual markdown reasoning
    const cleanSection = (s) => {
      return s
        .replace(/^\s*\*\*(?:Deconstruct|Target|Role|Location|Sender|Relevant|Candidate|Rules|Output).*$/gim, "")
        .replace(/^\s*\*\s+\*\*.*$/gim, "")  // bullet reasoning like "* **Target:** ..."
        .replace(/^\s*\d+\.\s+\*\*.*$/gim, "")  // numbered reasoning like "1. **Deconstruct..."
        .replace(/^Thinking Process:.*$/gim, "")
        .trim();
    };
    connectionNote = cleanSection(connectionNote);
    email = cleanSection(email);
    followup = cleanSection(followup);

    // Fallback: if parsing failed, try splitting on double newlines
    if (!connectionNote && !email) {
      const cleaned = raw.replace(/^\s*\*\*.*$/gim, "").replace(/^\s*\*\s+\*\*.*$/gim, "").trim();
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
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
