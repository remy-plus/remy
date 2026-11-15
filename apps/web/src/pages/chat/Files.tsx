// The files a finished task wrote, as small chips under its answer. Saving goes through the API
// (the server wants the sign-in token, which a plain link cannot send), then hands the browser the bytes.
import { useEffect, useState } from 'react';
import { type TaskFile, useApi } from '../../api/index.tsx';
import { Icon } from '../../components/Icon.tsx';
import { describeError } from '../../lib/errors.ts';
import { fileSize } from '../../lib/size.ts';

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function Files({ taskId }: { taskId: string }) {
  const api = useApi();
  const [files, setFiles] = useState<TaskFile[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api
      .taskFiles(taskId)
      .then((f) => live && setFiles(f))
      .catch(() => {}); // no list is no chips; the answer still says what Remy made
    return () => {
      live = false;
    };
  }, [api, taskId]);
  if (files.length === 0) return null;

  const download = async (f: TaskFile) => {
    setBusy(f.path);
    setProblem(null);
    try {
      const { blob, name } = await api.downloadTaskFile(taskId, f.path);
      save(blob, name);
    } catch (e) {
      setProblem(describeError(e, `Remy could not get ${f.name}. Try again.`));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-2">
      <ul aria-label="Files Remy made" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
        {files.map((f) => (
          <li key={f.path} className="max-w-full min-w-0">
            <button
              type="button"
              disabled={busy === f.path}
              onClick={() => void download(f)}
              title={f.path}
              aria-label={`Download ${f.name}, ${fileSize(f.size)}`}
              className="inline-flex max-w-full cursor-pointer items-center gap-2 rounded-[18px] border border-edge-hi bg-surface py-1 pr-3 pl-3 text-left text-[13px] leading-[1.6] text-text transition-colors duration-300 hover:border-stone disabled:cursor-default disabled:opacity-60"
            >
              <Icon name="download" size={14} className="shrink-0 text-muted" />
              <span className="min-w-0 break-all">{f.name}</span>
              <span className="shrink-0 text-muted">{fileSize(f.size)}</span>
            </button>
          </li>
        ))}
      </ul>
      {problem && (
        <p role="alert" className="mt-1.5 mb-0 text-[13px] text-muted">
          {problem}
        </p>
      )}
    </div>
  );
}
