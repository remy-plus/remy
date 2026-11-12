import type { SettingsData } from '../../api/index.tsx';

/** What every section gets. `data` is null until the adapter answers, and stays null when it cannot. */
export interface SectionProps {
  data: SettingsData | null;
  /** Why the settings could not be read, in plain words; null while they are fine. */
  error: string | null;
  reload: () => void;
}

export const SECTIONS = [
  { id: 'dock', label: 'Your dock' },
  { id: 'trust', label: 'How much Remy does on its own' },
  { id: 'budget', label: 'Spending' },
  { id: 'model', label: 'Model and keys' },
  { id: 'search', label: 'Search and browsing' },
  { id: 'memory', label: 'Memory and privacy' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'computer', label: 'This computer' },
] as const;

export type SectionId = (typeof SECTIONS)[number]['id'];

/** Old section names that still open the right place. */
export const SECTION_ALIASES: Record<string, SectionId> = {
  server: 'computer',
  about: 'computer',
  appearance: 'dock',
};

/**
 * Rows that have an address of their own: `#/settings/folder` opens the section that holds that row
 * and scrolls to it. The row's container carries the same id.
 */
export const ROW_SECTIONS: ReadonlyMap<string, SectionId> = new Map<string, SectionId>([
  ['folder', 'trust'],
  ['voice', 'model'],
]);
