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

// A visit that is not the first, so Home does not send tests to the first-run steps.
// The first-run tests remove this flag on purpose.
beforeEach(() => {
  window.localStorage.setItem('remy.onboarded', 'true');
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});
