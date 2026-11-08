import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom has no canvas; without this it logs a "not implemented" error for every Orb.
HTMLCanvasElement.prototype.getContext = () => null;

afterEach(cleanup);
