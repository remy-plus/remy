import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../App.tsx';
import { a11yProblems } from '../../a11y.testing.ts';
import { ApiProvider } from '../../api/index.tsx';
import { createMockApi } from '../../api/mock.ts';

afterEach(() => {
  window.location.hash = '';
  window.localStorage.removeItem('remy.token');
});

/** Onboarding is reachable without a session; these tests say which case they mean. */
const signedIn = () => window.localStorage.setItem('remy.token', 'a-token');

const openWith = (api: ReturnType<typeof createMockApi>, hash: string) => {
  window.location.hash = hash;
  return render(
    <ApiProvider api={api}>
      <App />
    </ApiProvider>,
  );
};

const open = (hash: string) => openWith(createMockApi(), hash);

const KEY = 'sk-test-ABCDEF1234567890abcdef';
const CHOICES = [
  {
    id: 'openai',
    label: 'OpenAI',
    model: 'gpt-5-nano',
    note: 'Pay as you go. The cheapest way to start.',
    needsKey: true,
    keyUrl: 'platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    model: 'claude-haiku-5-5',
    note: 'Claude models.',
    needsKey: true,
    keyUrl: 'console.anthropic.com/settings/keys',
  },
  {
    id: 'ollama',
    label: 'Ollama (on this computer, no key)',
    model: 'llama3.1',
    note: 'Free and private.',
    needsKey: false,
  },
];
const NO_MODEL = { ready: false, current: null, choices: CHOICES };

/** A mock server that starts with no model, and records every key it is sent. */
const withoutModel = (over: Partial<ReturnType<typeof createMockApi>> = {}) => {
  const sent: { provider: string; key: string }[] = [];
  const api = {
    ...createMockApi(),
    modelSetup: async () => NO_MODEL,
    saveModelKey: async (provider: string, key: string) => {
      sent.push({ provider, key });
      return {
        ok: true as const,
        current: { provider, label: 'OpenAI', model: 'gpt-5-nano' },
        saved: 'in the macOS Keychain on this computer',
      };
    },
    ...over,
  };
  return { api, sent };
};

const typeKey = async (text: string) => {
  const input = (await screen.findByLabelText(/Your .* key/)) as HTMLInputElement;
  fireEvent.change(input, { target: { value: text } });
  return input;
};

