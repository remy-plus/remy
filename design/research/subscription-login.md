# Subscription login for a third-party app (research)

Question: may Remy (open-source, github.com/remy-plus/remy) let users sign in with a consumer AI subscription instead of an API key, as Pi's `/login` does?
Method: primary sources only (terms, official docs, official staff/product statements). Access date 2026-10-27. Facts are quoted; inferences are marked **Inference**.

## Summary

| Provider  | Consumer plan                          | Third-party app allowed?                                                                    | Conditions                                                                                                                                     | Known enforcement                                                                                                                                                 |
| --------- | -------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anthropic | Claude Pro/Max                         | **No** (for OAuth tokens from Pro/Max)                                                      | API key via Console or cloud provider. Claude Code's own sign-in only, unmodified binary                                                       | Anthropic "reserves the right to take measures to enforce" (no date on page). Press reports of Pro/Max limits being cut off for third-party harnesses (secondary) |
| OpenAI    | ChatGPT Plus/Pro                       | **Unclear, partner-only**                                                                   | "Sign in with ChatGPT" is a limited trial for selected commercial partners. Open-source partners get plan usage; commercial apps need approval | None found for third-party use. Codex is officially supported with ChatGPT sign-in                                                                                |
| GitHub    | Copilot                                | **Yes, via the official SDK path** (per-user OAuth). **Unclear** for undocumented endpoints | Users authorize your GitHub App/OAuth App; usage bills to each user's Copilot subscription. SDK is preview                                     | None found in the pages checked                                                                                                                                   |
| Google    | Gemini CLI / Code Assist / Antigravity | **No**                                                                                      | Google says third-party tools using Antigravity or Gemini CLI OAuth violate terms. Use AI Studio or Gemini Enterprise API key                  | Account suspension or termination is stated in Google's own docs. Forum reports of mass 403 bans (not primary)                                                    |

## Anthropic

**Fact.** Claude Code legal page, "Authentication and credential use" (fetched 2026-10-27; page shows no date):
- "OAuth authentication is intended exclusively for purchasers of Claude Free, Pro, Max, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications."
- "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens."
- "Developers building products or services ... including those using the Agent SDK, should use API key authentication through Claude Console or a supported cloud provider."
- "Anthropic reserves the right to take measures to enforce these restrictions and may do so without prior notice."
- Also: an end user may sign in "to the unmodified Claude Code binary with their own Claude subscription", including where a platform hosts Claude Code.
- Source: https://code.claude.com/docs/en/legal-and-compliance

**Fact.** Consumer Terms (effective Oct 8, 2025), Section 3: users may not access the Services "through automated or non-human means ... through a bot, script, or otherwise," except via an API key "or where we otherwise explicitly permit it." Source: https://www.anthropic.com/legal/consumer-terms

**Enforcement (secondary).** News coverage from Feb 2026 and an April 2026 report say Pro/Max subscription limits were cut off for third-party harnesses. These are not confirmed by an Anthropic primary source here.

**Verdict: no.** A Remy login flow that takes a Pro/Max OAuth token, or that lets users sign in to Claude.ai inside Remy, is prohibited by the text above. Remy could still let a user run the unmodified `claude` binary (Claude Code) and talk to it, which the page explicitly allows. **Inference:** whether that counts as "Remy calls Claude Code" depends on the details, so treat it as a grey zone and ask Anthropic.

## OpenAI

**Fact.** OpenAI developer docs, Sign in with ChatGPT (fetched 2026-10-27; no date shown): "Sign in with ChatGPT is currently available to selected commercial partners through a limited trial." "ChatGPT plan usage is available to all open-source partners and selected private clients." "Apps approved for ChatGPT plan usage can also complete eligible AI requests." Source: https://developers.openai.com/siwc/quickstart

**Fact.** Codex auth docs: Codex supports "Sign in with ChatGPT for subscription access" and "Sign in with an API key for usage-based access." This is Codex's own client. The page does not address third-party tools using the ChatGPT login. It mentions "LLM proxy server" only for custom model providers with `requires_openai_auth = true`. Source: https://learn.chatgpt.com/docs/auth (redirected from developers.openai.com/codex/auth).

**Fact.** Press coverage (secondary) reports a broader rollout in Oct 2026 with partners such as Notion, Vercel, Devin. OpenAI's help article on the feature returned 403 to the fetch tool, so its partner list and rules are not verified here.

**Verdict: unclear, partner-only.** The official path for an app is an OpenAI-approved partner or an open-source partner (the page does not say how to become one). Remy would have to apply. Without approval, using a ChatGPT login inside Remy is outside the documented program.

## GitHub (Copilot)

**Fact.** GitHub Copilot SDK, GitHub OAuth (fetched 2026-10-27; no date shown): "Each user authenticates with their own GitHub account." "Copilot requests are made on behalf of each authenticated user, using their Copilot subscription." "You create a GitHub OAuth App (or GitHub App), users authorize it, and you pass their access token to the SDK." "Each user needs an active Copilot subscription." The page does not mention preview or terms restrictions, but the SDK is in preview elsewhere (secondary). Source: https://docs.github.com/en/copilot/how-tos/copilot-sdk/set-up-copilot-sdk/github-oauth

