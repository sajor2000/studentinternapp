import {
  Bot,
  Braces,
  ChartColumn,
  CheckCircle2,
  ClipboardCheck,
  Code2,
  Database,
  FileText,
  GitBranch,
  Globe2,
  LockKeyhole,
  MapPinned,
  MessageSquareText,
  Presentation,
  ScanSearch,
  ShieldCheck,
  Table2,
  TerminalSquare,
} from "lucide-react";

export const neonDocsUrl = "https://neon.com/docs/ai/connect-mcp-clients-to-neon";
export const compoundPluginUrl = "https://github.com/everyinc/compound-engineering-plugin";
export const context7DocsUrl = "https://context7.com/docs/clients/codex";

export const setupCards = [
  {
    title: "Neon MCP",
    icon: Database,
    tone: "green",
    text: "Only Neon-enabled interns should connect local tools, and only with the admin-provided read-only database role.",
    source: neonDocsUrl,
  },
  {
    title: "Compound Engineering",
    icon: GitBranch,
    tone: "blue",
    text: "Use the same plugin workflow for every internship coding task: brainstorm, plan, work, review, and preserve reusable project learnings.",
    source: compoundPluginUrl,
  },
  {
    title: "Context7 MCP",
    icon: ScanSearch,
    tone: "blue",
    text: "Use current public library docs without sending PHI, PII, credentials, private code, or controlled data values.",
    source: context7DocsUrl,
  },
  {
    title: "Portal data path",
    icon: ShieldCheck,
    tone: "amber",
    text: "Run intern previews through the portal read-only role. Do not paste credentials, owner URLs, or row-level extracts into external tools.",
    source: "/docs/security/security-model.md",
  },
  {
    title: "Portal-managed routing",
    icon: Bot,
    tone: "blue",
    text: "The portal keeps Foundry keys, model choices, and cost controls server-side. Interns should use the workflow buttons and CE prompts instead of configuring models.",
    source: "/docs/planning/token-cost-control.md",
  },
  {
    title: "Local notebooks",
    icon: Braces,
    tone: "blue",
    text: "Use guided Python, R, and marimo starters locally. Review and understand the code before publishing outputs.",
    source: "/docs/brainstorms/summer-intern-portal-requirements.md",
  },
] as const;

export const commandBlocks = [
  {
    label: "Neon quick setup",
    command: "npx neonctl@latest init",
    note: "Use this only when your account is Neon-enabled and an admin approves local setup. Never use owner, admin, loader, write, or service-role URLs.",
  },
  {
    label: "Neon MCP only",
    command: "npx add-mcp https://mcp.neon.tech/mcp -a codex",
    note: "Use this only for approved read-only exploration. Review MCP database actions before accepting them.",
  },
  {
    label: "Codex CLI plugin install",
    command:
      "codex plugin marketplace add EveryInc/compound-engineering-plugin\ncodex plugin add compound-engineering@compound-engineering-plugin",
    note: "Restart Codex after installation. The portal already embeds CE launchers and does not require interns to configure Foundry keys, model names, or route tiers.",
  },
  {
    label: "Context7 MCP docs",
    command: "npx ctx7 setup --codex",
    note: "Use only for generic public library documentation. Keep any Context7 API key local and never include PHI, PII, private code, secrets, or controlled data in lookup queries.",
  },
] as const;

export const workflowSteps = [
  {
    title: "Ask the portal for a dataset recipe",
    body: "Start with the portal schema browser and dataset builder so the query runs through the read-only preview path.",
  },
  {
    title: "Use Compound Engineering for project work",
    body: "Learn the guided project loop: /ce-brainstorm to frame the project, /ce-plan to decide the work, /ce-work to execute, /ce-code-review to catch issues, and /ce-compound to save what you learned in your private workspace. The portal chooses the model route automatically.",
  },
  {
    title: "Use Neon MCP only for approved database exploration",
    body: "Neon MCP can manage database resources, so review tool actions before execution and keep it to approved read-only development or testing workflows.",
  },
  {
    title: "Publish only reviewed outputs",
    body: "Export final marimo HTML locally, upload it as a draft, then publish only after checking privacy and methods notes.",
  },
] as const;

