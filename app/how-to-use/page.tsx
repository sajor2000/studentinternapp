import Link from "next/link";
import { BookOpen, Braces, Database, ExternalLink, GitBranch, ShieldCheck } from "lucide-react";
import { LoginShell } from "../components/login-shell";
import {
  commandBlocks,
  compoundPluginUrl,
  context7DocsUrl,
  neonDocsUrl,
  safetyChecks,
  workflowSteps,
} from "../data/student-agent-guide";
import { getSession } from "../lib/auth";

export default async function HowToUsePage() {
  const session = await getSession();

  if (!session) {
    return <LoginShell />;
  }

  const neonWorkflowEnabled = session.role === "admin" || session.workflowMode === "neon" || session.workflowMode === "dual";
  const phiLocalWorkflowEnabled = session.role === "admin" || session.workflowMode === "phi_local" || session.workflowMode === "dual";
  const visibleWorkflowSteps = workflowSteps.filter((step) => {
    if (neonWorkflowEnabled) {
      return true;
    }

    return !step.title.includes("dataset recipe") && !step.title.includes("Neon MCP");
  });
  const visibleCommandBlocks = commandBlocks.filter((block) => {
    if (neonWorkflowEnabled) {
      return true;
    }

    return !block.label.toLowerCase().includes("neon");
  });

  return (
    <main className="guide-page">
      <nav className="guide-nav" aria-label="Guide navigation">
        <Link href="/">Back to chat</Link>
        <span>{session.displayName}</span>
      </nav>

      <section className="guide-hero">
        <div className="guide-mark">
          <BookOpen size={26} aria-hidden="true" />
        </div>
        <div>
          <h1>How to use RHEAS Intern AI Chat</h1>
          <p>
            Use this portal like a project-specific coding agent. Start with a slash command,
            answer the checkpoint, then build code, ward snapshots, or artifacts in verified steps.
          </p>
        </div>
      </section>

      <section className="guide-grid" aria-label="Core workflow">
        {visibleWorkflowSteps.map((step, index) => (
          <article className="guide-card" key={step.title}>
            <span className="guide-step-number">{index + 1}</span>
            <h2>{step.title}</h2>
            <p>{step.body}</p>
          </article>
        ))}
      </section>

      <section className="guide-section" aria-labelledby="connections">
        <h2 id="connections">Connection options</h2>
        <div className="guide-grid three">
          {neonWorkflowEnabled ? (
            <>
              <article className="guide-card">
                <Database size={22} aria-hidden="true" />
                <h3>Portal Neon connection</h3>
                <p>
                  Intern chat uses the server-side read-only Neon URL. Keep owner URLs and API keys
                  out of chat, browser code, and local starter notebooks.
                </p>
              </article>
              <article className="guide-card">
                <ExternalLink size={22} aria-hidden="true" />
                <h3>Neon MCP setup</h3>
                <p>
                  Use MCP only for approved read-only development workflows where database actions are reviewed first.
                </p>
                <a href={neonDocsUrl} rel="noreferrer" target="_blank">
                  Open Neon MCP docs
                </a>
              </article>
            </>
          ) : null}
          {phiLocalWorkflowEnabled ? (
            <article className="guide-card">
              <Braces size={22} aria-hidden="true" />
              <h3>Local/Rush notebook workflow</h3>
              <p>
                Download approved private file records, then run generated Python, R, Jupyter,
                or marimo code only on an approved local or Rush machine. The portal is not the
                compute sandbox for arbitrary analysis code.
              </p>
            </article>
          ) : null}
          <article className="guide-card">
            <Braces size={22} aria-hidden="true" />
            <h3>Compute boundary</h3>
            <p>
              Use Vercel for login, AI guidance, read-only Neon previews, recipes, usage tracking,
              and artifact upload. Use approved Rush or local Python/R/marimo environments for full
              analysis execution.
            </p>
          </article>
          <article className="guide-card">
            <GitBranch size={22} aria-hidden="true" />
            <h3>Compound Engineering plugin</h3>
            <p>
              The portal embeds the CE workflow as guided chat launchers. Local Codex users can also
              install the full plugin without receiving portal Foundry keys or model-route settings.
            </p>
            <a href={compoundPluginUrl} rel="noreferrer" target="_blank">
              Open plugin repo
            </a>
          </article>
          <article className="guide-card">
            <BookOpen size={22} aria-hidden="true" />
            <h3>Context7 MCP docs</h3>
            <p>
              Use Context7 only for public library documentation. Never send PHI, PII, credentials,
              private source code, file names, or controlled data values.
            </p>
            <a href={context7DocsUrl} rel="noreferrer" target="_blank">
              Open Context7 Codex docs
            </a>
          </article>
        </div>
      </section>

      <section className="guide-section" aria-labelledby="commands">
        <h2 id="commands">Setup commands</h2>
        <div className="guide-command-list">
          {visibleCommandBlocks.map((block) => (
            <article className="guide-command" key={block.label}>
              <h3>{block.label}</h3>
              <pre>{block.command}</pre>
              <p>{block.note}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="guide-section" aria-labelledby="safety">
        <h2 id="safety">Safety defaults</h2>
        <div className="guide-grid two">
          {safetyChecks.map((check) => {
            const Icon = check.icon;
            return (
              <article className="guide-card compact" key={check.text}>
                <Icon size={20} aria-hidden="true" />
                <p>{check.text}</p>
              </article>
            );
          })}
          <article className="guide-card compact">
            <ShieldCheck size={20} aria-hidden="true" />
            <p>
              PHI can be used when it is needed for correct code. The app masks unnecessary direct
              identifiers before model calls.
            </p>
          </article>
          <article className="guide-card compact">
            <GitBranch size={20} aria-hidden="true" />
            <p>
              Model routing is automatic in the portal. Use the CE workflow buttons and do not configure
              model names, route tiers, or Foundry keys for portal work.
            </p>
          </article>
        </div>
      </section>
    </main>
  );
}
