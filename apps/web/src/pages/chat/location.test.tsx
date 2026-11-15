import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/index.tsx';
import { createMockApi } from '../../api/mock.ts';
import type { LocationState, RemyApi } from '../../api/types.ts';
import { LOCATION_NOTICE } from '../../lib/location.ts';
import { Chat } from './Chat.tsx';

let geo: { getCurrentPosition: ReturnType<typeof vi.fn> };
let permission: 'prompt' | 'granted' | 'denied';

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  window.location.hash = '';
  permission = 'prompt';
  geo = {
    getCurrentPosition: vi.fn((ok: PositionCallback) =>
      ok({ coords: { latitude: 39.952583, longitude: -75.165222 } } as GeolocationPosition),
    ),
  };
  Object.defineProperty(navigator, 'geolocation', { value: geo, configurable: true });
  Object.defineProperty(navigator, 'permissions', {
    value: { query: async () => ({ state: permission }) },
    configurable: true,
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true });
  Object.defineProperty(navigator, 'permissions', { value: undefined, configurable: true });
});

function setup(state: LocationState = { place: null, setAt: null, declined: false }) {
  const base = createMockApi();
  const order: string[] = [];
  const api: RemyApi = {
    ...base,
    location: vi.fn(async () => state),
    setLocation: vi.fn(async (lat: number, lon: number) => {
      order.push('setLocation');
      return {
        place: `near ${lat}, ${lon}`,
        setAt: '2026-11-14T12:00:00.000Z',
        declined: false,
      };
    }),
    declineLocation: vi.fn(async () => {
      order.push('declineLocation');
      return { place: null, setAt: null, declined: true };
    }),
    sendMessage: vi.fn(async () => {
      order.push('sendMessage');
      return { chatId: 'chat_1', taskId: 'task_1' };
    }),
  };
  render(
    <ApiProvider api={api}>
      <Chat />
    </ApiProvider>,
  );
  const say = async (text: string) => {
    fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
  };
  return { api, order, say };
}

describe('asking for a location in the chat', () => {
  it('asks the browser for a nearby message, saves the rounded point, then sends the message', async () => {
    const { api, order, say } = setup();
    await say('look for ramen spots nearby');
    await waitFor(() =>
      expect(api.sendMessage).toHaveBeenCalledWith('look for ramen spots nearby', undefined),
    );
    expect(api.setLocation).toHaveBeenCalledWith(39.95, -75.17);
    expect(order).toEqual(['setLocation', 'sendMessage']);
    const opts = geo.getCurrentPosition.mock.calls[0]?.[2];
    expect(opts).toMatchObject({ enableHighAccuracy: false });
  });

  it('shows the plain line while the browser question is open', async () => {
    let answer: PositionCallback = () => {};
    geo.getCurrentPosition.mockImplementation((ok: PositionCallback) => {
      answer = ok;
    });
    const { api, say } = setup();
    await say('ramen near me');
    expect(await screen.findByText(LOCATION_NOTICE)).toBeTruthy();
    expect(api.sendMessage).not.toHaveBeenCalled();
    answer({ coords: { latitude: 1, longitude: 2 } } as GeolocationPosition);
    await waitFor(() => expect(api.sendMessage).toHaveBeenCalled());
    expect(screen.queryByText(LOCATION_NOTICE)).toBeNull();
  });

  it('does not ask for a message that has no need of a place', async () => {
    const { api, say } = setup();
    await say('what should I make for dinner');
    await waitFor(() => expect(api.sendMessage).toHaveBeenCalled());
    expect(api.location).not.toHaveBeenCalled();
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
  });

  it('does not ask again when a place is already kept', async () => {
    const { api, say } = setup({
      place: 'Philadelphia, Pennsylvania, US',
      setAt: '2026-11-12T10:00:00.000Z',
      declined: false,
    });
    await say('ramen nearby');
    await waitFor(() => expect(api.sendMessage).toHaveBeenCalled());
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    expect(api.setLocation).not.toHaveBeenCalled();
  });

  it('never asks after a refusal the server remembers', async () => {
    const { api, say } = setup({ place: null, setAt: null, declined: true });
    await say('ramen nearby');
    await waitFor(() => expect(api.sendMessage).toHaveBeenCalled());
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
  });

  it('records a refusal, sends the message anyway, and does not show the line again', async () => {
    geo.getCurrentPosition.mockImplementation((_ok: PositionCallback, err: PositionErrorCallback) =>
      err({ code: 1 } as GeolocationPositionError),
    );
    const { api, order, say } = setup();
    await say('ramen nearby');
    await waitFor(() => expect(api.sendMessage).toHaveBeenCalled());
    expect(order).toEqual(['declineLocation', 'sendMessage']);
    expect(api.setLocation).not.toHaveBeenCalled();
  });

  it('treats a browser that already says no as a refusal without asking it', async () => {
    permission = 'denied';
    const { api, order, say } = setup();
    await say('ramen nearby');
    await waitFor(() => expect(api.sendMessage).toHaveBeenCalled());
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    expect(order).toEqual(['declineLocation', 'sendMessage']);
  });

  it('shows no line when the browser already allowed it', async () => {
    permission = 'granted';
    let answer: PositionCallback = () => {};
    geo.getCurrentPosition.mockImplementation((ok: PositionCallback) => {
      answer = ok;
    });
    const { api, say } = setup();
    await say('ramen nearby');
    await waitFor(() => expect(geo.getCurrentPosition).toHaveBeenCalled());
    expect(screen.queryByText(LOCATION_NOTICE)).toBeNull();
    answer({ coords: { latitude: 1, longitude: 2 } } as GeolocationPosition);
    await waitFor(() => expect(api.sendMessage).toHaveBeenCalled());
  });

  it('sends the message without a place when the browser cannot find one, and is not marked refused', async () => {
    geo.getCurrentPosition.mockImplementation((_ok: PositionCallback, err: PositionErrorCallback) =>
      err({ code: 2 } as GeolocationPositionError),
    );
    const { api, say } = setup();
    await say('ramen nearby');
    await waitFor(() => expect(api.sendMessage).toHaveBeenCalled());
    expect(api.declineLocation).not.toHaveBeenCalled();
  });

  it('asks only once in a visit, even for a second nearby message', async () => {
    geo.getCurrentPosition.mockImplementation((_ok: PositionCallback, err: PositionErrorCallback) =>
      err({ code: 2 } as GeolocationPositionError),
    );
    const { api, say } = setup();
    await say('ramen nearby');
    await waitFor(() => expect(api.sendMessage).toHaveBeenCalledTimes(1));
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
  });
});