export const safetyChecks = [
  {
    icon: LockKeyhole,
    text: "Never paste Neon owner URLs, API keys, passwords, or Foundry/Azure keys into chat or notebooks.",
  },
  {
    icon: Database,
    text: "Use the portal for preview queries; intern-facing database access is expected to be read-only.",
  },
  {
    icon: MessageSquareText,
    text: "Keep prompts at schema, code, and methods level unless an admin approves row-level examples.",
  },
  {
    icon: ScanSearch,
    text: "Use Context7 only for generic public library docs; no PHI, PII, credentials, private code, file names, or controlled data values.",
  },
  {
    icon: CheckCircle2,
    text: "Review any MCP-requested database action before accepting it.",
  },
] as const;

export const protectedDatasetModes = [
  {
    title: "Chicago Health Map",
    icon: Database,
    text: "Use the built-in Neon schema for de-identified ward, condition, 311, crime, and civic-leader snapshot work.",
  },
  {
    title: "Approved PHI file",
    icon: ShieldCheck,
    text: "Keep CSV, XLSX, Parquet, notebook/code, and artifact files local or in the approved private Azure Blob workflow. Use the minimum PHI needed for code; the API masks unnecessary direct identifiers.",
  },
  {
    title: "Local analysis code",
    icon: Braces,
    text: "Generate marimo, Jupyter/Python, or R templates that read local paths after approved private file records are downloaded and output aggregate tables or reviewed HTML.",
  },
] as const;

export const modelRoutingRows = [
  {
    label: "Cheap",
    model: "Low-cost route",
    icon: Bot,
    text: "Use only for lightweight summaries, outlines, quick explanations, and cached schema utility work.",
  },
  {
    label: "Default",
    model: "Default coding route",
    icon: Code2,
    text: "Use for routine intern chat, ward snapshots, Word/PPT/HTML drafts, dataset recipes, and most CE skills.",
  },
  {
    label: "Code",
    model: "Code route",
    icon: Code2,
    text: "Use for Python/R/Jupyter/marimo generation, SQL debugging, code review, optimization, and CE execution.",
  },
  {
    label: "Strong",
    model: "Reasoning route",
    icon: Code2,
    text: "Use for complex joins, statistical reasoning, analysis plans, and synthesis.",
  },
  {
    label: "Premium",
    model: "Final-review route",
    icon: ShieldCheck,
    text: "Use only for explicit final QA, second-pass review, red-team review, or admin review.",
  },
] as const;

export const ceSkillRows = [
  ["/ce-brainstorm", "Turn a rough project idea into requirements."],
  ["/ce-plan", "Create the implementation plan before coding or analysis."],
  ["/ce-work", "Execute the plan with task tracking."],
  ["/ce-code-review", "Review the change before publishing or merging."],
  ["/ce-compound", "Save the reusable learning from the work."],
] as const;

export const navItems = [
  { label: "Agent setup", icon: Bot },
  { label: "Dataset builder", icon: Database },
  { label: "Recipes", icon: FileText },
  { label: "Code export", icon: TerminalSquare },
] as const;

