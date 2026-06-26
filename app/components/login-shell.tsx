"use client";

import { LockKeyhole, LogIn } from "lucide-react";
import type { FormEvent } from "react";
import { useState } from "react";

export function LoginShell() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Sign in failed.");
      setIsSubmitting(false);
      return;
    }

    window.location.reload();
  }

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-mark">
          <LockKeyhole size={24} aria-hidden="true" />
        </div>
        <div>
          <p className="eyebrow">RHEAS Intern AI Chat</p>
          <h1 id="login-title">Sign in to the intern AI chat</h1>
          <p className="lead">
            Use your internship username and temporary password to enter the guided
            AI chat workspace for HealthMap data, artifacts, and coding projects.
          </p>
        </div>

        <form className="login-form" onSubmit={submitLogin}>
          <label>
            Username
            <input
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label>
            Password
            <input
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error ? <div className="login-error">{error}</div> : null}
          <button className="login-button" disabled={!username || !password || isSubmitting} type="submit">
            <LogIn size={17} aria-hidden="true" />
            {isSubmitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}
