# Token Cost Control Plan

## Principle

Hosting should stay free-tier or near-free, but Microsoft Foundry/Azure AI usage is variable token cost. The app must measure and limit token use from day one.

## What to track per request

- user id,
- workflow,
- model,
- input tokens,
- output tokens,
- cached input tokens if provider reports them,
- estimated cost,
- request timestamp,
- success/failure.

## Cost formula

Store model prices as config, not hard-coded constants:

```text
estimated_cost =
  (input_tokens / 1_000_000) * input_price_per_1m_tokens
+ (output_tokens / 1_000_000) * output_price_per_1m_tokens
+ (cached_input_tokens / 1_000_000) * cached_input_price_per_1m_tokens
```

Azure/Foundry account pricing is drift-prone. Verify exact prices in the Azure portal before intern launch and keep prices configurable. OpenAI configuration is local-development fallback only and must not be used for production or Vercel routing.

Current Azure deployment recommendation, based on the resource group deployments visible on 2026-06-25:

Available Azure model base names/deployments:

- `gpt-4.1`
- `gpt-5-mini`
- `gpt-5.3-codex`
- `gpt-5.4`
- `gpt-5.4-mini`
- `gpt-5.5`

Active route mapping:

- `AZURE_AI_CHEAP_DEPLOYMENT=gpt-5.4-mini`
- `AZURE_AI_DEFAULT_DEPLOYMENT=gpt-5.3-codex`
- `AZURE_AI_CODE_DEPLOYMENT=gpt-5.3-codex`
- `AZURE_AI_STRONG_DEPLOYMENT=gpt-5.4`
- `AZURE_AI_PREMIUM_DEPLOYMENT=gpt-5.5`

Rationale: interns need a model strong enough to produce reliable SQL, code, methods notes, and plugin-guided workflows. Use `gpt-5.3-codex` for normal portal work and most CE plugin skills, `gpt-5.4-mini` only for lightweight summaries/outlines and cached schema utility work, `gpt-5.4` for complex analysis, and `gpt-5.5` only for explicit final QA or admin review. Keep `gpt-5-mini` and `gpt-4.1` as manual fallbacks, not active routes.

Pricing is still unresolved. Verify the actual Azure region/agreement prices before intern launch and enter those prices in configurable cost settings rather than code.

## Suggested budgets

For six interns, start conservative:

```text
Per intern daily warning: $2
Per intern daily hard cap: $5
Total monthly warning: $75
Total monthly hard cap: $100
```

Adjust after observing real usage for one week.

## Model routing

| Workflow | Default model class | Notes |
|---|---|---|
| Classify user intent | cheap | Short prompts only, if a separate classifier is added |
| Explain SQL | code | Use cached schema summary |
| Generate simple SQL | default | Escalate only if joins fail |
| Generate complex SQL | strong | Use for multi-table joins or repeated failures |
| Debug SQL error | code | Include error + schema only |
| Generate Python/R/Jupyter/marimo snippets | code | Use deterministic templates where possible |
| Summarize chat/session | cheap | Run when history is long |
| Code review / workflow review | code | Admin or explicit request only |
| Final QA / red-team review | premium | Admin or explicit final-review request only |

For the embedded Compound Engineering plugin:

| CE skill class | Route |
|---|---|
| `/ce-strategy`, `/ce-ideate`, `/ce-brainstorm`, `/ce-plan`, `/ce-work`, `/ce-work-beta`, `/ce-worktree`, `/ce-debug`, `/ce-optimize`, `/ce-code-review`, `/ce-doc-review`, `/ce-resolve-pr-feedback`, `/ce-test-browser`, `/ce-test-xcode`, `/ce-polish`, `/ce-simplify-code`, `/ce-compound`, `/ce-compound-refresh`, `/ce-product-pulse`, `/ce-riffrec-feedback-analysis`, `/ce-promote`, `/ce-commit`, `/ce-commit-push-pr`, `/ce-setup`, `/lfg` | code |
| `/ce-dogfood-beta`, `/ce-proof` | premium |

## Token-saving tactics

1. Cache schema summaries and table descriptions.
2. Do not send full table rows to the model.
3. Send only relevant table/column metadata.
4. Use small approved samples only when needed.
5. Summarize long conversations before they exceed context budget.
6. Save successful dataset recipes and offer them as reusable examples.
7. Use templates for common Python/R/Jupyter/marimo code.
8. Require confirmation before premium-model escalation.
9. Show users an estimated cost tier before very large requests.

## Admin dashboard metrics

- Total token cost today/week/month.
- Cost by intern.
- Cost by workflow.
- Cost by model.
- Top expensive prompts.
- Strong-model escalation count.
- Failed query/debug loops.

## Kill switches

Implement environment flags:

```text
AI_ENABLED=true
STRONG_MODEL_ENABLED=true
QUERY_PREVIEW_ENABLED=true
ARTIFACT_UPLOAD_ENABLED=true
```

If costs spike, disable strong model first, then full AI if necessary.
