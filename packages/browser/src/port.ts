/**
 * What a control on the page is, as far as risk goes. `submit` sends a form; `password` and `card`
 * are fields Remy never types into (the user does, in the shown window).
 */
export type ElementKind =
  | 'link'
  | 'button'
  | 'submit'
  | 'textbox'
  | 'password'
  | 'card'
  | 'checkbox'
  | 'select'
  | 'other';

export interface PageElement {
  /** Number shown to the model; valid until the next snapshot. */
  ref: number;
  kind: ElementKind;
  /** Role as the page states it, e.g. `button`, `tab`, `menuitem`. */
  role: string;
  /** Accessible name, short. */
  name: string;
  href?: string;
  /** Current value of a text field (never of a password or card field). */
  value?: string;
  /** Index of the form the control belongs to, if any, and that form's method. */
  form?: number;
  formMethod?: 'get' | 'post';
}

export interface PageSnapshot {
  url: string;
  title: string;
  /** Readable text of the page, whitespace collapsed, not capped. */
  text: string;
  elements: PageElement[];
}

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

/**
 * A browser on the user's machine. One page at a time; links that open a new tab move to it.
 * Every call that changes the page returns a fresh snapshot, and refs from older snapshots stop working.
 */
export interface Browser {
  open(url: string): Promise<PageSnapshot>;
  snapshot(): Promise<PageSnapshot>;
  /** The latest snapshot, without touching the page (for approval previews). */
  current(): PageSnapshot | undefined;
  click(ref: number): Promise<PageSnapshot>;
  /** Replaces the field's text; `submit` presses Enter afterwards. */
  type(ref: number, text: string, submit: boolean): Promise<PageSnapshot>;
  /** Runs a search in its own tab, so the current page stays where it is. */
  search(query: string, count: number): Promise<SearchHit[]>;
  /** Opens the window (same profile, same page) so the user can act in it. */
  show(): Promise<void>;
  hide(): Promise<void>;
  readonly visible: boolean;
  close(): Promise<void>;
}
