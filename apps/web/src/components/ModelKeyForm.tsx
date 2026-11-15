// Adds a model key without the terminal: pick a provider from a short list (cheapest first), paste the
// key, and Remy checks it with one small real request before saving it on the machine that runs Remy.
// The key lives in this component's state only until the server says yes (or no), is cleared either
// way, and is never shown again: the server never sends a key back.
import { type FormEvent, useEffect, useId, useState } from 'react';
import { type ModelChoice, type ModelSaved, type ModelSetup, useApi } from '../api/index.tsx';
import { describeError } from '../lib/errors.ts';
import { Icon } from './Icon.tsx';
import { buttonPrimary, field } from './ui.ts';

export function ModelKeyForm({
  setup,
  onSaved,
}: {
  setup: ModelSetup;
  onSaved: (saved: ModelSaved) => void;
}) {
  const api = useApi();
  const group = useId();
  const keyId = useId();
  const [choice, setChoice] = useState<ModelChoice | undefined>(setup.choices[0]);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<ModelSaved | null>(null);
  // The list can arrive after the first paint.
  useEffect(() => {
    setChoice((c) => c ?? setup.choices[0]);
  }, [setup.choices]);

  const pick = (c: ModelChoice) => {
    setChoice(c);
    setKey(''); // a key pasted for one provider is never sent to another
    setError('');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!choice || busy) return;
    const typed = key.trim();
    if (choice.needsKey && !typed) {
      setError(
        'Paste the key first. It is the long line of letters and digits from your provider.',
      );
      return;
    }
    setBusy(true);
    setError('');
    try {
      const done = await api.saveModelKey?.(choice.id, typed);
      if (!done)
        throw new Error(
          'This Remy cannot add a key from the browser. Run remy login in a terminal.',
        );
      setSaved(done);
      onSaved(done);
    } catch (err) {
      setError(
        describeError(
          err,
          'Remy could not check that key. Check your internet connection, then try again.',
        ),
      );
    } finally {
      setKey(''); // gone from this page whatever happened
      setBusy(false);
    }
  };

  if (saved)
    return (
      <p role="status" className="m-0 flex items-start gap-2 text-[14px] leading-snug text-text">
        <Icon name="check" className="mt-0.5 shrink-0 text-signal" />
        <span>
          Connected. Remy will think with {saved.current.model} from {saved.current.label}. The key
          is saved {saved.saved}, and this page will not show it again.
        </span>
      </p>
    );

  return (
    <form onSubmit={submit} noValidate>
      <fieldset className="m-0 grid gap-2.5 border-0 p-0">
        <legend className="sr-only">Who Remy thinks with</legend>
        {setup.choices.map((c) => (
          <label
            key={c.id}
            className="flex cursor-pointer items-start gap-4 rounded-[10px] border border-edge bg-surface px-5 py-3 has-checked:border-text has-checked:bg-raise has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-text"
          >
            <input
              type="radio"
              name={group}
              value={c.id}
              checked={choice?.id === c.id}
              onChange={() => pick(c)}
              className="mt-1.5 size-4 shrink-0 accent-signal"
            />
            <span>
              <span className="block text-[16px] font-medium">{c.label}</span>
              {/* Only the chosen one explains itself, so the key field stays in view. */}
              {choice?.id === c.id && (
                <span className="mt-0.5 block text-[14px] leading-snug text-muted">{c.note}</span>
              )}
            </span>
          </label>
        ))}
      </fieldset>

      {choice?.needsKey && (
        <div className="mt-6">
          <label htmlFor={keyId} className="font-mono block text-[12px] text-muted">
            Your {choice.label} key
          </label>
          <p className="mt-1.5 mb-0 text-[13px] leading-snug text-muted">
            {choice.keyUrl ? (
              <>
                Get one at{' '}
                <a
                  className="text-text underline"
                  href={`https://${choice.keyUrl}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {choice.keyUrl}
                </a>
                . It is a password that lets Remy use {choice.label}.
              </>
            ) : (
              `It is a password that lets Remy use ${choice.label}.`
            )}
          </p>
          <input
            id={keyId}
            type="password"
            name="model-key"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            data-1p-ignore
            value={key}
            onChange={(e) => setKey(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${keyId}-error` : undefined}
            className={`${field} mt-2 block w-full max-w-[460px] py-3 ${error ? 'border-text' : ''}`}
          />
        </div>
      )}
      {choice && !choice.needsKey && (
        <p className="mt-6 mb-0 text-[14px] text-muted">
          No key needed. Remy looks for Ollama on this computer and uses {choice.model}.
        </p>
      )}
      {error && (
        <p
          id={`${keyId}-error`}
          role="alert"
          className="mt-3 mb-0 flex items-start gap-2 text-[14px] leading-snug text-text"
        >
          <Icon name="close" className="mt-0.5 shrink-0 text-muted" />
          <span className="min-w-0">{error}</span>
        </p>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button type="submit" disabled={busy || !choice} className={`${buttonPrimary} px-5 py-3`}>
          {busy ? 'Checking' : choice?.needsKey ? 'Check and save' : 'Use this'}
        </button>
        <p className="m-0 max-w-[400px] text-[13px] leading-snug text-muted">
          Remy sends one tiny test message to make sure it works, which costs a fraction of a cent.
          The key stays on this computer.
        </p>
      </div>
    </form>
  );
}