export const assistantSkills = [
  {
    id: "ward-snapshot",
    title: "HealthMap Task",
    icon: MapPinned,
    description: "Start a guided HealthMap workflow.",
    prompt:
      "Use RHEAS Intern AI Chat guided mode. Do not create the final output yet. Teach me the CE workflow for this task: start with /ce-brainstorm, explain why it comes first, ask me whether this is a ward snapshot, SQL task, Python/R/Jupyter/marimo task, data QA task, or another internship coding project, then give me a short worksheet I must fill in before you draft anything. For ward work, use dim_aldermanic_wards, fact_ward_condition_stats, ward_311_facts, and ward_crime_facts when relevant.",
  },
  {
    id: "word-brief",
    title: "Word Brief",
    icon: FileText,
    description: "Build a Word brief step by step.",
    prompt:
      "Use guided Word Brief mode. Do not write the final brief yet. Teach me the steps for turning a ward data recipe into a leader-facing Word brief using Chicago Health Map branding: white or stone report page, Georgia headings, indigo section accents, clear sans-serif body text, and restrained tables. Ask me to confirm audience, ward, 2-3 measures, comparison group, and caveats. Then give me a fill-in outline with prompts for title, key findings, methods note, limitations, recommended visuals, and appendix table plan.",
  },
  {
    id: "ppt-deck",
    title: "PPT Deck",
    icon: Presentation,
    description: "Design slides after decisions are made.",
    prompt:
      "Use guided PPT Deck mode. Do not create the final deck yet. Teach me how to convert a Word brief into a PowerPoint using Chicago Health Map branding: white dashboard slides, Georgia titles, indigo navigation/header treatment, lavender accents, stone cards, and map-style blue/teal/indigo palettes. Ask me to choose the audience, one core message, 3 supporting exhibits, and what not to overclaim. Then give me a slide-planning worksheet for title, ward context, condition highlights, comparison chart, service/crime context, interpretation, caveats, next steps, speaker notes, and chart specifications.",
  },
  {
    id: "html-snapshot",
    title: "HTML Snapshot",
    icon: Globe2,
    description: "Preview HTML after a worksheet.",
    prompt:
      "Use guided HTML Snapshot mode. Start by teaching what an HTML artifact should include and what decisions I must make before generation. Use Chicago Health Map branding for any HTML skeleton or final artifact: near-white page, Georgia headings, indigo header/buttons, lavender accents, stone cards, and blue/teal/indigo map-style chart colors. Ask me for ward, audience, sections, measures, caveats, and chart placeholders. First provide a checklist and a tiny HTML skeleton only if useful. Do not produce the complete fenced ```html artifact until I confirm the worksheet is complete.",
  },
  {
    id: "data-query",
    title: "Data Query",
    icon: Table2,
    description: "Learn safe SQL and row grain first.",
    prompt:
      "Use guided Data Query mode. Do not jump straight to a query. Teach me row grain, table choice, join keys, filters, and LIMIT. Ask me to choose the project context, relevant table or HealthMap ward context, condition or measure, comparison group, and output columns. Then draft one safe SELECT-only SQL query only after I confirm those choices. Do not use write or admin SQL.",
  },
  {
    id: "phi-csv",
    title: "PHI File",
    icon: ShieldCheck,
    description: "Plan local-first file analysis safely.",
    prompt:
      "Use guided PHI file mode for CSV, XLSX, Parquet, Jupyter notebooks, Python/R/Quarto source, HTML, Word, or PowerPoint files. First ask whether this file is approved for this portal workflow, whether it is local or uploaded as a portal private file record, where it will be analyzed, and what output is needed. Teach me to share the minimum context needed for correct code: schema first, masked or representative row shape only when helpful, and original PHI only when it materially changes the code. Give me a marimo, Jupyter/Python, or R starter that reads from a local path after the approved private file record is downloaded to a local or Rush machine, validates columns, avoids unnecessary identifier output, applies minimum-cell-size suppression for shared aggregate artifacts, and writes reviewed tables or an HTML artifact locally.",
  },
  {
    id: "artifact-review",
    title: "Artifact Review",
    icon: ClipboardCheck,
    description: "Learn review before sharing.",
    prompt:
      "Use guided Artifact Review mode. Teach me how /ce-code-review applies to a ward snapshot. Ask me to paste or summarize my draft, then review for factual clarity, row-grain mistakes, unsupported claims, missing limitations, privacy risk, chart readability, and readiness for Word, PowerPoint, and HTML outputs. End with fixes I should make myself before you polish.",
  },
] as const;

