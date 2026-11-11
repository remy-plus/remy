import { Fragment } from 'react';
import { type Block, type Inline, parseAnswer } from '../lib/markdown.ts';

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
        if (s.kind === 'link')
          return (
            <a key={key} href={s.href} target="_blank" rel="noreferrer noopener" className={link}>
              {s.text}
            </a>
          );
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
  if (block.kind === 'list')
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
  return (
    <p className="mt-0 mb-3 last:mb-1">
      <Spans spans={block.spans} />
    </p>
  );
}

/** Remy's answer, with the links, lists and code it writes rendered as such. */
export function AnswerText({ text }: { text: string }) {
  return (
    <div className="max-w-[68ch] text-[15px] leading-[1.7] break-words text-text">
      {keyed(parseAnswer(text), blockKey).map(({ key, item }) => (
        <BlockView key={key} block={item} />
      ))}
    </div>
  );
}
