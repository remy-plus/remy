import { Fragment } from 'react';
import { isBareUrl, siteName } from '../lib/links.ts';
import { type Block, type Inline, parseAnswer, stabilize } from '../lib/markdown.ts';

const link =
  'text-text underline decoration-edge-hi decoration-1 underline-offset-[3px] transition-colors duration-300 hover:decoration-signal';

/**
 * Keys for parsed nodes. The parser gives them no id, and the list is rebuilt from the answer on
 * every render, so a node is identified by what it says, with a count when the same words repeat.
 */
function keyed<T>(items: T[], of: (item: T) => string): { key: string; item: T }[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const base = of(item);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { key: n === 0 ? base : `${base}#${n}`, item };
  });
}

const spanKey = (s: Inline) => `${s.kind}:${s.kind === 'link' ? s.href : s.text}`;
const blockKey = (b: Block) => {
  if (b.kind === 'code') return `code:${b.text}`;
  if (b.kind === 'list')
    return `list:${b.items.map((i) => i.map((s) => s.text).join('')).join('|')}`;
  return `${b.kind}:${b.spans.map((s) => s.text).join('')}`;
};

type LinkSpan = Extract<Inline, { kind: 'link' }>;

/** A link opens in a new tab. An address shown as itself becomes the site's name, with the address kept. */
function Anchor({ span, className }: { span: LinkSpan; className: string }) {
  const bare = isBareUrl(span.text);
  const label = bare ? siteName(span.href) : span.text;
  return (
    <a
      href={span.href}
      target="_blank"
      rel="noopener noreferrer"
      title={span.href}
      aria-label={bare ? `${label} (${span.href})` : undefined}
      className={className}
    >
      {label}
    </a>
  );
}

const chip =
  'inline-flex max-w-full items-center rounded-full border border-edge-hi bg-surface px-2.5 py-0.5 text-[13px] leading-[1.6] text-text no-underline transition-colors duration-300 hover:border-stone';

const onlyLinks = (spans: Inline[]): LinkSpan[] | null => {
  const links = spans.filter((s): s is LinkSpan => s.kind === 'link');
  if (links.length === 0) return null;
  const rest = spans.filter((s) => s.kind !== 'link');
  return rest.every((s) => s.kind === 'text' && !s.text.trim()) ? links : null;
};

/** A paragraph that is a lead-in such as "Sources:" followed by nothing but links. */
function sourceChips(spans: Inline[]): { lead: string; links: LinkSpan[] } | null {
  const first = spans[0];
  const hasLead = first?.kind === 'text' && first.text.trim().endsWith(':');
  const links = onlyLinks(hasLead ? spans.slice(1) : spans);
  return links ? { lead: hasLead && first ? first.text.trim() : '', links } : null;
}

function Chips({ links, lead }: { links: LinkSpan[]; lead?: string }) {
  return (
    <p className="mt-0 mb-3 flex flex-wrap items-center gap-1.5 last:mb-1">
      {lead ? <span className="mr-1 text-muted">{lead}</span> : null}
      {keyed(links, (l) => l.href).map(({ key, item }) => (
        <Anchor key={key} span={item} className={chip} />
      ))}
    </p>
  );
}

function Spans({ spans }: { spans: Inline[] }) {
  return (
    <>
      {keyed(spans, spanKey).map(({ key, item: s }) => {
        if (s.kind === 'code')
          return (
            <code
              key={key}
              className="rounded-[5px] bg-raise px-1.5 py-0.5 font-mono text-[13px] text-text"
            >
              {s.text}
            </code>
          );
        if (s.kind === 'strong')
          return (
            <strong key={key} className="font-medium text-text">
              {s.text}
            </strong>
          );
        if (s.kind === 'em')
          return (
            <em key={key} className="italic">
              {s.text}
            </em>
          );
        if (s.kind === 'link') return <Anchor key={key} span={s} className={link} />;
        return <Fragment key={key}>{s.text}</Fragment>;
      })}
    </>
  );
}

function BlockView({ block }: { block: Block }) {
  if (block.kind === 'code')
    return (
      <pre className="mt-0 mb-3 overflow-x-auto rounded-[10px] border border-edge bg-surface p-3 font-mono text-[13px] leading-[1.6] text-text">
        <code>{block.text}</code>
      </pre>
    );
  if (block.kind === 'heading')
    return (
      <p className="mt-0 mb-2 text-[15px] leading-[1.6] font-medium text-text">
        <Spans spans={block.spans} />
      </p>
    );
  if (block.kind === 'quote')
    return (
      <blockquote className="mt-0 mb-3 border-l border-edge-hi pl-3 text-muted">
        <Spans spans={block.spans} />
      </blockquote>
    );
  if (block.kind === 'list') {
    const rows = block.items.map(onlyLinks);
    if (rows.length > 0 && rows.every((r) => r?.length === 1))
      return <Chips links={rows.flatMap((r) => r ?? [])} />;
    return (
      <ul
        className={`mt-0 mb-3 flex list-outside flex-col gap-1 pl-5 marker:text-muted ${
          block.ordered ? 'list-decimal' : 'list-disc'
        }`}
      >
        {keyed(block.items, (item) => item.map((s) => s.text).join('')).map(({ key, item }) => (
          <li key={key} className="pl-0.5">
            <Spans spans={item} />
          </li>
        ))}
      </ul>
    );
  }
  const chips = sourceChips(block.spans);
  if (chips) return <Chips links={chips.links} lead={chips.lead} />;
  return (
    <p className="mt-0 mb-3 last:mb-1">
      <Spans spans={block.spans} />
    </p>
  );
}

/** Remy's answer, with the links, lists and code it writes rendered as such. */
export function AnswerText({ text, streaming = false }: { text: string; streaming?: boolean }) {
  // While the words are still coming, a block keeps its place, so the page updates it in place
  // instead of drawing it again at every token. A finished answer is keyed by what it says.
  const blocks = streaming
    ? parseAnswer(stabilize(text)).map((item, i) => ({ key: `at${i}`, item }))
    : keyed(parseAnswer(text), blockKey);
  return (
    <div
      className={`max-w-[68ch] text-[15px] leading-[1.7] break-words text-text${
        streaming ? ' stream-caret' : ''
      }`}
    >
      {blocks.map(({ key, item }) => (
        <BlockView key={key} block={item} />
      ))}
    </div>
  );
}
