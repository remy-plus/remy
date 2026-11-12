import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App.tsx';
import { ApiProvider } from '../../api/index.tsx';
import { createMockApi } from '../../api/mock.ts';
import type { RemyApi } from '../../api/types.ts';
import { bindServerSettings } from '../../settings.ts';
import { SEARCH_TRUST } from './search.tsx';

afterEach(() => {
  window.location.hash = '';
  bindServerSettings(null);
});

const open = async (api: RemyApi = createMockApi()) => {
  window.location.hash = '#/settings/search';
  render(
    <ApiProvider api={api}>
      <App />
    </ApiProvider>,
  );
  await screen.findByRole('heading', { level: 2, name: 'Search and browsing' });
  await screen.findByText(/Exa answers searches/);
};

describe('Search and browsing', () => {
  it('says which service answers and why, and the trust note', async () => {
    await open();
    expect(
      screen.getByText("Exa answers searches. Its key is in this Mac's Keychain."),
    ).toBeTruthy();
    expect(screen.getByText(SEARCH_TRUST)).toBeTruthy();
  });

  it('offers Automatic and only the services with a key', async () => {
    await open();
    const radios = screen.getAllByRole('radio').map((r) => r.closest('label')?.textContent);
    expect(radios).toHaveLength(2);
    expect(radios[0]).toContain('Automatic');
    expect(radios[1]).toContain('Exa');
  });

  it('saves a change of choice through the API', async () => {
    const base = createMockApi();
    const setSearchPrefer = vi.fn(base.setSearchPrefer?.bind(base));
    await open({ ...base, setSearchPrefer });
    fireEvent.click(screen.getByRole('radio', { name: /Exa/ }));
    await waitFor(() => expect(setSearchPrefer).toHaveBeenCalledWith('exa'));
    expect(await screen.findByText('Saved. New searches use this.')).toBeTruthy();
  });

  it('tests a service and shows the time and titles', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Test Exa' }));
    expect(await screen.findByText('Exa answered in 1.3 s.')).toBeTruthy();
    expect(screen.getByText('Node.js releases')).toBeTruthy();
  });

  it('shows a plain error when the test fails', async () => {
    const base = createMockApi();
    await open({
      ...base,
      testSearchService: async () => ({
        ok: false,
        ms: 200,
        titles: [],
        error: 'Exa rejected the key.',
      }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Test Exa' }));
    expect(await screen.findByText('Exa rejected the key.')).toBeTruthy();
  });

  it('shows the command for a service with no key, and no Test button', async () => {
    await open();
    const tavily = screen.getByRole('heading', { name: 'Tavily' }).closest('li') as HTMLElement;
    expect(within(tavily).getByText('remy search key tavily')).toBeTruthy();
    expect(within(tavily).queryByRole('button', { name: /^Test/ })).toBeNull();
    expect(
      within(tavily).getByRole('button', { name: 'Copy the command to add Tavily key' }),
    ).toBeTruthy();
  });

  it('shows readers and remote browsers in their own groups', async () => {
    await open();
    expect(screen.getByRole('region', { name: 'Page readers' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Remote browsers' })).toBeTruthy();
    expect(screen.getByText(/A browser in the cloud/)).toBeTruthy();
  });

  it('says so when the server cannot report search', async () => {
    const { searchStatus: _s, ...rest } = createMockApi();
    await open2(rest);
  });
});

async function open2(api: RemyApi) {
  window.location.hash = '#/settings/search';
  render(
    <ApiProvider api={api}>
      <App />
    </ApiProvider>,
  );
  expect(await screen.findByText(/does not report how it searches/)).toBeTruthy();
}
