import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App.tsx';
import { ApiProvider } from '../../api/index.tsx';
import { createMockApi } from '../../api/mock.ts';
import type { LocationState, RemyApi } from '../../api/types.ts';
import { bindServerSettings } from '../../settings.ts';
import { LOCATION_DENIED, LOCATION_HELP } from './location.tsx';

const SET: LocationState = {
  place: 'Philadelphia, Pennsylvania, US',
  setAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  declined: false,
};

let geo: { getCurrentPosition: ReturnType<typeof vi.fn> };
beforeEach(() => {
  geo = {
    getCurrentPosition: vi.fn((ok: PositionCallback) =>
      ok({ coords: { latitude: 39.952583, longitude: -75.165222 } } as GeolocationPosition),
    ),
  };
  Object.defineProperty(navigator, 'geolocation', { value: geo, configurable: true });
});
afterEach(() => {
  window.location.hash = '';
  bindServerSettings(null);
  Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true });
  Object.defineProperty(navigator, 'permissions', { value: undefined, configurable: true });
});

const open = async (over: Partial<RemyApi> = {}) => {
  const api: RemyApi = { ...createMockApi(), ...over };
  window.location.hash = '#/settings/location';
  render(
    <ApiProvider api={api}>
      <App />
    </ApiProvider>,
  );
  await screen.findByRole('heading', { level: 2, name: 'Location' });
  return api;
};

describe('Settings > Location', () => {
  it('explains what is kept and where', async () => {
    await open({ location: async () => SET });
    expect(await screen.findByText(LOCATION_HELP)).toBeTruthy();
  });

  it('shows the place and when it was set, with Update and Turn off', async () => {
    await open({ location: async () => SET });
    expect(await screen.findByText('Philadelphia, Pennsylvania, US')).toBeTruthy();
    expect(screen.getByText(/Approximate, set /)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Update' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Turn off' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Turn on location' })).toBeNull();
  });

  it('turns it off through the API, which deletes the place', async () => {
    const clearLocation = vi.fn(async () => ({ place: null, setAt: null, declined: true }));
    await open({ location: async () => SET, clearLocation });
    fireEvent.click(await screen.findByRole('button', { name: 'Turn off' }));
    await waitFor(() => expect(clearLocation).toHaveBeenCalled());
    expect(await screen.findByText('Location is off and what was saved is deleted.')).toBeTruthy();
    expect(screen.queryByText('Philadelphia, Pennsylvania, US')).toBeNull();
    expect(screen.getByRole('button', { name: 'Turn on location' })).toBeTruthy();
  });

  it('updates the place with a fresh rounded position', async () => {
    const setLocation = vi.fn(async () => ({ ...SET, place: 'Camden, New Jersey, US' }));
    await open({ location: async () => SET, setLocation });
    fireEvent.click(await screen.findByRole('button', { name: 'Update' }));
    await waitFor(() => expect(setLocation).toHaveBeenCalledWith(39.95, -75.17));
    expect(await screen.findByText('Camden, New Jersey, US')).toBeTruthy();
  });

  it('turns it on from nothing, even after a refusal in the chat', async () => {
    const setLocation = vi.fn(async () => SET);
    await open({
      location: async () => ({ place: null, setAt: null, declined: true }),
      setLocation,
    });
    expect(await screen.findByText(/Location is off/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on location' }));
    await waitFor(() => expect(setLocation).toHaveBeenCalledWith(39.95, -75.17));
    expect(await screen.findByText('Philadelphia, Pennsylvania, US')).toBeTruthy();
  });

  it('says what to do when the browser refuses', async () => {
    geo.getCurrentPosition.mockImplementation((_ok: PositionCallback, err: PositionErrorCallback) =>
      err({ code: 1 } as GeolocationPositionError),
    );
    const setLocation = vi.fn();
    await open({
      location: async () => ({ place: null, setAt: null, declined: false }),
      setLocation,
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on location' }));
    expect(await screen.findByText(LOCATION_DENIED)).toBeTruthy();
    expect(setLocation).not.toHaveBeenCalled();
  });

  it('says so when the server cannot be read, with a way to try again', async () => {
    let calls = 0;
    await open({
      location: async () => {
        if (calls++ === 0) throw new Error('down');
        return SET;
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Philadelphia, Pennsylvania, US')).toBeTruthy();
  });

  it('says so on a server that has no location setting', async () => {
    await open({ location: undefined } as unknown as Partial<RemyApi>);
    expect(await screen.findByText(/does not offer a location setting/)).toBeTruthy();
  });
});
