# PrivacyTool — Hackathon Concept Document

> **Hackathon Theme:** Ethics & Privacy
> **Status:** Draft v0.3 — Hackathon-optimized
> **Goal:** Top project + all 4 prize signals ($1,500 each)

---

## 1. One-Line Pitch

A browser extension + dashboard that puts users in full control of their privacy across major platforms — enforced by an **Ethics Logic Gate** that blocks any action violating the user's own privacy rules, in real time.

---

## 2. The Core Idea (Judge-Facing)

Most privacy tools tell you what to do. PrivacyTool enforces what you decided.

Users define their own privacy rules in plain language. Every action the tool takes — and every setting on every connected platform — is checked against those rules before anything happens. If a violation is detected, the gate fires, the action is blocked, and the user is told exactly why.

This isn't just a settings manager. It's a **user-controlled enforcement layer** over the platforms that profit from ignoring your preferences.

---

## 3. Problem Statement

- Privacy settings are buried, renamed, and silently reset after service updates
- Jargon makes it unclear what a toggle actually does
- Doing it once isn't enough — services add trackers and update terms without notice
- When one opt-out fails, users don't know the alternatives
- Nobody schedules privacy maintenance — it just doesn't happen

**The deeper problem:** Users have preferences but no power. Platforms have power but no accountability to user preferences. PrivacyTool closes that gap.

---

## 4. The Ethics Logic Gate (Core Differentiator)

This is the feature that wins the hackathon. It must be real, running code — not a concept.

### What it is
A validation layer that runs before every action PrivacyTool takes. It checks the proposed action against the user's Privacy Rule Set. If the action would violate a rule, it is **blocked** — not warned about, not flagged for later — **blocked**.

### How it works

```
User Action / Automated Task
        ↓
[ Ethics Logic Gate ]
        ↓
Load user's Privacy Rule Set
        ↓
Evaluate: does this action violate any rule?
        ↓
   YES → Block action
          Show violation reason
          Suggest compliant alternative
        ↓
   NO  → Proceed
          Log action to audit trail
```

### Example scenarios

| Situation | Gate behavior |
|---|---|
| Tool tries to enable a setting that shares location data | Rule: "Never share location" → **BLOCKED** |
| Service update adds cross-site tracking by default | Rule: "No cross-site tracking" → **BLOCKED**, user notified |
| User manually tries to opt into targeted ads | Rule: "No targeted advertising" → **BLOCKED with explanation** |
| Action is compliant with all rules | Proceeds, logged to audit trail |

### Why this wins
- Directly satisfies the hackathon's "Ethics Logic Gate" requirement
- It's demonstrable in a live demo — judges can see it fire
- It's the emotional hook: the gate catching a violation is a *moment*
- It reframes the product from "settings manager" to "privacy enforcer"

---

## 5. Privacy Rule Builder (Key Feature)

Users define their own rules in plain language. No technical knowledge required.

### How it works
- User picks from a set of plain-language rule templates:
  - "Never share my location with any service"
  - "Never allow cross-site tracking"
  - "Never allow targeted advertising based on my behavior"
  - "Never allow my data to be sold to third parties"
  - "Always require explicit consent before new data collection"
- Users can customize or write their own rules
- Rules are stored in the user's Privacy Rule Set
- The Ethics Logic Gate enforces them across every connected service

### Why this matters for judging
- Directly answers the prompt: *"putting the power back in the human's hands"*
- Users can literally see and edit the spec their privacy runs on
- Scores on originality, user autonomy, and responsible design

---

## 6. Full Feature Set

### 6.1 OAuth-Connected Account Actions
- Connect Google, Meta, Apple via OAuth
- Tool reads current privacy settings and applies user-selected or recommended configurations automatically
- Every action passes through the Ethics Logic Gate before execution

### 6.2 Privacy Dashboard
Clean, readable, no alert fatigue. Shows:
- **Privacy score** — single grade that updates as settings are configured
- **Service status** — per-platform summary (Google ✓, Meta ⚠ 2 issues, Apple ✓)
- **Pending actions** — top 3 most impactful things not yet done
- **Active rules** — user's current Privacy Rule Set, editable inline
- **Gate activity** — recent violations caught and blocked

Design principle: one screen tells the whole story. Drill in for detail.

### 6.3 Plain-Language Explanations
Every setting has a three-part explanation:
- **What it does** — one sentence
- **Why it matters** — what data is collected or shared if left on
- **What you lose** — any functionality that changes if you opt out

Tone: clear, neutral, non-alarmist.

### 6.4 Alternative Opt-out Paths
When automation isn't possible:
- Step-by-step in-tool walkthrough
- Direct links to the relevant settings page
- Alternative tools (browser extensions, DNS blockers, etc.)
- Notes on known failure modes per platform

### 6.5 Automated Email Reminders
- Default schedule tied to each service's policy update cadence
- User can customize per service
- Triggered by: fixed cadence OR detected policy/ToS change
- Email includes: what was last configured, what may have changed, direct link back to dashboard

