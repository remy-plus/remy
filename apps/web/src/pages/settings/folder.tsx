// The one folder Remy may read and write. Browsers cannot hand over a real path from a picker, so
// the path is typed; the server checks it and says in plain words why it refuses one.
import { useEffect, useId, useState } from 'react';
import { useApi } from '../../api/index.tsx';
import { Icon } from '../../components/Icon.tsx';
import { buttonQuiet, field } from '../../components/ui.ts';
import { describeError } from '../../lib/errors.ts';
import { Row } from './controls.tsx';
import type { SectionProps } from './sections.ts';

export const FOLDER_HELP =
  'Remy reads and writes only inside this folder, and asks before changing anything. Leave empty to give each task its own empty folder.';
export const FOLDER_FLAG =
  'Remy was started with --workspace, which takes the place of this setting. Restart it without that option to choose a folder here.';

export function FolderRow({ data, reload }: Pick<SectionProps, 'data' | 'reload'>) {
  const api = useApi();
  const id = useId();
  const info = data?.workspace;
  const saved = info?.saved ?? '';
  const [draft, setDraft] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'cleared' | 'failed'>('idle');
  const [message, setMessage] = useState('');
  const locked = info?.source === 'flag';
  const shown = draft ?? saved;

  // A reload that changes the saved folder (another tab, a clear) replaces an untouched box.
  useEffect(() => {
    if (draft === saved) setDraft(null);
  }, [draft, saved]);

  const write = async (path: string | null) => {
    setState('saving');
    try {
      await api.updateSettings({ workspace: path });
      setDraft(null);
      setState(path ? 'saved' : 'cleared');
      reload();
    } catch (e) {
      setMessage(
        describeError(e, 'The folder did not save. Check that Remy is running, then try again.'),
      );
      setState('failed');
    }
  };

  const status =
    state === 'saving'
      ? 'Saving the folder'
      : state === 'saved'
        ? 'The folder is saved. New tasks use it.'
        : state === 'cleared'
          ? 'The folder is cleared. Each new task gets its own empty folder.'
          : state === 'failed'
            ? message
            : locked && info?.path
              ? `In use: ${info.path}`
              : '';

  return (
    <Row title="Folder Remy may use" help={FOLDER_HELP}>
      {!info ? (
        <p className="m-0 max-w-[520px] text-[14px] leading-relaxed text-muted">
          This server does not offer a folder setting yet.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor={id} className="sr-only">
              Folder path
            </label>
            <input
              id={id}
              type="text"
              spellCheck={false}
              autoComplete="off"
              placeholder="/Users/you/Documents/Projects"
              value={locked ? (info.path ?? '') : shown}
              readOnly={locked}
              aria-describedby={`${id}-note`}
              onChange={(e) => {
                setDraft(e.target.value);
                setState('idle');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !locked && shown.trim()) void write(shown.trim());
              }}
              className={`${field} w-full max-w-[420px] font-mono text-[13px]`}
            />
            {!locked && (
              <>
                <button
                  type="button"
                  className={buttonQuiet}
                  disabled={state === 'saving' || shown.trim() === '' || shown.trim() === saved}
                  onClick={() => void write(shown.trim())}
                >
                  Save the folder
                </button>
                <button
                  type="button"
                  className={buttonQuiet}
                  disabled={state === 'saving' || (saved === '' && shown === '')}
                  onClick={() => {
                    setDraft(null);
                    void write(null);
                  }}
                >
                  Clear
                </button>
              </>
            )}
          </div>
          {locked && (
            <p className="mt-3 mb-0 max-w-[560px] text-[13px] text-muted">{FOLDER_FLAG}</p>
          )}
          <p
            id={`${id}-note`}
            role="status"
            className="mt-3 mb-0 flex max-w-[560px] items-center gap-2 text-[13px] text-muted"
          >
            {(state === 'saved' || state === 'cleared') && (
              <Icon name="check" className="shrink-0 text-signal" />
            )}
            {status}
          </p>
        </>
      )}
    </Row>
  );
}
