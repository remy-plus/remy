import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom has no canvas; without this it logs a "not implemented" error for every Orb.
HTMLCanvasElement.prototype.getContext = () => null;

afterEach(cleanup);

// jsdom has no <dialog> methods. This is enough for tests: open state and the close event.
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}