### 6.6 Revisit Summary
When user returns after a gap:
- "You last reviewed Google settings 4 months ago — here's what changed"
- Highlights new settings that didn't exist at last review
- Shows drift: settings that were configured but may have been silently reset

### 6.7 Audit Trail
Full log of every action taken by the tool:
- What changed, when, on which service
- Which rule was enforced (or which gate fired)
- Exportable for transparency

---

## 7. Target Users

### Casual Users
- Feel uncomfortable with tracking but don't know where to start
- Want the tool to do the work — minimal input required
- UX: low cognitive load, clear progress, readable dashboard

### Power Users
- Want a single control plane instead of 20 tabs
- Want to write custom rules, see full audit history, export config
- UX: full control, transparency, every setting visible

---

## 8. Platform

**Browser Extension** (Chrome v1, Firefox v2)
- Interacts directly with settings pages
- Detects when user visits a supported service, surfaces contextual actions
- Ethics Logic Gate runs client-side for speed and trust

**Web Dashboard**
- Central hub: score, service status, rule builder, audit trail, reminder settings
- Accessible on any device without the extension

---

## 9. Technical Architecture

### Ethics Logic Gate (Core)
```
RuleEngine.evaluate(action, userRuleSet) → { allowed: boolean, violation?: Rule, suggestion?: string }
```
- Runs before every automated action and every manual change
- Rule Set stored locally (extension) + synced to backend
- Violations logged to audit trail with timestamp and context

### Browser Extension
- Detects supported service pages, surfaces contextual actions
- DOM automation for settings pages where API isn't available
- Communicates with backend for sync

### Web Dashboard (Frontend)
- React SPA
- Privacy score, service status, rule builder, audit trail, reminder config

### Backend
- OAuth 2.0 flows per connected service
- User preferences + rule set store
- Reminder scheduler (time-based + event-triggered)
- Service adapters: one per platform (Google, Meta, Apple)

### Notification Layer
- Email (v1): SendGrid / Postmark
- Triggered by scheduler or policy change detection

---

## 10. Judging Rubric Alignment

| Criteria | How PrivacyTool scores |
|---|---|
| **Potential Value (10pts)** | Real problem affecting every internet user. Works on Google, Meta, Apple — services with billions of users. Clear market need, accessible to non-technical users. |
| **Implementation (10pts)** | Ethics Logic Gate is real running code. Kiro spec drives the entire build. OAuth integrations, rule engine, scheduler — all demonstrable. |
| **Quality & Design (10pts)** | Clean dashboard with no alert fatigue. Delight moment: the gate visually catching a violation. Plain-language throughout. Responsible design baked in. |

### Prize Signal Strategy

| Prize | Strategy |
|---|---|
| **Build ($1,500)** | Show Kiro spec → architecture → working code pipeline. Ethics Logic Gate as the centerpiece of the technical demo. |
| **Collaboration ($1,500)** | Design lead owns dashboard UX + rule builder UI. Dev lead owns gate engine + OAuth adapters. Clear role split documented in spec. |
| **Impact ($1,500)** | Frame around user autonomy. Real customer journey: connect account → set rules → watch gate enforce them. Privacy as a right, not a setting. |
| **Story ($1,500)** | Live demo: show the gate firing. "This is what it looks like when your privacy rules actually have teeth." Post build process publicly. |

---

## 11. Demo Script (Hackathon Presentation)

1. **Hook (30s):** "Every time you use Google or Meta, they collect data based on settings you probably never reviewed. PrivacyTool changes that."
2. **Rule Builder (1min):** User sets 3 rules: no location sharing, no cross-site tracking, no targeted ads.
3. **Connect + Scan (1min):** Connect Google via OAuth. Tool scans settings, finds 4 violations of the user's rules.
4. **Gate fires (30s):** Tool attempts to fix a setting — gate catches one that would conflict with another rule. Blocks it. Explains why. Suggests alternative.
5. **Dashboard (30s):** Show score go up. Show audit trail. Show pending reminder.
6. **Close (30s):** "The gate isn't just a feature. It's the point. Your rules, enforced — not suggested."

---

## 12. Build Roadmap

### Hackathon MVP (what to demo)
- [ ] Ethics Logic Gate — rule engine with 5 default rules, fully enforced
- [ ] Privacy Rule Builder — UI to view, edit, and add rules
- [ ] Google OAuth connection + settings scan
- [ ] Dashboard — score, service status, gate activity feed
- [ ] 1 live demo of gate blocking a violation

### Post-Hackathon v1
- Meta and Apple OAuth
- Event-based email reminders (policy change triggers)
- Alternative opt-out paths
- Revisit summary
- User-customizable reminder schedule

### v2
- Additional platforms (TikTok, Microsoft)
- Power user mode (full audit export, custom rule syntax)
- Firefox extension

---

## 13. Out of Scope (Hackathon)

- Data broker removal tracking
- Mobile app
- SMS/push notifications
- Import/export privacy profile
- Breach monitoring

---

*Last updated: Draft v0.3 — Hackathon build*