describe('Welcome step 1: connect a model', () => {
  it('says what it needs, lists the providers cheapest first and marks the step', async () => {
    openWith(withoutModel().api, '#/welcome/1');
    expect(await screen.findByRole('heading', { level: 1, name: "Hi, I'm Remy." })).toBeTruthy();
    const trace = screen.getByRole('list', { name: 'Setup steps' });
    expect(
      within(trace)
        .getAllByRole('listitem')
        .map((li) => li.getAttribute('aria-current')),
    ).toEqual(['step', null]);
    expect((await screen.findAllByRole('radio')).map((r) => r.getAttribute('value'))).toEqual([
      'openai',
      'anthropic',
      'ollama',
    ]);
    expect((screen.getByRole('radio', { name: /OpenAI/ }) as HTMLInputElement).checked).toBe(true);
    // The key goes in a password field, never one the browser fills or remembers.
    const input = screen.getByLabelText('Your OpenAI key') as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(input.autocomplete).toBe('off');
    expect(
      screen.getByRole('link', { name: 'platform.openai.com/api-keys' }).getAttribute('href'),
    ).toBe('https://platform.openai.com/api-keys');
    expect(screen.getByRole('button', { name: 'Check and save' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
  });

  it('saves a key, says where it went, clears the field and offers Continue', async () => {
    const { api, sent } = withoutModel();
    openWith(api, '#/welcome/1');
    await typeKey(`  ${KEY}  `);
    fireEvent.click(screen.getByRole('button', { name: 'Check and save' }));
    expect(
      await screen.findByText(/Connected\. Remy will think with gpt-5-nano from OpenAI/),
    ).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain(
      'in the macOS Keychain on this computer',
    );
    expect(sent).toEqual([{ provider: 'openai', key: KEY }]);
    // The key is gone from the page: no field, and no text that holds it.
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(document.body.textContent).not.toContain(KEY);
    expect(screen.getByRole('link', { name: 'Continue' }).getAttribute('href')).toBe('#/welcome/2');
  });

  it('a wrong key shows the server’s sentence, keeps the person here and empties the field', async () => {
    const { api } = withoutModel({
      saveModelKey: async () => {
        throw Object.assign(
          new Error(
            'OpenAI did not accept that key. Check that you copied all of it, then paste it again.',
          ),
          { status: 400 },
        );
      },
    });
    openWith(api, '#/welcome/1');
    const input = await typeKey(KEY);
    fireEvent.click(screen.getByRole('button', { name: 'Check and save' }));
    expect((await screen.findByRole('alert')).textContent).toContain('did not accept that key');
    expect(input.value).toBe('');
    expect(document.body.textContent).not.toContain(KEY);
    expect(screen.queryByRole('link', { name: 'Continue' })).toBeNull();
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('no network: one plain sentence, not "Failed to fetch"', async () => {
    const { api } = withoutModel({
      saveModelKey: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    openWith(api, '#/welcome/1');
    await typeKey(KEY);
    fireEvent.click(screen.getByRole('button', { name: 'Check and save' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      "Remy's server is not answering. Check that it is running, then try again.",
    );
  });

  it('no credit: the server’s sentence is shown as it is', async () => {
    const said =
      'That key works, but the OpenAI account has no credit left. Add some at platform.openai.com/api-keys, then try again.';
    const { api } = withoutModel({
      saveModelKey: async () => {
        throw Object.assign(new Error(said), { status: 402 });
      },
    });
    openWith(api, '#/welcome/1');
    await typeKey(KEY);
    fireEvent.click(screen.getByRole('button', { name: 'Check and save' }));
    expect((await screen.findByRole('alert')).textContent).toBe(said);
  });

  it('an empty key is caught before anything is sent', async () => {
    const { api, sent } = withoutModel();
    openWith(api, '#/welcome/1');
    fireEvent.click(await screen.findByRole('button', { name: 'Check and save' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Paste the key first/);
    // Focus moves to the key field, so the next thing typed is the key.
    expect(document.activeElement).toBe(screen.getByLabelText('Your OpenAI key'));
    expect(sent).toEqual([]);
  });

  it('a key typed for one provider is dropped when another is picked', async () => {
    const { api, sent } = withoutModel();
    openWith(api, '#/welcome/1');
    await typeKey(KEY);
    fireEvent.click(screen.getByRole('radio', { name: /Anthropic/ }));
    expect((screen.getByLabelText('Your Anthropic key') as HTMLInputElement).value).toBe('');
    fireEvent.click(screen.getByRole('radio', { name: /Ollama/ }));
    expect(document.querySelector('input[type="password"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Use this' }));
    await screen.findByText(/Connected\./);
    expect(sent).toEqual([{ provider: 'ollama', key: '' }]);
  });

  it('when Remy already has a model it says so and offers Continue or a change', async () => {
    const { api } = withoutModel({
      modelSetup: async () => ({
        ready: true,
        current: { provider: 'openai', label: 'OpenAI', model: 'gpt-5-nano' },
        choices: CHOICES,
      }),
    });
    openWith(api, '#/welcome/1');
    expect(await screen.findByText(/already connected to OpenAI, using gpt-5-nano/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Continue' }).getAttribute('href')).toBe('#/welcome/2');
    fireEvent.click(screen.getByRole('button', { name: 'Use a different one' }));
    expect(await screen.findByLabelText('Your OpenAI key')).toBeTruthy();
  });

  it('a server that cannot say shows the problem and a way to ask again', async () => {
    let calls = 0;
    const { api } = withoutModel({
      modelSetup: async () => {
        calls++;
        if (calls === 1) throw new TypeError('Failed to fetch');
        return NO_MODEL;
      },
    });
    openWith(api, '#/welcome/1');
    expect((await screen.findByRole('alert')).textContent).toMatch(/not answering/);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('Your OpenAI key')).toBeTruthy();
  });

  it('an older server that cannot take a key names the terminal command', async () => {
    const { modelSetup: _a, saveModelKey: _b, ...old } = createMockApi();
    openWith(old, '#/welcome/1');
    expect(await screen.findByText('remy login')).toBeTruthy();
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });
});

describe('Welcome step 2: the first answer', () => {
  it('welcomes, names what is connected, offers three ideas that need no app, and explains the limits', async () => {
    signedIn();
    const api = createMockApi();
    openWith({ ...api, connections: async () => ({ apps: [], machines: [] }) }, '#/welcome/2');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'You are set. What do you need done?' }),
    ).toBeTruthy();
    expect(
      screen.getByText(/Nothing is connected yet, so I start with the web and files\./),
    ).toBeTruthy();
    const ideas = within(
      screen.getByRole('heading', { level: 2, name: 'Or try one of these' })
        .nextElementSibling as HTMLElement,
    ).getAllByRole('button');
    expect(ideas).toHaveLength(3);
    expect(ideas.map((b) => b.textContent).join(' ')).not.toMatch(
      /email|calendar|folder|Documents/i,
    );
    // The cap and the currency, one line each, with the defaults and where to change them.
    expect(screen.getByText(/Remy stops at \$25 a month and \$2 on any one task/)).toBeTruthy();
    expect(screen.getByText(/Amounts show in US Dollar \(USD\)\./)).toBeTruthy();
    for (const link of screen.getAllByRole('link', { name: 'Change it in Settings.' }))
      expect(link.getAttribute('href')).toBe('#/settings/budget');
  });

  it('names the apps that are connected, and only those', async () => {
    signedIn();
    open('#/welcome/2');
    expect(await screen.findByText(/Connected: .*Gmail/)).toBeTruthy();
  });

  it('asks nothing of the server without a session, and claims nothing', async () => {
    let asked = false;
    const api = createMockApi();
    openWith(
      {
        ...api,
        connections: async () => {
          asked = true;
          return { apps: [], machines: [] };
        },
      },
      '#/welcome/2',
    );
    await screen.findByRole('heading', { level: 1 });
    expect(asked).toBe(false);
    expect(screen.queryByText(/^Connected:/)).toBeNull();
    expect(window.location.hash).toBe('#/welcome/2');
  });

  it('an idea fills the box, and Ask Remy opens the chat and finishes setup', async () => {
    window.localStorage.removeItem('remy.onboarded');
    open('#/welcome/2');
    const start = (await screen.findByRole('button', { name: 'Ask Remy' })) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Write a short note asking my landlord/ }));
    expect((screen.getByLabelText('What you need done') as HTMLTextAreaElement).value).toBe(
      'Write a short note asking my landlord to fix a leaking tap',
    );
    fireEvent.click(start);
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/chat\//));
    expect(window.localStorage.getItem('remy.onboarded')).toBe('true');
  });

  it('a failed start says why in one sentence and stays', async () => {
    const api = createMockApi();
    openWith(
      {
        ...api,
        sendMessage: async () => {
          throw Object.assign(
            new Error('Remy needs a model before it can answer. Add a key to get started.'),
            { status: 409 },
          );
        },
      },
      '#/welcome/2',
    );
    fireEvent.change(await screen.findByLabelText('What you need done'), {
      target: { value: 'hi' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask Remy' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/needs a model/);
    expect(window.location.hash).toBe('#/welcome/2');
  });

  it('the old step 3 link lands here', async () => {
    open('#/welcome/3');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'You are set. What do you need done?' }),
    ).toBeTruthy();
  });

  it('skipping setup marks the visit as done and opens Home', async () => {
    window.localStorage.removeItem('remy.onboarded');
    open('#/welcome/2');
    fireEvent.click(await screen.findByRole('button', { name: 'Skip setup and open Remy' }));
    expect(window.localStorage.getItem('remy.onboarded')).toBe('true');
    expect(window.location.hash).toBe('#/');
  });

  for (const step of ['1', '2']) {
    it(`has no basic accessibility problems in step ${step}`, async () => {
      openWith(withoutModel().api, `#/welcome/${step}`);
      await screen.findByRole('heading', { level: 1 });
      if (step === '1') await screen.findByLabelText('Your OpenAI key');
      expect(a11yProblems()).toEqual([]);
    });
  }
});

describe('the model gate', () => {
  const http = (over: Partial<ReturnType<typeof createMockApi>> = {}) =>
    ({ ...withoutModel().api, kind: 'http' as const, ...over }) as ReturnType<typeof createMockApi>;

  it('sends a signed-in visit with no model from the front door to setup', async () => {
    signedIn();
    openWith(http(), '#/');
    await waitFor(() => expect(window.location.hash).toBe('#/welcome/1'));
  });

  it('leaves a visit alone when Remy has a model', async () => {
    signedIn();
    openWith(http({ modelSetup: async () => ({ ...NO_MODEL, ready: true, current: null }) }), '#/');
    await screen.findByRole('navigation', { name: 'Main' });
    await new Promise((r) => setTimeout(r, 50));
    expect(window.location.hash).toBe('#/');
  });

  it('leaves Settings and other pages reachable without a model', async () => {
    signedIn();
    openWith(http(), '#/settings');
    await screen.findByRole('navigation', { name: 'Main' });
    await new Promise((r) => setTimeout(r, 50));
    expect(window.location.hash).toBe('#/settings');
  });

  it('asks once: after "Skip setup" the person is not sent back', async () => {
    signedIn();
    let asked = 0;
    const counted = async () => {
      asked++;
      return NO_MODEL;
    };
    openWith(http({ modelSetup: counted }), '#/');
    await waitFor(() => expect(window.location.hash).toBe('#/welcome/1'));
    fireEvent.click(await screen.findByRole('button', { name: 'Skip setup and open Remy' }));
    await screen.findByRole('navigation', { name: 'Main' });
    await new Promise((r) => setTimeout(r, 50));
    expect(window.location.hash).toBe('#/');
    expect(asked).toBeLessThanOrEqual(2); // the gate once, the setup screen once
  });

  it('does nothing when the server cannot be asked', async () => {
    signedIn();
    openWith(
      http({
        modelSetup: async () => {
          throw new TypeError('Failed to fetch');
        },
      }),
      '#/',
    );
    await screen.findByRole('navigation', { name: 'Main' });
    await new Promise((r) => setTimeout(r, 50));
    expect(window.location.hash).toBe('#/');
  });
});

describe('first visit', () => {
  it('sends a visit with no token from any page to sign-in, never to fake data', async () => {
    window.history.replaceState({}, '', '/');
    for (const start of ['#/', '#/tasks', '#/settings']) {
      cleanup();
      open(start);
      await waitFor(() => expect(window.location.hash).toBe('#/sign-in'));
    }
  });

  it('does not send someone who signed in or already finished', async () => {
    window.localStorage.removeItem('remy.onboarded');
    window.localStorage.setItem('remy.token', 'abc');
    open('#/');
    await screen.findByRole('navigation', { name: 'Main' });
    expect(window.location.hash).toBe('#/');
  });

  it('leaves a visit that is already done alone', async () => {
    open('#/'); // the test setup marks the visit as done
    await screen.findByRole('navigation', { name: 'Main' });
    expect(window.location.hash).toBe('#/');
  });
});
