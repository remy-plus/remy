// What the person sees while talking to Remy: the orb, what was heard, and the three ways out.
import { Orb } from './Orb.tsx';
import { buttonPrimary, buttonQuiet } from './ui.ts';

export type VoiceMode = 'closed' | 'listening' | 'editing';

function Key({ children }: { children: string }) {
  return (
    <kbd className="font-mono mr-1.5 rounded border border-edge bg-surface px-1.5 py-0.5 text-[12px] text-text">
      {children}
    </kbd>
  );
}

export function VoiceOverlay(props: {
  mode: VoiceMode;
  listening: boolean;
  final: string;
  interim: string;
  problem: string;
  error: string;
  canListen: boolean;
  onText: (v: string) => void;
  onSend: () => void;
  onEdit: () => void;
  onCancel: () => void;
}) {
  const { mode, listening, final, interim, problem, error, canListen } = props;
  const editing = mode === 'editing';
  const status = !canListen
    ? "This browser can't listen. Type instead."
    : problem || (listening ? 'Listening' : editing ? 'Edit, then send' : 'Stopped listening');
  return (
    <div className="grid min-h-full place-content-center justify-items-center px-5 py-10 text-center">
      <div className="h-[250px] w-[260px] max-w-full overflow-hidden">
        <div className="w-[560px]" style={{ marginLeft: -150 }}>
          <Orb ring={false} still={!listening} />
        </div>
      </div>
      <p
        role="status"
        className="font-mono mt-2 mb-0 flex items-center gap-2.5 text-[13px] text-muted"
      >
        {listening && <span aria-hidden="true" className="size-2 rounded-full bg-signal" />}
        <span className={listening ? 'text-signal' : ''}>{status}</span>
      </p>

      {editing ? (
        <textarea
          aria-label="What you need done"
          // biome-ignore lint/a11y/noAutofocus: the box is the one thing to use on this screen
          autoFocus
          rows={3}
          value={final}
          placeholder="Tell Remy what you need done"
          onChange={(e) => props.onText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              props.onSend();
            }
          }}
          className="mt-6 block w-[min(720px,100%)] resize-none rounded-[14px] border border-edge-hi bg-surface p-4 text-[22px] text-text outline-none placeholder:text-muted focus-visible:border-text"
        />
      ) : (
        <p
          aria-live="polite"
          className="mt-6 mb-0 max-w-[820px] text-[28px] leading-snug sm:text-[34px]"
        >
          {final || interim ? (
            <>
              <span aria-hidden="true">“</span>
              {final}
              {final && interim ? ' ' : ''}
              <span className="text-muted">{interim}</span>
              <span aria-hidden="true">”</span>
              {/* The cursor is a drawn block, not a typed pipe. */}
              <span
                aria-hidden="true"
                className="ml-0.5 inline-block h-[0.85em] w-[0.4em] translate-y-[0.06em] bg-text"
              />
            </>
          ) : (
            <span className="text-muted">Say what you need done</span>
          )}
        </p>
      )}

      {error && (
        <p role="alert" className="font-mono mt-3 mb-0 text-[13px] text-muted">
          {error}
        </p>
      )}
      <p className="font-mono mt-6 mb-0 flex flex-wrap justify-center gap-x-6 gap-y-2 text-[12px] text-muted">
        {!editing && canListen && (
          <span>
            <Key>Space</Key> release to send
          </span>
        )}
        <span>
          <Key>Esc</Key> to cancel
        </span>
        {!editing && canListen && (
          <span>
            <Key>E</Key> to edit
          </span>
        )}
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <button type="button" className={`${buttonPrimary} px-5 py-3`} onClick={props.onSend}>
          Send
        </button>
        {!editing && canListen && (
          <button type="button" className={`${buttonQuiet} px-5 py-3`} onClick={props.onEdit}>
            Edit
          </button>
        )}
        <button type="button" className={`${buttonQuiet} px-5 py-3`} onClick={props.onCancel}>
          Cancel
        </button>
      </div>
      <p className="mt-8 mb-0 max-w-[460px] text-[12px] leading-relaxed text-muted">
        Your browser turns speech into words. The audio never leaves this browser; only the words
        you send go to Remy, on your own machine.
      </p>
    </div>
  );
}
