import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../App.tsx';
import { a11yProblems } from '../../a11y.testing.ts';
import { ApiProvider } from '../../api/index.tsx';
import { createMockApi } from '../../api/mock.ts';
import type { RemyApi } from '../../api/types.ts';
import { bindServerSettings } from '../../settings.ts';

afterEach(() => {
  window.location.hash = '';
  bindServerSettings(null); // a test that binds a server must not leak into the next one
});

const open = async (section: string, heading: string, api: RemyApi = createMockApi()) => {
  window.location.hash = `#/settings/${section}`;
  const view = render(
    <ApiProvider api={api}>
      <App />
    </ApiProvider>,
  );
  await screen.findByRole('heading', { level: 2, name: heading });
  return view;
};
const stored = (key: string) => window.localStorage.getItem(`remy.${key}`);

const order = () =>
  screen.getAllByRole('switch', { name: /^Show / }).map((s) => s.getAttribute('aria-label'));
const savedDock = () => JSON.parse(stored('dock') ?? 'null');

/** The error a real adapter throws: a status and no words of its own. */
const failed = (status: number) => Object.assign(new Error(''), { status });

/** A mock whose settings cannot be read, with the status the server would send. */
const broken = (status: number): RemyApi => ({
  ...createMockApi(),
  settings: () => Promise.reject(failed(status)),
});

/** A mock that fails once, then answers: for the Try again button. */
const onceBroken = (): RemyApi => {
  const base = createMockApi();
  let calls = 0;
  return {
    ...base,
    settings: () => {
      calls += 1;
      return calls === 1 ? Promise.reject(failed(401)) : base.settings();
    },
  };
};

/** A mock whose settings never arrive, so the loading state stays on screen. */
const neverAnswers = (): RemyApi => ({
  ...createMockApi(),
  settings: () => new Promise<never>(() => undefined),
});

/** A mock with one method replaced, for the failures a section has to describe. */
const withMethod = <K extends keyof RemyApi>(key: K, value: RemyApi[K]): RemyApi => ({
  ...createMockApi(),
  [key]: value,
});

beforeEach(() => window.localStorage.clear());

