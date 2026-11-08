import type { SettingsData } from '../../api/index.tsx';

/** What every section gets. `data` is null until the adapter answers, and stays null when it cannot. */
export interface SectionProps {
  data: SettingsData | null;
  reload: () => void;
}

export const SECTIONS = [
  { id: 'trust', label: 'Trust and approvals' },
  { id: 'model', label: 'Model and keys' },
  { id: 'budget', label: 'Budget' },
  { id: 'memory', label: 'Memory and privacy' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'server', label: 'Home server' },
  { id: 'about', label: 'About' },
] as const;

export type SectionId = (typeof SECTIONS)[number]['id'];