export const wardArtifactFormats = [
  {
    label: "Word",
    icon: FileText,
    prompt:
      "Guide me through preparing a Word document brief for a HealthMap or internship project using Chicago Health Map branding. Start with the decisions and worksheet I need to complete, then help me draft section by section after I answer.",
  },
  {
    label: "PowerPoint",
    icon: Presentation,
    prompt:
      "Guide me through preparing a PowerPoint deck for a HealthMap or internship project using Chicago Health Map branding. Start with the story, audience, slide order, and chart choices I need to decide, then help me build slide by slide.",
  },
  {
    label: "HTML",
    icon: Globe2,
    prompt:
      "Guide me through preparing an HTML artifact for a HealthMap or internship project using Chicago Health Map branding. First make me complete the content and privacy checklist; only produce the complete fenced ```html code block after I confirm the worksheet is ready.",
  },
  {
    label: "File",
    icon: ShieldCheck,
    prompt:
      "Guide me through a PHI file analysis workflow for CSV, XLSX, Parquet, Jupyter notebooks, Python/R/Quarto source, HTML, Word, or PowerPoint files. Help me define the approved location, whether the file is local or uploaded as a portal private file record, minimum context needed for correct code, row grain, direct identifiers to exclude from unnecessary outputs, minimum-cell-size suppression for shared artifacts, and marimo, Jupyter/Python, or R code needed to produce the result safely after the file is downloaded to a local or Rush machine.",
  },
] as const;

export const wardSnapshotDataSources = [
  ["dim_aldermanic_wards", "Ward name, alderman name, population, area, centroid, geometry."],
  ["fact_ward_condition_stats", "Condition counts, denominators, prevalence, year, demographics."],
  ["ward_311_facts", "311 context such as potholes, rodent complaints, graffiti, lights."],
  ["ward_crime_facts", "Crime context categories by ward."],
] as const;