describe('Settings', () => {
  it('lists the seven sections as links and marks the open one', async () => {
    await open('trust', 'How much Remy does on its own');
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(
      ['dock', 'trust', 'budget', 'model', 'memory', 'notifications', 'computer'].map(
        (s) => `#/settings/${s}`,
      ),
    );
    expect(links.filter((a) => a.getAttribute('aria-current')).map((a) => a.textContent)).toEqual([
      'How much Remy does on its own',
    ]);
  });

  it('shows the dock by default at #/settings', async () => {
    window.location.hash = '#/settings';
    render(
      <ApiProvider api={createMockApi()}>
        <App />
      </ApiProvider>,
    );
    expect(await screen.findByRole('heading', { level: 2, name: 'Your dock' })).toBeTruthy();
  });

  it('changes the trust level in a radiogroup and keeps it', async () => {
    await open('trust', 'How much Remy does on its own');
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

  describe('folder Remy may use', () => {
    const FOLDER = '/Users/you/Documents/Projects';
    const withWorkspace = (info: unknown, sent: unknown[] = []): RemyApi => {
      const base = createMockApi();
      return {
        ...base,
        settings: async () => ({ ...(await base.settings()), workspace: info as never }),
        updateSettings: async (p) => {
          sent.push(p);
        },
      };
    };

    it('saves a typed path and says so', async () => {
      const sent: unknown[] = [];
      await open(
        'trust',
        'How much Remy does on its own',
        withWorkspace({ path: null, source: 'task', saved: null }, sent),
      );
      expect(screen.getByText(/Leave empty to give each task its own empty folder/)).toBeTruthy();
      const box = screen.getByRole('textbox', { name: 'Folder path' }) as HTMLInputElement;
      expect(box.placeholder).toBe(FOLDER);
      const save = screen.getByRole('button', { name: 'Save the folder' }) as HTMLButtonElement;
      expect(save.disabled).toBe(true);
      fireEvent.change(box, { target: { value: FOLDER } });
      fireEvent.click(save);
      expect(await screen.findByText('The folder is saved. New tasks use it.')).toBeTruthy();
      expect(sent).toEqual([{ workspace: FOLDER }]);
    });

    it('clears a saved folder', async () => {
      const sent: unknown[] = [];
      await open(
        'trust',
        'How much Remy does on its own',
        withWorkspace({ path: FOLDER, source: 'setting', saved: FOLDER }, sent),
      );
      const box = screen.getByRole('textbox', { name: 'Folder path' }) as HTMLInputElement;
      expect(box.value).toBe(FOLDER);
      fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
      expect(await screen.findByText(/The folder is cleared/)).toBeTruthy();
      expect(sent).toEqual([{ workspace: null }]);
    });

    it('shows the server refusal in its own words', async () => {
      const base = withWorkspace({ path: null, source: 'task', saved: null });
      await open('trust', 'How much Remy does on its own', {
        ...base,
        updateSettings: () =>
          Promise.reject(Object.assign(new Error('That folder does not exist.'), { status: 400 })),
      });
      fireEvent.change(screen.getByRole('textbox', { name: 'Folder path' }), {
        target: { value: '/nope' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save the folder' }));
      expect(await screen.findByText('That folder does not exist.')).toBeTruthy();
    });

    it('is read-only when the server was started with --workspace', async () => {
      await open(
        'trust',
        'How much Remy does on its own',
        withWorkspace({ path: '/flag/dir', source: 'flag', saved: null }),
      );
      const box = screen.getByRole('textbox', { name: 'Folder path' }) as HTMLInputElement;
      expect(box.readOnly).toBe(true);
      expect(box.value).toBe('/flag/dir');
      expect(screen.getByText(/started with --workspace/)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Save the folder' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
    });
  });

  it('toggles switches and stores them', async () => {
    await open('memory', 'Memory and privacy');
    const remember = screen.getByRole('switch', { name: 'Learn from corrections and routines' });
    expect(remember.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(remember);
    expect(remember.getAttribute('aria-checked')).toBe('false');
    expect(stored('memory')).toBe('false');
  });

  it('keeps quiet mode under notifications', async () => {
    await open('notifications', 'Notifications');
    fireEvent.click(screen.getByRole('switch', { name: 'Only interrupt for approvals' }));
    expect(stored('quiet')).toBe('true');
  });

  it('edits the monthly cap and the per-task stop', async () => {
    await open('budget', 'Spending');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Monthly cap' }), {
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

  it('says what happens when the monthly cap is reached', async () => {
    await open('budget', 'Spending');
    // The cap stops new jobs; a job already running keeps its own stop.
    expect(screen.getByText(/new jobs stop/)).toBeTruthy();
    expect(screen.getByText(/keeps its own stop below/)).toBeTruthy();
    expect(screen.getByText(/Remy pauses one job at this amount/)).toBeTruthy();
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

  it('says a budget change landed beside the box, not only at the top', async () => {
    bindServerSettings(async () => undefined);
    await open('budget', 'Spending');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Monthly cap' }), {
      target: { value: '30' },
    });
    expect(await screen.findByText('The monthly cap is saved.')).toBeTruthy();
  });

  it('says a budget change did not save, beside the box', async () => {
    bindServerSettings(async () => {
      throw new Error('the server said no');
    });
    await open('budget', 'Spending');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Stop a job at' }), {
      target: { value: '4' },
    });
    expect(await screen.findByText(/The stop for a job did not save/)).toBeTruthy();
  });

  it('shows providers and tests the models', async () => {
    await open('model', 'Model and keys');
    expect(screen.getByRole('button', { name: 'How to replace the key' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'How to add a key' })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'How to add a key' })[0] as HTMLElement);
    expect(screen.getByText(/never holds your keys|never holds it/)).toBeTruthy();
    expect(screen.getByText('Key saved · in use')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Test both models' }));
    expect(await screen.findByText('Both models answered.')).toBeTruthy();
  });

  it('says where a key goes and that a saved key never comes back', async () => {
    await open('model', 'Model and keys');
    expect(screen.getByText(/never in this browser/)).toBeTruthy();
    expect(screen.getByText(/never shows a saved key again/)).toBeTruthy();
    // A provider with a key says so, instead of looking like nothing is set.
    expect(screen.getByText('Key saved · in use')).toBeTruthy();
    expect(screen.getAllByText('No key yet')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'How to replace the key' }));
    expect(screen.getByText(/It never comes back to this browser/)).toBeTruthy();
    // Nothing here pretends to switch the provider: that is done on the machine that runs Remy.
    expect(screen.queryByRole('button', { name: 'Use this instead' })).toBeNull();
  });

  it('offers a way forward when no provider is set up yet', async () => {
    const base = createMockApi();
    await open('model', 'Model and keys', {
      ...base,
      settings: async () => ({ ...(await base.settings()), providers: [] }),
    });
    expect(await screen.findByText(/No provider is set up yet/)).toBeTruthy();
  });

  it('says what went wrong when the models cannot be tested', async () => {
    await open(
      'model',
      'Model and keys',
      withMethod('testModels', () => Promise.reject(failed(429))),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Test both models' }));
    expect(
      await screen.findByText('Too many requests just now. Wait a moment, then try again.'),
    ).toBeTruthy();
  });

  it('picks the voice and says when there is no voice key', async () => {
    await open('model', 'Model and keys');
    const box = screen.getByRole('textbox', { name: 'Voice id' }) as HTMLInputElement;
    expect(box.value).toBe('e13fa398a7f445a685316a3de6089ce7');
    fireEvent.change(box, { target: { value: 'short' } });
    fireEvent.blur(box);
    expect(screen.getByText(/A voice id is letters and digits/)).toBeTruthy();
    expect(stored('voice.id')).toBeNull(); // nothing is saved
    fireEvent.change(box, { target: { value: 'abcdef0123456789' } });
    fireEvent.blur(box);
    expect(stored('voice.id')).toBe('"abcdef0123456789"');
    fireEvent.click(screen.getByRole('button', { name: 'Use the default voice' }));
    expect(stored('voice.id')).toBe('"e13fa398a7f445a685316a3de6089ce7"');
    expect((screen.getByRole('textbox', { name: 'Voice id' }) as HTMLInputElement).value).toBe(
      'e13fa398a7f445a685316a3de6089ce7',
    );
  });

  it('says a voice change landed beside the voice box', async () => {
    bindServerSettings(async () => undefined);
    await open('model', 'Model and keys');
    const box = screen.getByRole('textbox', { name: 'Voice id' });
    fireEvent.change(box, { target: { value: 'abcdef0123456789' } });
    fireEvent.blur(box);
    expect(await screen.findByText('The voice is saved.')).toBeTruthy();
  });

  it('has quiet hours and an always-on approvals switch', async () => {
    await open('notifications', 'Notifications');
    const push = screen.getByRole('switch', {
      name: 'Phone and desktop push',
    }) as HTMLButtonElement;
    expect(push.disabled).toBe(true);
    expect(push.getAttribute('aria-checked')).toBe('true');
    fireEvent.change(screen.getByLabelText('Quiet hours from'), { target: { value: '22:30' } });
    expect(stored('quiet.from')).toBe('"22:30"');
    fireEvent.click(screen.getByRole('button', { name: 'Send a test notification' }));
    expect(await screen.findByText(/A test notification was sent/)).toBeTruthy();
  });

  it('says quiet hours in plain words, never military time', async () => {
    await open('notifications', 'Notifications');
    expect(screen.getByText(/Quiet from 11:00\s?PM until 7:00\s?AM\./i)).toBeTruthy();
    expect(screen.getByText(/Remy sends it at 7:30\s?AM/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Quiet hours from'), { target: { value: '22:30' } });
    expect(screen.getByText(/Quiet from 10:30\s?PM until 7:00\s?AM\./i)).toBeTruthy();
  });

  it('says what went wrong when the test notification cannot be sent', async () => {
    await open(
      'notifications',
      'Notifications',
      withMethod('sendTestNotification', () => Promise.reject(failed(500))),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send a test notification' }));
    expect(
      await screen.findByText("Remy's server hit a problem. Try again in a moment."),
    ).toBeTruthy();
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
    // Confirming deletes, and the empty state offers a way forward.
    fireEvent.click(screen.getByRole('button', { name: 'Delete all notes' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete 1,204 notes' }));
    expect(await screen.findByText('Deleted 1,204 notes.')).toBeTruthy();
    expect(await screen.findByText(/Remy has not saved a note yet/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See what Remy knows' }).getAttribute('href')).toBe(
      '#/brain',
    );
  });

  it('says what went wrong when the notes cannot be deleted', async () => {
    await open(
      'memory',
      'Memory and privacy',
      withMethod('deleteNotes', () => Promise.reject(failed(409))),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete all notes' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete 1,204 notes' }));
    expect(
      await screen.findByText(
        'Something changed while you were looking. Reload to see the latest.',
      ),
    ).toBeTruthy();
  });

  it('confirms before making a new token and shows it once', async () => {
    await open('computer', 'This computer');
    expect(screen.getByText('remy.home.example.test')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Make a new token' }));
    const dialog = await screen.findByRole('dialog', { name: 'Make a new token?' });
    expect(screen.queryByText('mock-token-for-a-demo-only')).toBeNull();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Make a new token' }));
    });
    expect(await screen.findByText('mock-token-for-a-demo-only')).toBeTruthy();
  });

  it('says where the token lives and what this browser keeps', async () => {
    await open('computer', 'This computer');
    expect(screen.getByText(/made on the machine that runs Remy/)).toBeTruthy();
    expect(screen.getByText(/this browser keeps only the copy you signed in with/)).toBeTruthy();
    expect(screen.getByText(/Where Remy keeps its files, notes and keys/)).toBeTruthy();
  });

  it('offers a way forward when nothing has signed in yet', async () => {
    const base = createMockApi();
    await open('computer', 'This computer', {
      ...base,
      settings: async () => {
        const d = await base.settings();
        return { ...d, server: { ...d.server, lastSignIns: [] } };
      },
    });
    expect(await screen.findByText(/Nothing has signed in yet/)).toBeTruthy();
  });

  it('shows the version, licences and data folder on the same page', async () => {
    await open('computer', 'This computer');
    expect(screen.getByText('~/.remy')).toBeTruthy();
    expect(screen.getByText('Licences')).toBeTruthy();
  });

  it('opens the merged page from the old server and about names', async () => {
    await open('about', 'This computer');
  });

  it('says so for a section that does not exist, and offers a way back', async () => {
    window.location.hash = '#/settings/nope';
    render(
      <ApiProvider api={createMockApi()}>
        <App />
      </ApiProvider>,
    );
    expect(await screen.findByText('There is no such section.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Your dock' }).getAttribute('href')).toBe(
      '#/settings/dock',
    );
  });

  describe('when the settings cannot be read', () => {
    it('says what went wrong and offers to try again', async () => {
      await open('model', 'Model and keys', broken(401));
      expect(
        await screen.findByText('Your sign-in has expired. Sign in again to carry on.'),
      ).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    });

    it('says the server is not answering when it cannot be reached', async () => {
      await open(
        'computer',
        'This computer',
        withMethod('settings', () => Promise.reject(new TypeError('Failed to fetch'))),
      );
      expect(
        await screen.findByText(
          "Remy's server is not answering. Check that it is running, then try again.",
        ),
      ).toBeTruthy();
    });

    it('loads the section when the person tries again', async () => {
      await open('model', 'Model and keys', onceBroken());
      expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByText('Key saved · in use')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    });

    it('names what is loading instead of showing a bare spinner', async () => {
      await open('model', 'Model and keys', neverAnswers());
      expect(screen.getByText('Loading your models and keys')).toBeTruthy();
    });

    it('keeps the spending boxes usable and says the month is missing', async () => {
      await open('budget', 'Spending', broken(500));
      expect(screen.getByRole('spinbutton', { name: 'Monthly cap' })).toBeTruthy();
      expect(
        await screen.findByText("Remy's server hit a problem. Try again in a moment."),
      ).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    });
  });

  for (const [section, heading] of [
    ['dock', 'Your dock'],
    ['trust', 'How much Remy does on its own'],
    ['budget', 'Spending'],
    ['model', 'Model and keys'],
    ['memory', 'Memory and privacy'],
    ['notifications', 'Notifications'],
    ['computer', 'This computer'],
  ] as const) {
    it(`has no basic accessibility problems in ${section}`, async () => {
      await open(section, heading);
      expect(a11yProblems()).toEqual([]);
    });
  }

  describe('Your dock', () => {
    it('lists the six places in order, with Chat and Settings locked', async () => {
      await open('dock', 'Your dock');
      expect(order()).toEqual(
        ['Chat', 'Activity', 'Browser', 'Brain', 'Connections', 'Settings'].map((n) => `Show ${n}`),
      );
      for (const n of ['Chat', 'Settings']) {
        expect(
          (screen.getByRole('switch', { name: `Show ${n}` }) as HTMLButtonElement).disabled,
        ).toBe(true);
      }
      expect(screen.getAllByText('Always here')).toHaveLength(2);
      expect(
        (screen.getByRole('switch', { name: 'Show Brain' }) as HTMLButtonElement).disabled,
      ).toBe(false);
    });

    it('moves a place up and down and keeps the order', async () => {
      await open('dock', 'Your dock');
      fireEvent.click(screen.getByRole('button', { name: 'Move Brain up' }));
      expect(savedDock()).toEqual([
        'chat',
        'activity',
        'brain',
        'browser',
        'connections',
        'settings',
      ]);
      fireEvent.click(screen.getByRole('button', { name: 'Move Chat down' }));
      expect(savedDock().slice(0, 2)).toEqual(['activity', 'chat']);
      expect(order()[0]).toBe('Show Activity');
      expect(
        (screen.getByRole('button', { name: 'Move Activity up' }) as HTMLButtonElement).disabled,
      ).toBe(true);
      expect(
        (screen.getByRole('button', { name: 'Move Settings down' }) as HTMLButtonElement).disabled,
      ).toBe(true);
    });

    it('hides and shows a place, and the dock follows live', async () => {
      await open('dock', 'Your dock');
      const dock = screen.getByRole('navigation', { name: 'Main' });
      expect(within(dock).getByRole('link', { name: 'Browser' })).toBeTruthy();
      fireEvent.click(screen.getByRole('switch', { name: 'Show Browser' }));
      expect(savedDock()).not.toContain('browser');
      expect(within(dock).queryByRole('link', { name: 'Browser' })).toBeNull();
      expect(
        (screen.getByRole('button', { name: 'Move Browser up' }) as HTMLButtonElement).disabled,
      ).toBe(true); // a hidden place cannot move
      fireEvent.click(screen.getByRole('switch', { name: 'Show Browser' }));
      expect(savedDock()).toContain('browser');
      expect(within(dock).getByRole('link', { name: 'Browser' })).toBeTruthy();
    });

    it('names what is hidden, so it is obvious how to bring it back', async () => {
      await open('dock', 'Your dock');
      expect(screen.getByText('Every place is showing.')).toBeTruthy();
      fireEvent.click(screen.getByRole('switch', { name: 'Show Brain' }));
      expect(screen.getByText('1 place is hidden: Brain.')).toBeTruthy();
      fireEvent.click(screen.getByRole('switch', { name: 'Show Browser' }));
      expect(screen.getByText('2 places are hidden: Browser, Brain.')).toBeTruthy();
    });

    it('puts the dock back to the default order and shows everything', async () => {
      await open('dock', 'Your dock');
      const reset = screen.getByRole('button', {
        name: 'Put the dock back to default',
      }) as HTMLButtonElement;
      expect(reset.disabled).toBe(true);
      fireEvent.click(screen.getByRole('switch', { name: 'Show Brain' }));
      fireEvent.click(screen.getByRole('button', { name: 'Move Connections up' }));
      expect(reset.disabled).toBe(false);
      fireEvent.click(reset);
      expect(stored('dock')).toBeNull();
      expect(order()).toEqual(
        ['Chat', 'Activity', 'Browser', 'Brain', 'Connections', 'Settings'].map((n) => `Show ${n}`),
      );
    });

    it('offers Simple and a Command center that is coming soon', async () => {
      await open('dock', 'Your dock');
      const group = screen.getByRole('radiogroup', { name: 'Layout' });
      expect(
        (within(group).getByRole('radio', { name: 'Simple' }) as HTMLInputElement).checked,
      ).toBe(true);
      expect(
        (within(group).getByRole('radio', { name: 'Command center' }) as HTMLInputElement).disabled,
      ).toBe(true);
      expect(screen.getByText(/Command center: coming soon/)).toBeTruthy();
      expect(screen.getByText('A light theme is not built yet.')).toBeTruthy();
    });
  });
});
