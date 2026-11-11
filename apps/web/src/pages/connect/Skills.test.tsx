import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../App.tsx';
import { ApiError } from '../../api/http.ts';
import { ApiProvider, type RemyApi } from '../../api/index.tsx';
import { createMockApi } from '../../api/mock.ts';

afterEach(() => {
  window.location.hash = '';
});

const apiWith = (patch: Partial<RemyApi>): RemyApi => ({ ...createMockApi(), ...patch });

const open = (api: RemyApi = createMockApi()) => {
  window.location.hash = '#/skills';
  return render(
    <ApiProvider api={api}>
      <App />
    </ApiProvider>,
  );
};

describe('Skills', () => {
  it('shows the first skill with its steps as a numbered trace and why it exists', async () => {
    open();
    const detail = await screen.findByRole('article', { name: 'monthly-report' });
    expect(within(detail).getAllByRole('listitem')).toHaveLength(4);
    expect(within(detail).getByText('Read the notes file')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Why this skill exists' })).toBeTruthy();
    expect(screen.getByText('Learned from your correction on 6 Oct')).toBeTruthy();
  });

  it('selects another skill', async () => {
    open();
    await screen.findByRole('article', { name: 'monthly-report' });
    fireEvent.click(screen.getByRole('button', { name: /^research/ }));
    expect(await screen.findByRole('article', { name: 'research' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Why this skill exists' })).toBeNull();
    expect(screen.getByRole('button', { name: /^research/ }).getAttribute('aria-current')).toBe(
      'true',
    );
  });

  it('turns a skill off and on, saying so, and runs it', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Turn off' }));
    expect(await screen.findByRole('button', { name: 'Turn on' })).toBeTruthy();
    expect(await screen.findByText('monthly-report is off. Remy will not use it.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Run it now' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText('Turn it on to run it.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    expect(await screen.findByText('monthly-report is on. Remy will use it again.')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Run it now' }));
    expect(await screen.findByText('Started monthly-report.')).toBeTruthy();
    expect(await screen.findByRole('link', { name: 'Open the job' })).toBeTruthy();
  });

  it('says which status stopped a change, in the server’s own words', async () => {
    open(apiWith({ setSkillEnabled: () => Promise.reject(new ApiError(404, '')) }));
    fireEvent.click(await screen.findByRole('button', { name: 'Turn off' }));
    expect(
      await screen.findByText('That is gone now. It may have been deleted or moved.'),
    ).toBeTruthy();
  });

  it('saves the suggestion as a skill, and says it did', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Save as a skill' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Suggested' })).toBeNull());
    expect(screen.getByText('Saved as a skill. Remy will follow it from now on.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^rename-receipts/ })).toBeTruthy();
  });

  it('says a suggestion was not saved when it is turned down', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(
      await screen.findByText('Not saved. Remy keeps doing it the way it did before.'),
    ).toBeTruthy();
  });

  it('is honest that steps are not edited here', async () => {
    open();
    await screen.findByRole('article', { name: 'monthly-report' });
    expect(screen.queryByRole('button', { name: 'Edit steps' })).toBeNull();
    expect(screen.getByText(/Editing them by hand is not available yet/)).toBeTruthy();
  });

  it('offers a way forward when no skill is saved yet', async () => {
    open(apiWith({ skills: async () => ({ skills: [], suggestion: null }) }));
    expect(await screen.findByText('No skill yet.')).toBeTruthy();
    expect(screen.getByText('Nothing is saved yet.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Start a chat with Remy' }).getAttribute('href')).toBe(
      '#/',
    );
  });

  it('has landmarks and no unnamed button', async () => {
    open();
    await screen.findByRole('article');
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Brain' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('heading', { level: 1, name: 'Skills' })).toBeTruthy();
    for (const b of screen.getAllByRole('button')) expect(b.textContent?.trim()).not.toBe('');
  });
});
