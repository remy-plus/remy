// "Your dock": which places the floating dock shows, and in what order, plus the layout choice.
// The `dock` setting is the ordered list of shown ids (the Dock reads it live); Chat and Settings stay.
import { DOCK_ITEMS, dockItems } from '../../components/Dock.tsx';
import { buttonQuiet } from '../../components/ui.ts';
import { DEFAULTS, resetSetting, useSetting } from '../../settings.ts';
import { Row, Segmented, Switch } from './controls.tsx';

const LOCKED = ['chat', 'settings'];

const LAYOUTS = [
  { value: 'simple', label: 'Simple' },
  { value: 'command', label: 'Command center', disabled: true },
] as const;

/** The ids in the order the dock shows them, always including Chat and Settings. */
export const shownIds = (saved: readonly string[]) => dockItems(saved).map((d) => d.id);

/** `ids` with `id` moved one place up (-1) or down (1); the list as it was at an end. */
export function moved(ids: readonly string[], id: string, by: -1 | 1): string[] {
  const from = ids.indexOf(id);
  const to = from + by;
  if (from < 0 || to < 0 || to >= ids.length) return [...ids];
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

const move = `${buttonQuiet} px-3 disabled:cursor-default disabled:opacity-40`;

export function DockSection() {
  const [saved, setSaved] = useSetting('dock');
  const [layout, setLayout] = useSetting('layout');
  const shown = shownIds(saved.length ? saved : DEFAULTS.dock);
  const hidden = DOCK_ITEMS.filter((d) => !shown.includes(d.id));
  const rows = [...shown.map((id) => DOCK_ITEMS.find((d) => d.id === id)), ...hidden].filter(
    (d) => d !== undefined,
  );
  const isDefault = saved.join() === DEFAULTS.dock.join();

  return (
    <>
      <Row title="Places in the dock" help="Choose what shows at the top and in what order.">
        <ul className="m-0 max-w-[520px] p-0">
          {rows.map((item) => {
            const on = shown.includes(item.id);
            const at = shown.indexOf(item.id);
            const locked = LOCKED.includes(item.id);
            return (
              <li
                key={item.id}
                className="flex list-none flex-wrap items-center gap-x-4 gap-y-2 border-b border-edge py-3 first:pt-0 last:border-b-0"
              >
                <span className={`min-w-[110px] text-[15px] ${on ? '' : 'text-muted'}`}>
                  {item.label}
                </span>
                <span className="flex items-center gap-2">
                  <Switch
                    label={`Show ${item.label}`}
                    checked={on}
                    disabled={locked}
                    onChange={(v) =>
                      setSaved(v ? [...shown, item.id] : shown.filter((id) => id !== item.id))
                    }
                  />
                  {locked && <span className="text-[13px] text-muted">Always here</span>}
                </span>
                <span className="ml-auto flex gap-2">
                  <button
                    type="button"
                    aria-label={`Move ${item.label} up`}
                    disabled={!on || at === 0}
                    onClick={() => setSaved(moved(shown, item.id, -1))}
                    className={move}
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${item.label} down`}
                    disabled={!on || at === shown.length - 1}
                    onClick={() => setSaved(moved(shown, item.id, 1))}
                    className={move}
                  >
                    Move down
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
        <div className="mt-4">
          <button
            type="button"
            disabled={isDefault}
            onClick={() => resetSetting('dock')}
            className={`${buttonQuiet} disabled:cursor-default disabled:opacity-40`}
          >
            Reset to default
          </button>
        </div>
      </Row>
      <Row title="Layout" help="How much is on the screen at once.">
        <Segmented
          label="Layout"
          value={layout}
          options={[...LAYOUTS]}
          onChange={(v) => setLayout(v)}
        />
        <p className="mt-3 mb-0 max-w-[500px] text-[13px] leading-relaxed text-muted">
          Simple is chat and a quiet dock. Command center adds a live view of what Remy is doing.
          Command center: coming soon.
        </p>
      </Row>
      <Row title="Colours">
        <p className="m-0 text-[15px] text-muted">Dark only for now.</p>
      </Row>
    </>
  );
}
