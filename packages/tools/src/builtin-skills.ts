// The skills every Remy has. Written in the same SKILL.md format as the user's own, so they parse
// through the same code and a user skill with the same name replaces one.
import { parseSkill, type Skill } from './skills.ts';

const RESEARCH = `---
name: research
description: Answer a question that needs current facts from the web, with sources. Use for research, looking something up, checking facts or summarising what is known about a topic.
allowed-tools: web_search browser_open browser_look fetch_url update_plan
---
1. Restate the question in one line and note what a good answer must contain (numbers, dates, names).
2. Search with two or three different phrasings. Prefer primary sources: official sites, papers, filings, the maker's own docs.
3. Open the best two to four results and read the parts that answer the question. Skip pages that only repeat others.
4. When sources disagree, say so and give the most recent or most authoritative one, with its date.
5. Answer first, in a few sentences, then the details. Give each fact its source link.
6. Say plainly what you could not confirm. Never fill a gap from memory and present it as found.
`;

const COMPARE_AND_BUY = `---
name: compare-and-buy
description: Compare products, plans or offers and help the user pick and buy one. Use for shopping, choosing between options, finding the best price or deal.
allowed-tools: web_search browser_open browser_look browser_click browser_type browser_act update_plan ask_user
---
1. Find out what matters: budget, must-haves, deal-breakers, where it ships. Ask once, in one question, only if the message does not say.
2. Find three to five real options. For each, note the price with tax and shipping, the key specs, the seller and any catch (subscription, returns, delivery time).
3. Show a short table and recommend one, with the reason in one line.
4. Only buy when the user asked you to. Before any payment step, stop and show what will be bought, from whom, and the total. The approval card is where the user says yes.
5. After buying, report the order number, total and delivery date from the confirmation page.
`;

const TRIAGE_ISSUES = `---
name: triage-issues
description: Go through open GitHub issues, group them and say what to do first. Use for triaging a backlog or reviewing bug reports.
connections: github
---
1. List the open issues for the repository the user named. If they named none, ask which one.
2. Group them: bugs, requests, questions, duplicates. Note which ones many people care about.
3. Pick the three to do first and say why in one line each.
4. Change nothing unless the user asks. Labels, comments and closing all go through the approval card.
`;

const SAVE_TO_NOTION = `---
name: save-to-notion
description: Save notes, research or a summary to a Notion page. Use when the user asks to put something in Notion.
connections: notion
---
1. Find the page or database the user means. If there are several, ask which one.
2. Write the content in short sections with the main point first, and keep any source links.
3. Create or update the page; the approval card shows what will be written.
4. Give the user the link to the page.
`;

const WRITE_AND_SEND = `---
name: write-and-send
description: Draft a message, email or post in the user's voice and send it once they approve. Use for writing an email, replying, posting an update or messaging someone.
allowed-tools: browser_open browser_look browser_type browser_act ask_user
---
1. Work out who it is for, what it must say and the tone. Use the user's saved notes about how they write when there are any.
2. Draft it short: the point in the first line, then only what the reader needs. No filler, no exclamation marks unless the user writes that way.
3. Show the draft. Send only when the user asked you to send it; the approval card shows the exact text and recipient.
4. Never add recipients, attachments or links the user did not ask for.
5. After sending, say where it went and when.
`;

/** The built-in skills, parsed once. */
export const BUILTIN_SKILLS: Skill[] = [
  RESEARCH,
  COMPARE_AND_BUY,
  WRITE_AND_SEND,
  TRIAGE_ISSUES,
  SAVE_TO_NOTION,
].map((text) => {
  const r = parseSkill(text);
  if (!r.ok) throw new Error(`A built-in skill does not parse: ${r.error}`);
  return { ...r.skill, source: 'builtin' as const };
});