export const cePluginSkills = [
  {
    id: "ce-strategy",
    command: "/ce-strategy",
    title: "Strategy",
    category: "Direction",
    icon: GitBranch,
    purpose: "Create or maintain STRATEGY.md.",
  },
  {
    id: "ce-ideate",
    command: "/ce-ideate",
    title: "Ideate",
    category: "Direction",
    icon: ScanSearch,
    purpose: "Generate and critically evaluate grounded ideas.",
  },
  {
    id: "ce-brainstorm",
    command: "/ce-brainstorm",
    title: "Brainstorm",
    category: "Direction",
    icon: MessageSquareText,
    purpose: "Explore requirements and write a right-sized requirements doc.",
  },
  {
    id: "ce-plan",
    command: "/ce-plan",
    title: "Plan",
    category: "Direction",
    icon: ClipboardCheck,
    purpose: "Create structured implementation plans.",
  },
  {
    id: "ce-work",
    command: "/ce-work",
    title: "Work",
    category: "Execution",
    icon: TerminalSquare,
    purpose: "Execute implementation plans systematically.",
  },
  {
    id: "ce-work-beta",
    command: "/ce-work-beta",
    title: "Work Beta",
    category: "Execution",
    icon: TerminalSquare,
    purpose: "Experimental execution workflow with Codex delegation mode.",
  },
  {
    id: "ce-worktree",
    command: "/ce-worktree",
    title: "Worktree",
    category: "Execution",
    icon: GitBranch,
    purpose: "Ensure work happens in an isolated git worktree.",
  },
  {
    id: "ce-simplify-code",
    command: "/ce-simplify-code",
    title: "Simplify Code",
    category: "Execution",
    icon: Code2,
    purpose: "Simplify recent code changes.",
  },
  {
    id: "ce-debug",
    command: "/ce-debug",
    title: "Debug",
    category: "Execution",
    icon: ScanSearch,
    purpose: "Reproduce failures, trace root cause, and fix bugs.",
  },
  {
    id: "ce-optimize",
    command: "/ce-optimize",
    title: "Optimize",
    category: "Execution",
    icon: ChartColumn,
    purpose: "Run iterative optimization loops.",
  },
  {
    id: "ce-code-review",
    command: "/ce-code-review",
    title: "Code Review",
    category: "Review",
    icon: ClipboardCheck,
    purpose: "Review code with skill-local reviewer personas.",
  },
  {
    id: "ce-doc-review",
    command: "/ce-doc-review",
    title: "Doc Review",
    category: "Review",
    icon: FileText,
    purpose: "Review requirements and plan documents.",
  },
  {
    id: "ce-resolve-pr-feedback",
    command: "/ce-resolve-pr-feedback",
    title: "Resolve PR Feedback",
    category: "Review",
    icon: ClipboardCheck,
    purpose: "Resolve PR review feedback.",
  },
  {
    id: "ce-test-browser",
    command: "/ce-test-browser",
    title: "Test Browser",
    category: "Review",
    icon: Globe2,
    purpose: "Run browser tests on PR-affected pages.",
  },
  {
    id: "ce-test-xcode",
    command: "/ce-test-xcode",
    title: "Test Xcode",
    category: "Review",
    icon: Code2,
    purpose: "Build and test iOS apps on simulator.",
  },
  {
    id: "ce-dogfood-beta",
    command: "/ce-dogfood-beta",
    title: "Dogfood Beta",
    category: "Review",
    icon: CheckCircle2,
    purpose: "Diff-scoped browser QA of the active branch.",
  },
  {
    id: "ce-polish",
    command: "/ce-polish",
    title: "Polish",
    category: "Review",
    icon: ShieldCheck,
    purpose: "Start a dev server and iterate on UX polish.",
  },
  {
    id: "ce-compound",
    command: "/ce-compound",
    title: "Compound",
    category: "Learning",
    icon: Database,
    purpose: "Document solved problems to your private workspace, then promote cohort-safe lessons when ready.",
  },
  {
    id: "ce-compound-refresh",
    command: "/ce-compound-refresh",
    title: "Compound Refresh",
    category: "Learning",
    icon: Database,
    purpose: "Refresh stale or drifting learnings.",
  },
  {
    id: "ce-product-pulse",
    command: "/ce-product-pulse",
    title: "Product Pulse",
    category: "Learning",
    icon: ChartColumn,
    purpose: "Generate time-windowed product pulse reports.",
  },
  {
    id: "ce-riffrec-feedback-analysis",
    command: "/ce-riffrec-feedback-analysis",
    title: "Riffrec Feedback",
    category: "Learning",
    icon: MessageSquareText,
    purpose: "Convert Riffrec recordings or notes into structured feedback.",
  },
  {
    id: "ce-proof",
    command: "/ce-proof",
    title: "Proof",
    category: "Learning",
    icon: FileText,
    purpose: "Create, edit, and share Proof documents.",
  },
  {
    id: "ce-promote",
    command: "/ce-promote",
    title: "Promote",
    category: "Learning",
    icon: Presentation,
    purpose: "Draft user-facing announcement copy.",
  },
  {
    id: "ce-commit",
    command: "/ce-commit",
    title: "Commit",
    category: "Shipping",
    icon: GitBranch,
    purpose: "Create a git commit with a clear message.",
  },
  {
    id: "ce-commit-push-pr",
    command: "/ce-commit-push-pr",
    title: "Commit Push PR",
    category: "Shipping",
    icon: GitBranch,
    purpose: "Commit, push, and open a PR.",
  },
  {
    id: "ce-setup",
    command: "/ce-setup",
    title: "Setup",
    category: "Shipping",
    icon: TerminalSquare,
    purpose: "Diagnose optional tool capabilities and project config.",
  },
  {
    id: "lfg",
    command: "/lfg",
    title: "LFG",
    category: "Shipping",
    icon: Bot,
    purpose: "Full autonomous engineering workflow.",
  },
] as const;
