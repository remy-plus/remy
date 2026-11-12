// A fake of skills.sh, botdirectory.ai and GitHub for tests. No network.
export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const SKILL = '---\nname: pdf\ndescription: Work with PDFs\n---\n\n1. Open it.\n';
export const SHA = 'a'.repeat(40);

/** A fake of every host the code talks to. `seen` records the URLs. */
export function fakeNet(extra: Record<string, () => Response> = {}) {
  const seen: string[] = [];
  const f = async (url: string): Promise<Response> => {
    seen.push(url);
    for (const [k, v] of Object.entries(extra)) if (url.includes(k)) return v();
    if (url.startsWith('https://skills.sh/api/search'))
      return json({
        skills: [
          {
            id: 'anthropics/skills/pdf',
            source: 'anthropics/skills',
            skillId: 'pdf',
            name: 'pdf',
            installs: 227931,
          },
          { id: 'bad id', name: 'x' },
        ],
      });
    if (url.includes('/git/trees/'))
      return json({
        tree: [
          { path: 'README.md', type: 'blob' },
          { path: 'other/pdf/SKILL.md', type: 'blob' },
          { path: 'skills/pdf/SKILL.md', type: 'blob' },
          { path: 'skills/pdf', type: 'tree' },
        ],
      });
    if (url.includes('/commits/')) return json({ sha: SHA });
    if (
      url.startsWith(
        `https://raw.githubusercontent.com/anthropics/skills/${SHA}/skills/pdf/SKILL.md`,
      )
    )
      return new Response(SKILL);
    if (url.startsWith('https://api.botdirectory.ai/api/bots'))
      return json({
        bots: [
          {
            slug: 'call-cost-saver',
            name: 'Call Cost Saver',
            category: 'Personal',
            integrations: ['Phone', 'Email'],
            prompt: 'You handle my calls. '.repeat(100),
          },
          { slug: 'no-prompt', name: 'Empty', category: 'x', integrations: [] },
        ],
      });
    return new Response('no', { status: 404 });
  };
  return { f, seen };
}
