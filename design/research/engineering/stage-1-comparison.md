# Stage 1 comparison

What the two X posts in the Road to 1.0 point at, and what Remy should take from them. Written 2026-11-05.

**How far this goes:** the four CopilotKit projects were read from their READMEs and repository layouts, not their source. Anything marked "claims" is what their README says, not something we ran. The name "MausBot" appears in none of them; the post lists OpenBot, OpenMuse, OpenDots and OpenDuet.

**The short version:** all four are beta or alpha templates you clone and rebuild. They show product surfaces well: a live computer view, cards in chat, a morning brief, messaging channels. None publishes a general score for finishing real work, so "10x better" has no number to beat. Remy's edge is the part they do not advertise: replay evals in CI and safety rules enforced in code. Remy's gaps are at the end of a task: proving the work is done, and showing what happened.

## OpenBot

Self-hosted agent platform for companies. A coworker gets its own browser, files and granted tools. Every action goes through one gateway that decides and records it. Needs Docker, PostgreSQL, Bun and a CopilotKit Intelligence project.

- **Remy already has:** one gate for every tool call (`AuthorizedCall`), with an event log of each step.
- **Take:** taking the wheel mid-task and handing it back. Remy can show its browser, but the flow is not designed around handing control back and forth.
- **Skip:** AG-UI and any-framework support. Remy is one agent, and that is the point of the single loop.
