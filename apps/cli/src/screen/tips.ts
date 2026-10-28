// Short, true tips for the home screen. Each names a key or command that exists today.
export const TIPS: string[] = [
  'Ctrl+P opens the command palette',
  'Type / to see every command',
  'Type @ to attach a file from this folder',
  '/model switches the model without losing the conversation',
  '/sessions picks up an unfinished task',
  'Ctrl+O shows the full transcript',
  'Esc clears what you have typed',
  'Ctrl+C stops the current task',
  '/login connects a provider or replaces a key',
  '/new starts a fresh conversation',
];

/** A tip for a seed (a number, such as the day or a session count); stable for the same seed. */
export function pickTip(seed: number): string {
  const i = Math.abs(Math.trunc(seed)) % TIPS.length;
  return TIPS[i] as string;
}
