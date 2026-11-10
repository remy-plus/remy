import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../App.tsx';
import { a11yProblems } from '../../a11y.testing.ts';
import { ApiProvider } from '../../api/index.tsx';
import { createMockApi } from '../../api/mock.ts';

afterEach(() => {
  window.location.hash = '';
});

const open = async (section: string, heading: string) => {
  window.location.hash = `#/settings/${section}`;
  const view = render(
    <ApiProvider api={createMockApi()}>
      <App />
    </ApiProvider>,
  );
  await screen.findByRole('heading', { level: 2, name: heading });
  return view;
};
const stored = (key: string) => window.localStorage.getItem(`remy.${key}`);

describe('Settings', () => {
  it('lists the eight sections as links and marks the open one', async () => {
    await open('trust', 'Trust and approvals');
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(
      ['trust', 'model', 'budget', 'memory', 'notifications', 'appearance', 'server', 'about'].map(
        (s) => `#/settings/${s}`,
      ),
    );
    expect(links.filter((a) => a.getAttribute('aria-current')).map((a) => a.textContent)).toEqual([
      'Trust and approvals',
    ]);
  });

  it('shows trust by default at #/settings', async () => {
    window.location.hash = '#/settings';
    render(
      <ApiProvider api={createMockApi()}>
        <App />
      </ApiProvider>,
    );
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Trust and approvals' }),
    ).toBeTruthy();
  });

  it('changes the trust level in a radiogroup and keeps it', async () => {
    await open('trust', 'Trust and approvals');
    const group = screen.getByRole('radiogroup', { name: 'Trust level' });
    const radios = within(group).getAllByRole('radio') as HTMLInputElement[];
    expect(radios.map((r) => r.value)).toEqual(['ask', 'steady', 'away']);
    expect(radios[0]?.checked).toBe(true);
    fireEvent.click(within(group).getByRole('radio', { name: 'Handle routine things' }));
    expect(
      (within(group).getByRole('radio', { name: 'Handle routine things' }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(stored('trust')).toBe('"steady"');
    expect(screen.getByText(/like reading and editing files/)).toBeTruthy();
  });

  it('toggles switches and stores them', async () => {
    await open('trust', 'Trust and approvals');
    const remember = screen.getByRole('switch', { name: 'Learn from corrections and routines' });
    expect(remember.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(remember);
    expect(remember.getAttribute('aria-checked')).toBe('false');
    expect(stored('memory')).toBe('false');
    const quiet = screen.getByRole('switch', { name: 'Only interrupt for approvals' });
    fireEvent.click(quiet);
    expect(stored('quiet')).toBe('true');
  });

  it('edits the monthly cap and the per-task stop', async () => {
    await open('budget', 'Spending');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Monthly budget' }), {
      target: { value: '35' },
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Stop a job at' }), {
      target: { value: '3.5' },
    });
    expect(stored('budget.month')).toBe('35');
    expect(stored('budget.task')).toBe('3.5');
    expect(screen.getByText('Per job, Remy stops and asks at $3.50.')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('19');
  });

  it('shows amounts in the chosen currency and keeps them in dollars underneath', async () => {
    await open('budget', 'Spending');
    fireEvent.change(screen.getByRole('textbox', { name: 'Currency code' }), {
      target: { value: 'GBP' },
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: /one US dollar/ }), {
      target: { value: '0.5' },
    });
    expect(stored('currency.code')).toBe('"GBP"');
    expect(stored('currency.rate')).toBe('0.5');
    // 2 USD per job at 0.5 GBP per dollar is 1.00 pound.
    expect(screen.getByText('Per job, Remy stops and asks at £1.00.')).toBeTruthy();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Stop a job at' }), {
      target: { value: '3' },
    });
    expect(stored('budget.task')).toBe('6'); // 3 pounds is 6 dollars
    fireEvent.change(screen.getByRole('textbox', { name: 'Currency code' }), {
      target: { value: 'G1B' },
    });
    expect(stored('currency.code')).toBe('"GBP"'); // malformed, so nothing is saved
  });

  it('lists Light as not available and keeps Dark chosen', async () => {
    await open('appearance', 'Appearance');
    const group = screen.getByRole('radiogroup', { name: 'Appearance' });
    expect((within(group).getByRole('radio', { name: 'Dark' }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect((within(group).getByRole('radio', { name: 'Light' }) as HTMLInputElement).disabled).toBe(
      true,
    );
    expect(screen.getByText('Light: not available yet.')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Only interrupt for approvals' })).toBeTruthy();
  });

  it('shows providers and tests the models', async () => {
    await open('model', 'Model and keys');
    expect(screen.getByRole('button', { name: 'Replace key' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Add a key' })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'Add a key' })[0] as HTMLElement);
    expect(screen.getByText(/never holds your keys/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use this instead' }));
    expect(screen.getByText('Running · in use')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Test both models' }));
    expect(await screen.findByText('Both models answered.')).toBeTruthy();
  });

  it('has quiet hours and an always-on approvals switch', async () => {
    await open('notifications', 'Notifications');
    const push = screen.getByRole('switch', {
      name: 'Phone and desktop push',
    }) as HTMLButtonElement;
    expect(push.disabled).toBe(true);
    expect(push.getAttribute('aria-checked')).toBe('true');
    fireEvent.change(screen.getByLabelText('Quiet hours start'), { target: { value: '22:30' } });
    expect(stored('quiet.from')).toBe('"22:30"');
    fireEvent.click(screen.getByRole('button', { name: 'Send a test notification' }));
    expect(await screen.findByText('A test notification was sent.')).toBeTruthy();
  });

  it('asks before deleting notes and names how many', async () => {
    await open('memory', 'Memory and privacy');
    fireEvent.click(screen.getByRole('button', { name: 'Delete all notes' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete 1,204 notes?' });
    expect(within(dialog).getByRole('button', { name: 'Delete 1,204 notes' })).toBeTruthy();
    // Keeping them closes the dialog and deletes nothing.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep my notes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('1,204 notes on this machine.')).toBeTruthy();
    // Escape also cancels.
    fireEvent.click(screen.getByRole('button', { name: 'Delete all notes' }));
    fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // Confirming deletes.
    fireEvent.click(screen.getByRole('button', { name: 'Delete all notes' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete 1,204 notes' }));
    expect(await screen.findByText('Deleted 1,204 notes.')).toBeTruthy();
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Delete all notes' }) as HTMLButtonElement).disabled,
      ).toBe(true),
    );
  });

  it('confirms before making a new token and shows it once', async () => {
    await open('server', 'Home server');
    expect(screen.getByText('remy.home.example.test')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Make a new token' }));
    const dialog = await screen.findByRole('dialog', { name: 'Make a new token?' });
    expect(screen.queryByText('mock-token-for-a-demo-only')).toBeNull();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Make a new token' }));
    });
    expect(await screen.findByText('mock-token-for-a-demo-only')).toBeTruthy();
  });

  it('shows the version, licences and data folder', async () => {
    await open('about', 'About');
    expect(screen.getByText('~/.remy')).toBeTruthy();
    expect(screen.getByText('Licences')).toBeTruthy();
  });

  it('says so for a section that does not exist', async () => {
    window.location.hash = '#/settings/nope';
    render(
      <ApiProvider api={createMockApi()}>
        <App />
      </ApiProvider>,
    );
    expect(await screen.findByText('There is no such section.')).toBeTruthy();
  });

  for (const [section, heading] of [
    ['trust', 'Trust and approvals'],
    ['model', 'Model and keys'],
    ['budget', 'Spending'],
    ['memory', 'Memory and privacy'],
    ['notifications', 'Notifications'],
    ['appearance', 'Appearance'],
    ['server', 'Home server'],
    ['about', 'About'],
  ] as const) {
    it(`has no basic accessibility problems in ${section}`, async () => {
      await open(section, heading);
      expect(a11yProblems()).toEqual([]);
    });
  }
});
