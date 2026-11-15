// The chat tells the rest of the app when a turn starts or ends, so the dock does not have to ask
// the server every few seconds whether Remy is still working.
const NAME = 'remy:chats-changed';

export const announceChatsChanged = () => window.dispatchEvent(new Event(NAME));

/** Runs `fn` whenever a chat changed. Returns the way to stop. */
export function onChatsChanged(fn: () => void): () => void {
  window.addEventListener(NAME, fn);
  return () => window.removeEventListener(NAME, fn);
}
