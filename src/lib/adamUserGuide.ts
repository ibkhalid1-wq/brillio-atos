export interface GuideArticle {
  id: string;
  title: string;
  category: string;
  phase?: string;
  keywords: string[];
  summary: string;
  body: string;
  relatedArticleIds: string[];
}

export const ADAM_USER_GUIDE: GuideArticle[] = [
  {
    id: "gs-001",
    title: "What AURA helps you do",
    category: "Getting Started",
    keywords: ["what is atos", "about atos", "overview", "methodology", "what does atos do", "introduction"],
    summary: "AURA helps teams move from a business problem to a production-ready Human + Agent capability with clear phase gates, stronger evidence, and visible accountability.",
    body: `
# What is AURA?

AURA stands for **Agentic Transformation Operating System**. It is a structured framework that guides your organization through every stage of an AI transformation program - from defining the business problem to measuring delivered value.

## The 9 Phases

| Phase | Purpose |
|---|---|
| **Strategy** | Define the business problem, desired outcome, and value hypothesis |
| **Mobilise** | Assemble the team, define roles, and establish governance |
| **Discover** | Map capabilities, stakeholders, KPIs, and the opportunity landscape |
| **Design** | Architect the solution, define the agent blueprint, and make key decisions |
| **Build** | Develop, test, and validate the capability |
| **Operate** | Deploy, monitor, and graduate the agent through trust levels |
| **Govern** | Establish ongoing oversight, risk management, and compliance |
| **Optimize** | Continuously improve based on operational data |
| **Value Realize** | Measure delivered outcomes against baseline and capture learning |

## How AURA protects you

- **Phase gates** prevent you from moving forward before critical work is done
- **The Copilot** guides you at every step, flags gaps, and generates content
- **The Transformation Twin** visualizes how all parts of your program connect
- **Readiness scores** give you an honest view of where you stand at all times
    `,
    relatedArticleIds: ["gs-002", "gs-003", "ph-001"],
  },
  {
    id: "gs-002",
    title: "Start your first program",
    category: "Getting Started",
    keywords: ["create program", "new program", "start", "first program", "how to begin", "get started"],
    summary: "Create a new program, define the business problem and outcome, then let Copilot guide the first high-value inputs in each phase.",
    body: `
# Creating Your First Program

## Step 1: Open the dashboard
Navigate to the home screen. You will see your program list (or an empty state if this is your first time).

## Step 2: Click New Program
Select the **New Program** button. You will be prompted to enter:
- **Program Name** - a short descriptive title (for example "Agentic Meeting Summary Assistant")
- **Business Problem** - what problem are you solving? Be specific.
- **Desired Outcome** - what does success look like?

## Step 3: Let the Copilot guide you
Once your program is created, the Copilot will:
- Suggest what to fill in first
- Explain why each field matters
- Flag anything missing before you try to advance

## Step 4: Work through each phase in order
AURA enforces phase sequencing. You must complete Strategy before Mobilise, and so on. The Copilot will tell you exactly what is needed at each gate.

## Tips
- You do not need to complete a phase in one sitting - save as you go
- Upload documents at any phase to let AURA extract relevant inputs automatically
- Use the Readiness Score at the top of your program to track overall health
    `,
    relatedArticleIds: ["gs-001", "gs-004", "cp-001"],
  },
  {
    id: "gs-003",
    title: "How readiness is scored",
    category: "Getting Started",
    keywords: ["readiness score", "atos readiness index", "score", "percentage", "health", "progress", "how is score calculated"],
    summary: "The AURA Readiness Index combines evidence quality, decisions, approvals, stakeholder coverage, and freshness into one score that shows how ready the program is to progress.",
    body: `
# Understanding the Readiness Score

The **AURA Readiness Index** is a live health indicator for your program. It tells you - at a glance - how ready your program is to advance.

## How it is calculated

\`\`\`
Score = Artifacts(35%) + Decisions(25%) + Approvals(20%) + Stakeholders(12%) + Freshness(8%) - Blocker Penalty
\`\`\`

The overall program score is the weighted average across all active phases.

## What each component means

| Component | Weight | What it measures |
|---|---|---|
| **Artifacts** | 35% | Are the required deliverables present and complete? |
| **Decisions** | 25% | Have key architecture and design decisions been recorded? |
| **Approvals** | 20% | Have artifacts been reviewed and approved by the right people? |
| **Stakeholders** | 12% | Are stakeholders identified and engaged? |
| **Freshness** | 8% | Has the phase been updated recently? |
| **Blocker Penalty** | -uncapped | Any critical blocker reduces the score until resolved |

## What the score means

| Score | Meaning |
|---|---|
| 80-100 | On track - ready to advance |
| 60-79 | Progressing - some gaps to address |
| Below 60 | At risk - blockers or missing critical inputs |

## How to improve your score
- Complete required artifacts for the current phase
- Get approvals on submitted artifacts
- Record architecture decisions with full ADR detail
- Resolve any blockers shown in the phase gate panel
    `,
    relatedArticleIds: ["gs-001", "ph-006", "ar-003"],
  },
  {
    id: "gs-004",
    title: "Bring in existing documents",
    category: "Getting Started",
    keywords: ["upload document", "attach file", "document intelligence", "import", "pdf", "word", "deck", "extract", "parse"],
    summary: "Upload decks, Word files, or PDFs and AURA will extract likely inputs, stage proposals, and preserve your manual edits for review.",
    body: `
# Uploading Documents

AURA can read your existing documents - strategy decks, business cases, architecture specs, project plans - and automatically extract relevant inputs to populate your program.

## How to upload

1. Navigate to the phase where the document is most relevant
2. Click the **paperclip / Attach Document** icon in the Copilot panel or phase workspace
3. Select your file (PDF, Word, or PowerPoint, up to 8MB)
4. AURA will parse the document and show you what it found

## What AURA extracts by phase

| Phase | What is extracted |
|---|---|
| **Strategy** | Objectives, constraints, value drivers, sponsor |
| **Discover** | Stakeholders, KPIs, capability descriptions, opportunity data |
| **Design** | Architecture decisions, system integrations, technical constraints |
| **Operate** | Runbook items, operational procedures, SLAs |
| **Value Realize** | KPI results, benefit metrics, outcome data |

## What happens after extraction

- AURA shows you a **review panel** with each extracted item and a confidence score
- You can **Accept**, **Dismiss**, or **Edit** each item before it is added to your program
- Accepted items are added to the relevant phase fields and improve your Readiness Score

## Important notes

- AURA never overwrites content you have manually edited - it creates **proposals** instead
- If you upload a newer version of the same document, AURA detects the update and flags any decisions that may be affected
- If extraction finds nothing relevant, it will tell you why and suggest what to try instead
    `,
    relatedArticleIds: ["gs-002", "cp-003", "ar-002"],
  },
  {
    id: "ph-001",
    title: "Strategy: define the case for change",
    category: "Phases",
    phase: "strategy",
    keywords: ["strategy", "strategy phase", "business problem", "objective", "value hypothesis", "baseline metrics", "sponsor", "constraints"],
    summary: "Use Strategy to define the business problem, target outcome, value case, and baseline measures that every later phase depends on.",
    body: `
# Strategy Phase

## Purpose
Establish the foundation of your transformation program. Without a clear strategy, every downstream decision lacks context.

## What you need to complete

### Required inputs
- **Business Problem** - describe the specific pain point in concrete terms. Avoid vague language like "improve efficiency."
- **Desired Outcome** - what measurable change will this program deliver?
- **Sponsor** - who is accountable at the executive level?
- **Value Hypothesis** - why do you believe AI will solve this problem? Quantify the expected benefit.
- **Constraints** - what boundaries must the solution respect? (regulatory, technical, budget, timeline)

### Baseline Metrics (critical)
You must capture at least one baseline metric before exiting Strategy. Without a baseline, you cannot prove value at the end of the program.

Example: *"Meeting follow-up time: 10 hours per team per week (measured Q1 2026)"*

Add baselines in **Strategy -> Baseline Metrics** with: metric name, current value, unit, data source, and measurement date.

## Exit criteria
Before advancing to Mobilise, AURA requires:
- [ ] Business problem defined
- [ ] Desired outcome defined
- [ ] At least one baseline metric captured
- [ ] Sponsor identified
- [ ] Value hypothesis documented

## Common mistakes
- Setting vague objectives ("use AI to improve operations") - be specific
- Skipping baseline metrics - this is the most common reason programs cannot claim value later
- Setting unrealistic value targets - the Copilot will flag significant KPI mismatches
    `,
    relatedArticleIds: ["ph-002", "gs-003", "cp-002"],
  },
  {
    id: "ph-002",
    title: "Mobilise: set the team and operating rhythm",
    category: "Phases",
    phase: "mobilise",
    keywords: ["mobilise", "team", "roster", "roles", "raci", "governance", "delivery roles", "import team", "sponsor", "program manager"],
    summary: "Use Mobilise to name the accountable team, establish the RACI, and set the governance rhythm that keeps delivery moving.",
    body: `
# Mobilise Phase

## Purpose
Assemble the right people, assign clear responsibilities, and establish how decisions will be made and escalated.

## Building your team roster

### Adding team members
1. Go to **Mobilise -> Team Roster**
2. Click **Add Team Member** or **Import from File**
3. For each person, set: Name, Role, and Allocation %

### Importing from a spreadsheet
Upload a CSV or Excel file with columns: Role, Name, Allocation. AURA will match each row to a delivery role and rebuild the roster cleanly.

### Required roles for AI programs
If your program includes L3 or L4 autonomous capabilities, AURA requires:
- **AI/ML Engineer** - mandatory for L3/L4 agent development
- **Program Sponsor** - executive accountable for the program
- **Program Manager** - day-to-day delivery accountability

## RACI matrix

For each approved capability, you must define:
- **Responsible** - who does the work
- **Accountable** - one person ultimately answerable (required for exit)
- **Consulted** - subject matter experts
- **Informed** - stakeholders kept updated

## Governance model
Define your:
- Steering committee members
- Review cadence (weekly / bi-weekly / monthly)
- Escalation path (Program Manager -> Sponsor -> Executive Committee)

## Exit criteria
- [ ] At least 3 delivery roles defined
- [ ] Accountable role assigned in RACI for each capability
- [ ] AI/ML Engineer present for any L3/L4 capabilities
- [ ] Governance model documented
    `,
    relatedArticleIds: ["ph-001", "ph-003", "cp-002"],
  },
  {
    id: "ph-003",
    title: "Discover: define capabilities, KPIs, and stakeholders",
    category: "Phases",
    phase: "discover",
    keywords: ["discover", "capability dna", "capability", "kpi", "stakeholders", "opportunity assessment", "autonomy level", "l1 l2 l3 l4", "hitl"],
    summary: "Use Discover to define the capabilities, KPIs, and stakeholders that justify design work and keep the value case measurable.",
    body: `
# Discover Phase

## Purpose
Identify what you are building, who it affects, and how you will measure success.

## Capability DNA

Capability DNA is AURA's framework for defining AI capabilities with precision. Each capability card captures:

| Field | Purpose |
|---|---|
| **Name** | Short descriptive title |
| **Description** | What does this capability do? |
| **Autonomy Level** | L1 (assisted) to L4 (fully autonomous) |
| **HITL Policy** | Required for L3/L4 - how does a human review outputs? |
| **Data Classification** | Confidential / Internal / Public |
| **Data Residency** | Where must data be processed and stored? |
| **Integrations** | Which systems does this capability connect to? |

### Autonomy levels explained
- **L1 - Assisted**: AI suggests, human always decides
- **L2 - Supervised**: AI acts, human reviews all outputs before they take effect
- **L3 - Collaborative**: AI acts autonomously with selective human review
- **L4 - Autonomous**: AI acts independently with exception-based human oversight

> Warning: L3 and L4 capabilities require a HITL policy, an AI/ML Engineer in the team, and trust graduation evidence before Operate exit.

## KPIs
Define measurable KPIs that connect to your Strategy outcomes. For each KPI set:
- Name and description
- Target value and unit
- How it will be measured

The measured value will be captured in Value Realize.

## Stakeholders
Map all stakeholders with their interest (high/medium/low) and influence (high/medium/low). This drives the 12% stakeholder component of your Readiness Score.

## Exit criteria
- [ ] At least 1 capability approved
- [ ] HITL policy defined for all L3/L4 capabilities
- [ ] At least 1 KPI defined
- [ ] Opportunity assessment completed
    `,
    relatedArticleIds: ["ph-002", "ph-004", "cp-002"],
  },
  {
    id: "ph-004",
    title: "Design: make the key decisions explicit",
    category: "Phases",
    phase: "design",
    keywords: ["design", "architecture", "adr", "decision", "agent blueprint", "skill catalog", "architecture decision", "design phase"],
    summary: "Use Design to record architecture decisions, shape the agent blueprint, and define the skills and controls needed before build begins.",
    body: `
# Design Phase

## Purpose
Make architectural decisions with clear rationale, design the agent in detail, and define the skills it needs.

## Architecture Decision Records (ADRs)

Every significant decision should be recorded as an ADR with:
- **Decision** - what was decided
- **Decision Maker** - who made it (name and role)
- **Alternatives Considered** - what other options were evaluated
- **Constraints** - what drove this decision
- **Reversibility** - reversible / partially-reversible / irreversible

> Warning: Irreversible decisions (for example vendor selection or data architecture) require a second approver and are highlighted in red.

## Agent Blueprint

The blueprint defines your agent precisely:
- **Inputs** - what data does the agent consume?
- **Outputs** - what does the agent produce?
- **Tools** - which APIs, models, and systems does it use?
- **Guardrails** - what limits prevent unintended behavior?

## Skill Catalog

List the individual skills your agent needs. Each skill has:
- Name and description
- Type (data-processing / nlp / integration / reasoning)

At least 1 skill is required to exit Design.

## Exit criteria
- [ ] At least 1 architecture decision recorded in ADR format
- [ ] Agent Blueprint completed
- [ ] Skill Catalog has at least 1 skill
- [ ] All approved capabilities have Design artifacts
    `,
    relatedArticleIds: ["ph-003", "ph-005", "ar-001"],
  },
  {
    id: "ph-005",
    title: "Build: prove the solution is ready",
    category: "Phases",
    phase: "build",
    keywords: ["build", "test", "acceptance criteria", "deployment checklist", "test plan", "build phase", "testing", "quality"],
    summary: "Use Build to validate the solution against acceptance criteria, complete release checks, and clear the final blockers before go-live.",
    body: `
# Build Phase

## Purpose
Develop the capability, run tests, and validate that it meets the agreed acceptance criteria.

## Acceptance Criteria

Define criteria before development begins. Each criterion must be:
- Specific and testable
- Assigned a pass/fail status after testing
- Traceable to a capability requirement

**All acceptance criteria must pass before Operate phase entry.** A single critical failing criterion blocks advancement.

## Deployment Checklist

Track deployment prerequisites:
- Infrastructure provisioned
- Model/API configured
- Integrations tested (each integration separately)
- Security review completed <- required
- Performance test passed
- HITL workflow tested (if L3/L4)

## Test Plan

Record test execution results:
- Total test cases
- Passed / Failed / Blocked counts

## Exit criteria
- [ ] All acceptance criteria passing
- [ ] Deployment checklist complete
- [ ] Security review passed
- [ ] Test plan recorded

> Warning: A failed security review is a critical blocker. Do not attempt to bypass it. Fix the security issues and re-run the review.
    `,
    relatedArticleIds: ["ph-004", "ph-006", "ar-002"],
  },
  {
    id: "ph-006",
    title: "Govern: set the control model",
    category: "Phases",
    phase: "govern",
    keywords: ["govern", "governance", "compliance", "risk register", "gdpr", "eu ai act", "audit", "separation of duties", "model versioning"],
    summary: "Use Govern to put the oversight, compliance, model versioning, and risk controls in place that make the capability sustainable.",
    body: `
# Govern Phase

## Purpose
Establish the structures that will keep your AI capability safe, compliant, and accountable over time.

## Governance Framework

You must define all 5 fields:

| Field | What to enter |
|---|---|
| **Escalation Path** | Who reviews issues at each level? (for example PM -> Sponsor -> Executive Committee) |
| **Audit Review Frequency** | How often is the audit log reviewed? (monthly recommended) |
| **Board Reporting Cadence** | How often does the board receive an update? (quarterly recommended) |
| **Separation of Duties** | Confirm that artifact creators are not the same as approvers |
| **AI Model Versioning Policy** | How are model updates tracked, tested, and deployed? |

> Warning: The AI Model Versioning Policy is commonly skipped. Without it, you cannot track which model version produced which output - a critical gap for regulated industries.

## Risk Register

For each risk define:
- Risk description
- Likelihood (low / medium / high)
- Impact (low / medium / high / critical)
- Mitigation action

## Compliance Checklist

Mark each item complete:
- GDPR impact assessed
- EU AI Act risk category determined (Limited Risk for most business tools)
- Security review completed
- Data Privacy Impact Assessment (DPIA) completed

## Separation of duties reminder
AURA enforces that the person who creates an artifact cannot be the same person who approves it. If you are working alone, assign a reviewer from the steering committee.

## Exit criteria
- [ ] All 5 governance framework fields complete
- [ ] At least 1 risk in the risk register
- [ ] Compliance checklist complete
- [ ] Governance model documented in Mobilise referenced here
    `,
    relatedArticleIds: ["ph-005", "ph-007", "gs-003"],
  },
  {
    id: "ph-007",
    title: "Operate: launch with evidence and control",
    category: "Phases",
    phase: "operate",
    keywords: ["operate", "trust graduation", "deploy", "monitor", "runbook", "hitl compliance", "trust", "graduate", "production"],
    summary: "Use Operate to launch the capability, monitor it in production, and show the trust evidence needed to run it responsibly.",
    body: `
# Operate Phase

## Purpose
Deploy your capability into production, monitor it, and formally graduate it through the trust framework.

## Trust Graduation Evidence

For L3/L4 capabilities, you must provide structured evidence before exiting Operate:

| Evidence | Minimum threshold |
|---|---|
| Test cases passed | >= 10 |
| User validations | >= 3 |
| Monitored hours without incident | >= 24 |
| HITL compliance rate | >= 95% |

This is not a checkbox - provide real measured values.

## Operational Runbook

Document how to respond to known failure scenarios:
- Scenario description
- Step-by-step procedure
- Owner (who is responsible for this scenario)

At minimum, document:
1. What happens if the AI model API is unavailable
2. What happens if an integration fails
3. What happens if the HITL review queue backs up

## Monitoring Setup

Before Operate exit, confirm:
- Alerting configured for threshold breaches
- Dashboard created for operational visibility
- SLAs defined and communicated to stakeholders

## Exit criteria
- [ ] Trust graduation evidence meets all 4 thresholds (for L3/L4)
- [ ] At least 2 runbook scenarios documented
- [ ] Monitoring setup confirmed
    `,
    relatedArticleIds: ["ph-006", "ph-008", "ar-003"],
  },
  {
    id: "ph-008",
    title: "Value Realize: prove the outcome",
    category: "Phases",
    phase: "valuerealize",
    keywords: ["value realize", "value realization", "kpi measurement", "outcomes", "benefits", "baseline comparison", "roi", "lessons learned", "attestation"],
    summary: "Use Value Realize to show what changed, what value was delivered, and what the organization should learn before the next cycle.",
    body: `
# Value Realize Phase

## Purpose
Prove that the program delivered the value it promised. This is the most important phase for organizational credibility.

## KPI Measurement

For each KPI defined in Discover, record the actual measured value. AURA will automatically calculate:
- Achievement vs target (%)
- Delta from baseline (if baseline was captured in Strategy)
- Trend direction

> Warning: If you did not capture baseline metrics in Strategy, you cannot prove a delta. This is the most common reason value claims fail scrutiny.

## Stakeholder Attestation

Create a **Stakeholder Outcome Attestation** artifact and gain approval from the program sponsor. This is the formal sign-off that the program delivered its stated value.

The attestation should confirm:
- Which outcomes were achieved
- Which KPI targets were met
- Any outcomes that were not delivered and why

## Lessons Learned

Document at least 3 lessons for the next program cycle:
- What worked well?
- What would you do differently?
- What surprised you?

These feed AURA's global learning loop and will surface as insights for future programs in the same industry.

## Exit criteria
- [ ] At least 1 KPI with a measured (actual) value
- [ ] Baseline comparison completed (requires Strategy baseline metrics)
- [ ] Stakeholder attestation artifact approved
- [ ] Lessons learned documented (minimum 50 characters)
    `,
    relatedArticleIds: ["ph-007", "gs-003", "cp-003"],
  },
  {
    id: "cp-001",
    title: "Get the best from Copilot",
    category: "Copilot",
    keywords: ["copilot", "ai assistant", "how to use copilot", "ask copilot", "copilot help", "chat"],
    summary: "Copilot works best when you use it as an in-context guide for next steps, missing inputs, and draft content grounded in your live program state.",
    body: `
# Using the Copilot

The AURA Copilot is not a generic chatbot. It knows your program, your current phase, and exactly where your gaps are.

## What to ask the Copilot

**Guidance questions:**
- "What should I do next?"
- "What is missing in this phase?"
- "Why do I need to capture baseline metrics?"
- "What happens if I skip the HITL policy?"

**Generation requests:**
- "Generate a value hypothesis based on my business problem"
- "Draft the agent blueprint for my Meeting Intelligence Capability"
- "Suggest 3 KPIs for this program"
- "Write a RACI for the capabilities I have defined"

**Explanation requests:**
- "Explain what autonomy level L3 means"
- "Why is the separation of duties requirement important?"
- "What is an Architecture Decision Record?"

**Help requests:**
- "How do I upload a document?"
- "How is the readiness score calculated?"
- "What is trust graduation evidence?"

## What the Copilot will NOT do

- Override a phase gate that is legitimately blocking you - fix the underlying gap instead
- Generate content that contradicts your existing approved decisions (it will flag the contradiction)
- Skip governance requirements for convenience

## Validation warnings

If you see an amber warning banner on a Copilot response, it means the suggestion contains uncertain or unverified information. Review it carefully before accepting.

## Proposals vs direct updates

When the Copilot suggests an update to an artifact you have manually edited, it creates a **proposal** rather than overwriting your work. You will see a notification to review the proposal.
    `,
    relatedArticleIds: ["cp-002", "cp-003", "gs-002"],
  },
  {
    id: "cp-002",
    title: "What Copilot checks automatically",
    category: "Copilot",
    keywords: ["contradiction", "conflict", "copilot checks", "automatic checks", "flags", "warnings", "validation", "eu residency", "l3 l4 ml engineer"],
    summary: "Copilot continuously checks for contradictions, unrealistic plans, and policy gaps so issues surface before they turn into gate failures.",
    body: `
# Automatic Contradiction Detection

The Copilot continuously monitors your program for logical contradictions and flags them proactively. You do not need to ask.

## Built-in contradiction rules

| Rule | What it checks |
|---|---|
| **L3/L4 without ML Engineer** | Any L3 or L4 capability requires an AI/ML Engineer in the delivery team |
| **Compliance without Security Review** | Programs with compliance requirements must have a security review in the checklist |
| **Unregistered Agent Types** | Agent types must be registered in the Org Agent Catalog |
| **KPI Mismatch** | Claimed value outcomes must be proportionate to the scale of the program |
| **EU Data Residency + Public Cloud** | EU residency policy must select an EU cloud region - not a global or US region |
| **Agent Count vs Budget** | Too many agents for the available budget signals an infeasible plan |
| **HITL Policy for L3/L4** | L3/L4 capabilities without a HITL policy are blocked |
| **RACI Gaps** | Approved capabilities without an Accountable role trigger a warning |
| **Capacity vs Capability Ratio** | More than 3 approved capabilities per delivery team member is flagged as unrealistic |

## What happens when a contradiction is detected

1. The Copilot shows a contradiction alert in the chat panel
2. The relevant field is highlighted in the phase workspace
3. The Readiness Score reflects the blocker until it is resolved
4. You cannot advance the phase until critical contradictions are cleared

## Adding custom rules

Administrators can define custom contradiction rules in **Govern -> Custom Rules** without requiring code changes. This allows your organization to enforce company-specific policies automatically.
    `,
    relatedArticleIds: ["cp-001", "cp-003", "ph-006"],
  },
  {
    id: "cp-003",
    title: "How Copilot proposes updates safely",
    category: "Copilot",
    keywords: ["proposal", "update proposal", "artifact update", "overwrite", "manual edit", "protect edits", "accept reject", "merge"],
    summary: "When Copilot finds a better version of an artifact, it stages a proposal for review instead of overwriting your manual work.",
    body: `
# Artifact Update Proposals

AURA never silently overwrites content you have written. When the Copilot generates an update to a manually-edited artifact, it creates a **proposal** for you to review.

## How proposals work

1. You manually edit an artifact (for example the Outcome Charter)
2. You upload a new document or change a phase input
3. AURA detects that the artifact could be improved based on the new information
4. Instead of overwriting, AURA creates a proposal showing:
   - **Current content** - what you wrote
   - **Proposed content** - what AURA suggests
   - **Reason** - why AURA is suggesting the change
   - **Source** - what triggered the proposal (document upload, input change, and so on)

## Reviewing proposals

You will see a notification badge when proposals are waiting. Open the proposal panel to:

- **Accept** - replace your content with the proposed content
- **Reject** - dismiss the proposal (your original content is kept)
- **Merge** - open a side-by-side editor to combine both versions

## Why proposals matter

Without this protection, regenerating content would silently destroy your manual work. The proposal system means:
- Your expertise is always preserved
- AI suggestions are always visible and reviewable
- You stay in control of your program's narrative
    `,
    relatedArticleIds: ["cp-001", "ar-001", "ar-002"],
  },
  {
    id: "ar-001",
    title: "Artifacts: the evidence behind each phase",
    category: "Artifacts",
    keywords: ["artifact", "deliverable", "document", "generate artifact", "approve artifact", "artifact status", "submit for approval"],
    summary: "Artifacts are the formal outputs that prove a phase is ready to progress. They can be drafted with Copilot, edited manually, approved, and versioned.",
    body: `
# Artifacts

Artifacts are the formal outputs of each AURA phase. They are the evidence that a phase has been completed to the required standard.

## Artifact lifecycle

\`\`\`
Draft -> Submitted for Approval -> Approved (or Rejected -> Revised -> Resubmitted)
\`\`\`

## Artifact states

| State | Meaning |
|---|---|
| **Draft** | Work in progress - not yet reviewed |
| **Submitted** | Sent for approval - awaiting reviewer action |
| **Approved** | Formally signed off - counts toward Readiness Score |
| **Rejected** | Reviewer returned it with feedback - revise and resubmit |

## Creating an artifact

1. Navigate to the relevant phase workspace
2. Click **New Artifact** or select an artifact type from the template list
3. Either write content manually or click **Generate with Copilot**
4. Review and edit the generated content
5. Click **Submit for Approval** when ready

## Approving an artifact

Only someone other than the artifact creator can approve it (separation of duties).

1. The reviewer opens the artifact from the **Pending Approvals** list
2. Reviews the content
3. Clicks **Approve** or **Reject with feedback**

## Signature artifacts

Some artifacts (for example the Capability DNA sign-off) are **signature artifacts** - they require a formal named approval before they unlock downstream phases.
    `,
    relatedArticleIds: ["ar-002", "ar-003", "cp-003"],
  },
  {
    id: "ar-002",
    title: "Undo changes and restore earlier versions",
    category: "Artifacts",
    keywords: ["undo", "redo", "version history", "rollback", "restore", "previous version", "revert", "history"],
    summary: "AURA keeps both program-level and artifact-level history so you can recover from mistakes without losing the wider program state.",
    body: `
# Undo and Version History

AURA protects your work with two levels of undo:

## Program-level undo (20 snapshots)
Every time you make a significant change to your program, AURA saves a snapshot. You can step back through the last 20 states.

**How to use:**
- Click the **Undo** button in the top toolbar, or
- Press **Ctrl+Z** (Windows) / **Cmd+Z** (Mac)

## Artifact-level undo
Each artifact maintains its own undo history. When editing an artifact, you can undo individual edits within that artifact without affecting the rest of your program.

**How to use:**
- Click the **Undo** button within the artifact editor

## Viewing version history

1. Open an artifact
2. Click the **History** icon (clock icon in the artifact toolbar)
3. You will see a list of versions with timestamps and change descriptions
4. Click any version to preview it
5. Click **Restore this version** to roll back

## What undo does NOT cover

- Changes that have been formally approved (to protect audit integrity)
- Phase advancement - these are intentional state transitions
- Deletions that have been confirmed twice (AURA asks for double confirmation on destructive actions)

## Best practice
If you are about to make significant changes to a complex artifact, use **Export Program** first to create a portable backup.
    `,
    relatedArticleIds: ["ar-001", "ar-003", "gs-004"],
  },
  {
    id: "ar-003",
    title: "Why a phase gate is blocked",
    category: "Artifacts",
    keywords: ["blocked", "cannot advance", "phase gate", "exit criteria", "blocker", "what is missing", "why cant i advance", "gate failed"],
    summary: "When a gate is blocked, AURA tells you which criteria are still failing and where to fix them so the next phase starts on stronger footing.",
    body: `
# Phase Gate Blockers

If you cannot advance to the next phase, a phase gate is blocking you. This is intentional - AURA protects downstream work from being built on an incomplete foundation.

## How to see what is blocking you

1. Click the **Advance Phase** button
2. If the gate is blocked, AURA shows a list of failing exit criteria
3. Each failure has a description and a link to the relevant workspace section

## Common blockers and how to fix them

| Blocker | Fix |
|---|---|
| "Baseline metrics not captured" | Go to Strategy -> Baseline Metrics and add at least one metric |
| "No approved capability" | Go to Discover -> Capability DNA and approve at least one capability |
| "HITL policy missing for L3+ capability" | Open the capability card and define the HITL policy |
| "Acceptance criteria failing" | Go to Build -> Acceptance Criteria and mark failing items as resolved after fixing |
| "Security review not completed" | Complete the security review and mark it in the Deployment Checklist |
| "Governance framework incomplete" | Go to Govern and fill in all 5 governance framework fields |
| "Measured KPI values missing" | Go to Value Realize -> KPIs and enter actual measured values |
| "Stakeholder attestation not approved" | Create and gain approval for the Stakeholder Outcome Attestation artifact |

## What you should NOT do

- Do not try to bypass a gate - it exists to protect you
- Do not delete items to make the count thresholds pass
- Do not mark items as complete if they are not - this undermines the program's integrity

## Getting Copilot help on a blocker

Ask the Copilot: *"Why is my [phase name] gate blocked and what should I do?"*

The Copilot will explain each failing criterion in plain language and suggest the specific action to resolve it.
    `,
    relatedArticleIds: ["ar-001", "gs-003", "cp-002"],
  },
  {
    id: "tw-001",
    title: "What the Transformation Twin shows",
    category: "Transformation Twin",
    keywords: ["transformation twin", "twin", "graph", "visualization", "nodes", "edges", "dependency map", "architecture map"],
    summary: "The Transformation Twin shows how capabilities, outcomes, decisions, risks, and value connect so teams can trace impact and dependency clearly.",
    body: `
# Transformation Twin

The Transformation Twin is a live, auto-generated graph of your entire program. It shows the relationships between capabilities, decisions, roles, outcomes, risks, and value metrics.

## What it shows

The Twin uses 13 node types and 11 edge types to represent your program:

**Node types include:** Capability, Outcome, Decision, Role, Stakeholder, Risk, KPI, Skill, Integration, Governance, Agent, Value, Milestone

**Edge types include:** depends-on, achieves, measures, assigned-to, governed-by, implements, risks, escalates-to, and more.

## How it updates

The Twin updates automatically whenever you:
- Approve a capability
- Record an architecture decision
- Add a stakeholder
- Define a KPI
- Complete a phase

You do not need to manually maintain the Twin - AURA builds it from your program data.

## How to use it

**Navigate:** Pan and zoom to explore the full graph. Use the MiniMap in the corner to orient yourself in large programs.

**Inspect a node:** Click any node to see its detail panel - type, current status, linked artifacts, and connected nodes.

**Impact analysis:** Click a node and select **Simulate Removal** to see which other nodes would be affected if this element were removed from the program. This helps you understand dependencies before making changes.

**Spot orphans:** Any node with no connections is flagged - this usually means something has been added but not linked to the rest of the program.

## What to look for

- **Isolated capability nodes** - a capability not connected to any outcome means it has no clear business justification
- **Outcomes with no KPI** - how will you measure success for this outcome?
- **Risks with no mitigation** - unmitigated risks appear in red
    `,
    relatedArticleIds: ["tw-002", "gs-001", "ph-003"],
  },
  {
    id: "tw-002",
    title: "How to read the Transformation Twin",
    category: "Transformation Twin",
    keywords: ["twin graph", "read twin", "node colors", "edge colors", "twin legend", "what do colors mean"],
    summary: "Use the Twin legend, node colours, and edge styles to quickly understand what is connected, what is healthy, and where the weak spots are.",
    body: `
# Reading the Transformation Twin

## Node colors

| Color | Node type |
|---|---|
| Blue | Capability |
| Green | Outcome / Value |
| Red | Risk |
| Purple | Decision |
| Yellow | KPI / Metric |
| Orange | Stakeholder |
| Grey | Role / Team member |
| Teal | Governance |
| Pink | Agent |

## Edge types

- **Solid line** - a declared dependency (A depends on B)
- **Animated line** - an active "achieves" or "measures" relationship
- **Dashed line** - an inferred or weak relationship

## Node status indicators

Each node has a small status badge:
- Green ring - active and healthy
- Amber ring - has gaps or warnings
- Red ring - has critical issues
- Grey ring - not yet started

## Interaction tips

- **Double-click** a node to expand its detail panel
- **Right-click** a node for context actions (simulate removal, view artifacts, navigate to workspace)
- **Ctrl+scroll** to zoom; drag background to pan
- Use the **Controls** panel (bottom-left) to fit the graph to screen or lock layout
    `,
    relatedArticleIds: ["tw-001", "gs-001"],
  },
  {
    id: "tr-001",
    title: "When changes are not saving",
    category: "Troubleshooting",
    keywords: ["not saving", "lost data", "save failed", "storage full", "sync error", "data loss", "not syncing"],
    summary: "Check the sync signal first. AURA distinguishes between safely saved local work and a true server-side save problem.",
    body: `
# My Changes Are Not Saving

## Check the sync status indicator

Look for the sync status in the top header area:
- Saved - your changes are saved to the server
- Saving... - a save is in progress
- Changes saved locally only - server save failed; your data is safe locally but not backed up

## If you see "Changes saved locally only"

1. Check your internet connection
2. Try refreshing the page - AURA will attempt to sync on reload
3. If the error persists, use **Export Program** to download a backup JSON file
4. Contact your administrator if the error continues

## Storage quota warning

If you see a storage warning banner, your browser's local storage is nearly full. To free space:
1. Go to **Settings -> Storage**
2. Delete old program versions you no longer need
3. Or use **Export Program** for older programs and delete them from the platform

## If you lost data

1. Check **Undo History** - you may be able to restore a recent state
2. Check **Version History** on specific artifacts
3. If you exported a backup, use **Import Program** to restore it
    `,
    relatedArticleIds: ["tr-002", "ar-002", "gs-002"],
  },
  {
    id: "tr-002",
    title: "When Copilot feels slow or generic",
    category: "Troubleshooting",
    keywords: ["copilot not working", "copilot stuck", "copilot wrong", "ai not responding", "copilot error", "unexpected response"],
    summary: "If Copilot feels slow, generic, or uncertain, there is usually a queue, a context gap, or a validation warning you can resolve quickly.",
    body: `
# Copilot Issues

## Copilot is slow or not responding

AURA queues AI requests to prevent overload. If you have triggered multiple AI operations at once, they process in sequence. Wait a moment and the response will appear.

If the Copilot has not responded after 30 seconds:
1. Scroll up in the chat - the response may have appeared above
2. Refresh the page - in-flight requests will be retried automatically
3. Check the browser console for error messages

## Copilot response has an amber warning banner

The warning banner means: *"This suggestion may need verification."*

This appears when the Copilot's response contains information that could not be fully verified against your program data. Review the response carefully before acting on it.

## Copilot is giving generic answers instead of program-specific ones

The Copilot needs your program context to give specific answers. Make sure:
1. You have an active program open (not just the dashboard)
2. You are in a phase workspace - the Copilot uses your current phase as context
3. You have filled in enough data in the current phase for the Copilot to work with

## Copilot suggested something that conflicts with my program

The Copilot runs contradiction detection automatically. If it suggests something that conflicts with an existing approved decision, it will flag the contradiction. You should:
1. Review the conflict
2. Either update the conflicting decision, or
3. Ask the Copilot to explain the trade-off between the two approaches
    `,
    relatedArticleIds: ["cp-001", "tr-001", "cp-002"],
  },
];

export function searchUserGuide(query: string, limit = 3): GuideArticle[] {
  if (!query || query.trim().length < 2) return [];
  const q = query.toLowerCase().trim();

  const scored = ADAM_USER_GUIDE.map((article) => {
    let score = 0;
    if (article.title.toLowerCase().includes(q)) score += 10;
    const keywordMatches = article.keywords.filter((keyword) => keyword.includes(q) || q.includes(keyword.split(" ")[0]));
    score += keywordMatches.length * 5;
    if (article.category.toLowerCase().includes(q)) score += 3;
    if (article.phase && q.includes(article.phase)) score += 8;
    if (article.body.toLowerCase().includes(q)) score += 2;
    if (article.summary.toLowerCase().includes(q)) score += 4;
    return { article, score };
  });

  return scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.article);
}

export function getArticleById(id: string): GuideArticle | undefined {
  return ADAM_USER_GUIDE.find((article) => article.id === id);
}

export function getArticlesByPhase(phase: string): GuideArticle[] {
  return ADAM_USER_GUIDE.filter((article) => article.phase === phase);
}

export function getArticlesByCategory(category: string): GuideArticle[] {
  return ADAM_USER_GUIDE.filter((article) => article.category === category);
}
