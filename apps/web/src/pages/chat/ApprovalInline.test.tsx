import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiProvider } from '../../api/index.tsx';
import { createMockApi } from '../../api/mock.ts';
import { ApprovalInline } from './ApprovalInline.tsx';

afterEach(cleanup);

describe('ApprovalInline reason', () => {
  it('says what Remy asks before, not what the policy calls it', () => {
    render(
      <ApiProvider api={createMockApi()}>
        <ApprovalInline
          taskId="t"
          onResolved={() => {}}
          card={{
            callId: 'c',
            argsHash: 'h',
            preview: 'Write notes.txt',
            risk: 'write',
            reason: "Changing files or data isn't auto-approved",
          }}
        />
      </ApiProvider>,
    );
    expect(screen.getByText('Remy asks before changing files.')).toBeTruthy();
    expect(document.body.textContent).not.toContain('auto-approved');
  });
});
