import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

// jsdom has no canvas; without this it logs a "not implemented" error for every Orb.
HTMLCanvasElement.prototype.getContext = () => null;

// jsdom has no modal dialog. This is enough for the tests: `open` is set and `close` fires its event.
const dialog = HTMLDialogElement.prototype;
if (!dialog.showModal) {
  dialog.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  dialog.show = dialog.showModal;
  dialog.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}

// Tests run on the mock, as a demo link does. Only `?mock=1` picks the mock; the sign-in tests
// clear it on purpose. A visit that is not the first keeps Home out of the first-run steps.
beforeEach(() => {
  window.history.replaceState({}, '', '/?mock=1');
  window.localStorage.setItem('remy.onboarded', 'true');
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});
