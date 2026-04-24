# Team Context — PrivacyTool

> Read this first before touching any code. This is the full picture of what we're building and who owns what.

---

## What We're Building

A browser extension that reads any website's privacy policy, uses a fine-tuned LLM to extract exactly what data is being collected, what it's used for, and what the risk is — then automates opt-outs where possible and reminds users when manual action is needed.

**The core loop:**
1. User visits any website
2. Extension detects and fetches the privacy policy
3. Fine-tuned LLM analyzes it → structured output (data types, purposes, third-party sharing, risk level + traceable reasoning)
4. Extension popup shows plain-language breakdown + historical breach context for that data type
5. User opts out — extension automates it (email/form) or creates a reminder if manual action needed
6. Dashboard aggregates all visited sites, risk levels, pending actions

---

## 4 Core Features

1. **Privacy Policy Scanner** — fine-tuned LLM reads any site's policy, extracts structured risk data with traceable reasoning (every flag links to the exact policy clause)
2. **Automated Opt-out** — email/form opt-outs handled automatically; manual actions become reminders
3. **Dashboard** — per-site risk breakdown, historical breach context, opt-out status, aggregate view on demand
4. **Email Reminders** — triggered by pending manual opt-outs or detected policy changes

---

## Team Split

| Person | Role | Owns |
|---|---|---|
| **Suhas** | Product + Spec | Overall concept, spec, coordination, Kiro workflow |
| **Teammate 2** | Frontend + Integration | Browser extension, policy detection, automated opt-out pipeline |
| **Teammate 3** | Backend + AI/MCP | Fine-tuned model, structured extraction, backend API, reminder scheduler |

---

## Full Concept

See `CONCEPT.md` in this folder for the complete concept document.

---

## Hackathon Judging

30 points + 4 x $1,500 prizes. We're targeting all of them.

- **Potential Value (10pts)** — works on every website, real problem, accessible to anyone
- **Implementation (10pts)** — fine-tuned model + traceable reasoning + automated opt-out pipeline
- **Quality & Design (10pts)** — clean extension popup, readable dashboard, no alert fatigue
- **Build prize** — LLM pipeline + Kiro spec → architecture → working code
- **Collaboration prize** — clear 3-way role split, each person owns a distinct layer
- **Impact prize** — real customer journey, privacy as a right not a setting
- **Story prize** — live demo: visit site → scan policy → see risk → watch opt-out fire

---

*Last updated: Draft v0.4*
