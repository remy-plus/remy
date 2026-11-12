import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App.tsx';
import { ApiError } from '../../api/http.ts';
import { ApiProvider, type RemyApi } from '../../api/index.tsx';
import { createMockApi } from '../../api/mock.ts';

afterEach(() => {
  window.location.hash = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const apiWith = (patch: Partial<RemyApi>): RemyApi => ({ ...createMockApi(), ...patch });

const open = (api: RemyApi = createMockApi()) => {
  window.location.hash = '#/skills/find';
  return render(
    <ApiProvider api={api}>
      <App />
    </ApiProvider>,
  );
};

const type = (text: string) =>
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: text } });

describe('Find a skill', () => {
  it('is linked from Skills', async () => {
    window.location.hash = '#/skills';
    render(
      <ApiProvider api={createMockApi()}>
        <App />
      </ApiProvider>,
    );
    const a = await screen.findByRole('link', { name: 'Find a skill' });
    expect(a.getAttribute('href')).toBe('#/skills/find');
  });

  it('gives a hint before anything is typed', async () => {
    open();
    expect(await screen.findByText('Type a word to search skills.sh.')).toBeTruthy();
  });

  it('shows skills.sh results, then bots on the other tab', async () => {
    open();
    await screen.findByRole('heading', { level: 1, name: 'Find a skill' });
    type('pdf');
    expect(await screen.findByText('pdf-forms')).toBeTruthy();
    expect(screen.getByText('12,402 installs')).toBeTruthy();
    const link = screen.getByRole('link', { name: /acme\/skills\/pdf-forms/ });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noreferrer');

    fireEvent.click(screen.getByRole('tab', { name: 'Ready-made bots' }));
    expect(await screen.findByText('No results', { exact: false }).catch(() => null)).toBeNull();
    type('inbox');
    expect(await screen.findByText('Inbox triage')).toBeTruthy();
    expect(screen.queryByText('pdf-forms')).toBeNull();
  });

  it('waits for a pause in typing before it searches', async () => {
    vi.useFakeTimers();
    const search = vi.fn(createMockApi().searchSkillDirectory);
    open(apiWith({ searchSkillDirectory: search }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    type('p');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    type('pd');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(search).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('pd', 'skills');
  });

  it('says so when nothing matches', async () => {
    open();
    await screen.findByRole('searchbox');
    type('zzzz');
    expect(await screen.findByText('Nothing matched “zzzz”. Try a shorter word.')).toBeTruthy();
  });

  it('asks first, and only installs after Install', async () => {
    const install = vi.fn(createMockApi().installFromDirectory);
    open(apiWith({ installFromDirectory: install }));
    await screen.findByRole('searchbox');
    type('pdf');
    fireEvent.click(await screen.findByRole('button', { name: 'Install pdf-forms' }));
    expect(await screen.findByRole('heading', { name: 'Install pdf-forms?' })).toBeTruthy();
    expect(screen.getByText(/saved as text at a fixed version/)).toBeTruthy();
    expect(install).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    await waitFor(() => expect(install).toHaveBeenCalledWith('skills.sh', 'acme/skills/pdf-forms'));
    expect(await screen.findByText('Installed')).toBeTruthy();
    expect(screen.getByText('pdf-forms is installed.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See it in Skills' }).getAttribute('href')).toBe(
      '#/skills',
    );
  });

  it('does nothing on Not now', async () => {
    const install = vi.fn(createMockApi().installFromDirectory);
    open(apiWith({ installFromDirectory: install }));
    await screen.findByRole('searchbox');
    type('pdf');
    fireEvent.click(await screen.findByRole('button', { name: 'Install pdf-forms' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(install).not.toHaveBeenCalled();
    expect(screen.queryByText('Installed')).toBeNull();
  });

  it('shows the prompt for a bot before it is installed', async () => {
    open();
    await screen.findByRole('searchbox');
    fireEvent.click(screen.getByRole('tab', { name: 'Ready-made bots' }));
    type('inbox');
    fireEvent.click(await screen.findByRole('button', { name: 'Install Inbox triage' }));
    expect(await screen.findByLabelText('Prompt preview')).toBeTruthy();
    expect(screen.getByText(/You are an inbox triage assistant/)).toBeTruthy();
    expect(screen.getByText(/never as permission/)).toBeTruthy();
  });

  it('shows the server sentence when the name is taken', async () => {
    open(
      apiWith({
        installFromDirectory: async () => {
          throw new ApiError(409, 'A skill named pdf-forms is already saved.');
        },
      }),
    );
    await screen.findByRole('searchbox');
    type('pdf');
    fireEvent.click(await screen.findByRole('button', { name: 'Install pdf-forms' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Install' }));
    expect(await screen.findByText('A skill named pdf-forms is already saved.')).toBeTruthy();
    expect(screen.queryByText('Installed')).toBeNull();
  });

  it('says when the directory cannot be reached', async () => {
    open(
      apiWith({
        searchSkillDirectory: async () => {
          throw new ApiError(502, 'skills.sh did not answer. Try again in a moment.');
        },
      }),
    );
    await screen.findByRole('searchbox');
    type('pdf');
    expect(
      await screen.findByText('skills.sh did not answer. Try again in a moment.'),
    ).toBeTruthy();
  });
});