**Fact.** GitHub's product terms for Copilot now point to the GitHub Generative AI Services Terms for direct purchasers. The Copilot Product Specific Terms were deprecated effective 5 March 2026 (secondary summary; primary PDF not fetched). I did not find a third-party-tool restriction in the pages checked.

**Gap.** Third-party sources say that tools using VS Code's Copilot client ID and an internal token endpoint are unsupported. I did not confirm that in a GitHub primary source. GitHub's general Terms of Service restrict bot/automated accounts; I did not verify the exact wording.

**Verdict: yes, via the official SDK with per-user OAuth.** This is the path GitHub documents. Remy should register its own OAuth App or GitHub App, use the user's token, and avoid the undocumented endpoint.

## Google (Gemini CLI / Code Assist / Antigravity)

**Fact.** Antigravity FAQ (fetched 2026-10-27; no date shown): "Using third-party software, tools, or services to access Antigravity is a violation of our Terms of Service." "Such actions can result in suspension or termination of your account." "To use a third-party coding agent with Gemini, we recommend using a Gemini Enterprise or Google AI Studio API key." "Wrapping agy inside third-party coding agents or applications, or automating account rotation, is not supported under consumer plans." Source: https://antigravity.google/docs/faq

**Fact.** Gemini CLI terms page (last updated Apr 10, 2026): "Directly accessing the services powering Gemini CLI (for example, the Gemini Code Assist service) using third-party software ... (for example, using OpenClaw with Gemini CLI OAuth)" violates applicable terms "and may lead to account suspension or termination." It also says "Gemini CLI was replaced by Antigravity CLI on June 18th, 2026" for unpaid tier and Google One users. Source: https://geminicli.com/docs/resources/tos-privacy/

**Fact (Pi).** Pi 0.71.0, released 2026-04-30, lists as breaking change: "Removed built-in Google Gemini CLI and Google Antigravity support. Existing configurations using those providers must switch to another supported provider." The release notes give no reason. Source: https://pi.dev/news/releases/0.71.0. The changelog file was not readable through the fetch tool.

**Inference (Pi reason).** The removal coincides with Google's Antigravity FAQ and Gemini CLI retirement. Pi's stated reason is not in the release notes, so the cause is not confirmed.

**Verdict: no.** Google's own docs prohibit third-party OAuth access. Use an AI Studio or Gemini Enterprise API key instead.

## Recommendation for Remy

1. **Ship API-key providers first** (OpenRouter, OpenAI, Anthropic API, Google AI Studio, Groq, Ollama). This is already the Phase 0 design.
2. **GitHub Copilot: the only subscription login we can recommend now.** Register a GitHub App/OAuth App for Remy, use the official Copilot SDK with per-user tokens, and display that usage bills to the user's Copilot plan. Do not use the VS Code client ID or undocumented endpoints.
3. **OpenAI: apply to the partner program** ("Sign in with ChatGPT", open-source partner plan usage). Until approved, keep ChatGPT as API-key only. Track the approval in PLAN.md.
4. **Anthropic and Google: no subscription login.** Remy must not collect or forward Pro/Max OAuth tokens or Antigravity/Gemini CLI credentials. For Claude, the one allowed path is letting the user run the unmodified Claude Code binary. Ask Anthropic before shipping that.
5. **Do not copy Pi's Google OAuth.** Pi removed it on 2026-04-30 and the Google terms still prohibit it.
6. Write this into user-facing docs and the README: state which providers use an API key and which use a subscription, and that Remy does not pass consumer logins between services.

Open items: confirm the OpenAI partner-program terms on openai.com (help article returned 403); read the GitHub Terms of Service Section J text directly; ask Anthropic in writing whether Remy's Claude Code wrapper is permitted.

## Sources (accessed 2026-10-27)

- Anthropic, Claude Code legal and compliance: https://code.claude.com/docs/en/legal-and-compliance (primary, no date shown)
- Anthropic, Consumer Terms of Service (effective Oct 8, 2025): https://www.anthropic.com/legal/consumer-terms (primary)
- OpenAI, Sign in with ChatGPT quickstart: https://developers.openai.com/siwc/quickstart (primary, no date shown)
- OpenAI, Codex authentication (redirects to learn.chatgpt.com): https://learn.chatgpt.com/docs/auth (primary, no date shown)
- OpenAI help article 20001410: https://help.openai.com/en/articles/20001410 (403, not read)
- GitHub, Copilot SDK GitHub OAuth: https://docs.github.com/en/copilot/how-tos/copilot-sdk/set-up-copilot-sdk/github-oauth (primary, no date shown)
- GitHub, Generative AI Services Terms: https://docs.github.com/en/site-policy/github-terms/github-generative-ai-services-terms (404, not read)
- Google, Antigravity FAQ: https://antigravity.google/docs/faq (primary, no date shown)
- Google, Gemini CLI terms of service and privacy: https://geminicli.com/docs/resources/tos-privacy/ (primary, last updated Apr 10, 2026)
- Pi 0.71.0 release notes (2026-04-30): https://pi.dev/news/releases/0.71.0 (project primary)
- Pi changelog: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/CHANGELOG.md (not readable via fetch)
- Secondary only, used for leads: Feb 2026 Anthropic/Antigravity ban coverage; Puter OpenAI OAuth tutorial; Google Antigravity forum threads (not relied on for any verdict).
