// The /connections panel as a small state machine: the server list, then what to do with one
// server, then (for remove) a confirmation. The drawing lives in the dialog and the minimal picker.
import { useState } from 'react';
import {
  type ConnectionRow,
  type ConnectionsApi,
  connectionActions,
  connectionItems,
} from './connections-view.ts';
import type { PickItem } from './picker.ts';

export type Stage =
  | { kind: 'list' }
  | { kind: 'actions'; name: string }
  | { kind: 'confirm'; name: string };

export type Effect =
  | { type: 'enable' | 'disable' | 'remove' | 'unallow'; name: string }
  | { type: 'close' };

/** A pick (or Esc, as `back`) moves between stages and may ask for a change. */
export function stepConnections(
  stage: Stage,
  pick: string | 'back',
  rows: ConnectionRow[],
): { stage: Stage; effect?: Effect } {
  const list: Stage = { kind: 'list' };
  if (pick === 'back')
    return stage.kind === 'list' ? { stage, effect: { type: 'close' } } : { stage: list };
  if (stage.kind === 'list')
    return rows.some((r) => r.name === pick)
      ? { stage: { kind: 'actions', name: pick } }
      : { stage };
  if (stage.kind === 'actions') {
    if (pick === '#disable') return { stage: list, effect: { type: 'disable', name: stage.name } };
    if (pick === '#enable') return { stage: list, effect: { type: 'enable', name: stage.name } };
    if (pick.startsWith('#unallow:'))
      return { stage, effect: { type: 'unallow', name: pick.slice('#unallow:'.length) } };
    if (pick === '#remove') return { stage: { kind: 'confirm', name: stage.name } };
    return { stage: pick === '#back' ? list : stage };
  }
  if (pick === '#yes') return { stage: list, effect: { type: 'remove', name: stage.name } };
  return { stage: list };
}

export interface ConnectionsView {
  title: string;
  items: PickItem[];
  placeholder: string;
  pick(id: string): void;
  back(): void;
}

/** What to draw for a stage. */
export function viewOf(
  stage: Stage,
  rows: ConnectionRow[],
  allowed: string[] = [],
): Omit<ConnectionsView, 'pick' | 'back'> {
  if (stage.kind === 'list')
    return {
      title: 'Connections',
      items: connectionItems(rows),
      placeholder: 'Search connections',
    };
  const row = rows.find((r) => r.name === stage.name);
  if (stage.kind === 'confirm')
    return {
      title: `Remove ${stage.name}?`,
      placeholder: '',
      items: [
        { id: '#yes', title: `Yes, remove ${stage.name}`, detail: 'its saved secrets go too' },
        { id: '#no', title: 'Keep it' },
      ],
    };
  return {
    title: stage.name,
    placeholder: '',
    items: row ? connectionActions(row, allowed) : [{ id: '#back', title: 'Back' }],
  };
}

/** Panel state for a component: the api is the chat's wrapped one, which notes each change. */
export function useConnections(api: ConnectionsApi, onClose: () => void): ConnectionsView {
  const [stage, setStage] = useState<Stage>({ kind: 'list' });
  const step = (pick: string) => {
    const r = stepConnections(stage, pick, api.list());
    if (r.effect?.type === 'close') return onClose();
    if (r.effect?.type === 'unallow') api.unallow?.(r.effect.name);
    else if (r.effect?.type === 'remove') api.remove(r.effect.name);
    else if (r.effect) api.setEnabled(r.effect.name, r.effect.type === 'enable');
    // A fresh object, so the actions list redraws without the tool just removed.
    setStage(r.effect?.type === 'unallow' ? { ...r.stage } : r.stage);
  };
  const allowed = stage.kind === 'actions' ? (api.allowed?.(stage.name) ?? []) : [];
  return { ...viewOf(stage, api.list(), allowed), pick: step, back: () => step('back') };
}
