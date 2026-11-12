// The voice Remy speaks replies in. The voice itself and its key live on the machine that runs Remy;
// this page only picks which voice (a Fish Audio voice model id) and says what is in use.
import { useId, useState } from 'react';
import { buttonQuiet, field } from '../../components/ui.ts';
import { DEFAULT_VOICE_ID, useSetting } from '../../settings.ts';
import { Row } from './controls.tsx';
import type { SectionProps } from './sections.ts';

/** What the server accepts: letters, digits, - and _, 8 to 64 long. */
export const VOICE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export const VOICE_NO_KEY =
  "Remy has no voice key yet, so replies use your browser's voice. To add one, run security add-generic-password -s remy -a fish -w on the machine that runs Remy.";
export const VOICE_READY = 'Spoken replies use this voice.';

export function VoiceRow({ data }: Pick<SectionProps, 'data'>) {
  const id = useId();
  const [saved, setSaved] = useSetting('voice.id');
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? saved;
  const bad = draft !== null && draft.trim() !== '' && !VOICE_ID_RE.test(draft.trim());

  const commit = () => {
    if (draft === null) return;
    const next = draft.trim();
    if (VOICE_ID_RE.test(next)) {
      if (next !== saved) setSaved(next);
      setDraft(null);
    } else if (next === '') setDraft(null); // an empty box goes back to what is saved
  };
  const status =
    data?.voice === undefined
      ? "Turn spoken replies on with the speaker button in the chat box. They use your browser's voice unless Remy has a voice key."
      : data.voice.ready
        ? VOICE_READY
        : VOICE_NO_KEY;

  return (
    <Row
      id="voice"
      title="Voice"
      help="Which voice Remy speaks with. Turn spoken replies on with the speaker button in the chat box."
    >
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={id} className="sr-only">
          Voice id
        </label>
        <input
          id={id}
          type="text"
          spellCheck={false}
          autoComplete="off"
          value={shown}
          aria-invalid={bad || undefined}
          aria-describedby={`${id}-note`}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
          }}
          className={`${field} w-full max-w-[360px] font-mono text-[13px]`}
        />
        <button
          type="button"
          className={buttonQuiet}
          disabled={saved === DEFAULT_VOICE_ID && draft === null}
          onClick={() => {
            setDraft(null);
            setSaved(DEFAULT_VOICE_ID);
          }}
        >
          Use the default voice
        </button>
      </div>
      <p id={`${id}-note`} role="status" className="mt-3 mb-0 max-w-[560px] text-[13px] text-muted">
        {bad ? 'A voice id is letters and digits, 8 or more, from fish.audio.' : status}
      </p>
    </Row>
  );
}
