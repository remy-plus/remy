# Phone pass, 2026-11-12

Method: the app was run in mock mode (`?mock=1`) and loaded in headless Chrome (Playwright from an existing install, nothing added to the repo) at 360 and 390 px wide with touch emulation. For every route a script measured page scroll width, any element outside the viewport that is not inside its own scroller, and any link, button or field under 24 px tall. Screenshots were read for the main screens. This is an emulator, not a phone.

Result: no screen scrolled sideways at 360 or 390 px before or after. The earlier passes had already handled overflow; the fixes below are tap targets, truncation, and layout polish.

| Screen                                            | Found at 360/390                                                                            | Changed                                                        | Commit  |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------- |
| Chat (home, feed, composer)                       | Fine. Dock does not cover content, composer is sticky with safe-area padding                | none                                                           |         |
| Activity                                          | Fine                                                                                        | none                                                           |         |
| Task detail                                       | Note box hint "Tell Remy something while it works" cut off at 360                           | Shorter hint, "Add a note while it works"                      | 6255cc2 |
| Browser pane                                      | Address cut off ("https://northwind.com...")                                                | Title and address wrap on phones, truncate from 640 px up      | c812319 |
| Brain / notes                                     | Search hint cut off                                                                         | Hint now "Search by meaning"                                   | 289f255 |
| Skills                                            | Fine                                                                                        | none                                                           |         |
| Schedules (list, webhooks, Next 24 hours aside)   | Time and "next in ..." squeezed side by side and wrapping badly; aside already stacks below | Each gets its own line under 900 px                            | 9bcd96d |
| New schedule                                      | Fine (the example text in the task box is clipped by the box height; it is a placeholder)   | none                                                           |         |
| Connections, detail                               | Fine                                                                                        | none                                                           |         |
| Add app, Find app, Add machine                    | Breadcrumb link 16 px tall                                                                  | Link is a full tap target                                      | 1fecfb5 |
| Settings sections                                 | Section list wrapped into five uneven rows                                                  | Two columns under 520 px                                       | 8000ddd |
| Settings fields (spending, currency, model, etc.) | Number and text fields under 16 px, which makes iPhone Safari zoom the page on focus        | Every text field is 16 px on touch screens (`pointer: coarse`) | 1c30395 |
| History drawer                                    | Chat titles cut off ("Flights to Lisbon in M...")                                           | Titles wrap                                                    | ea54c56 |
| Command palette                                   | Fits; keyboard hints in the footer are of no use on a phone                                 | none                                                           |         |
| Sign-in                                           | Recovery command broke inside its flag ("--" / "rotate")                                    | Command stays on one line                                      | 3596046 |
| Welcome / first run                               | Fine                                                                                        | none                                                           |         |
| Quiet screen                                      | "turn off" button 18 px tall                                                                | Padded to a 40 px target                                       | 73b6ed7 |
| Approval card and dialog                          | Fine; the dialog is a bottom sheet with full-width buttons                                  | none                                                           |         |
| Review                                            | Fine                                                                                        | none                                                           |         |

## Could not verify without a real phone

- iPhone Safari's zoom-on-focus fix (the 16 px rule) and the safe-area insets on a notched device. Emulation reports zero insets.
- The software keyboard covering the sticky composers.
- Touch feel of the dock sheet and drawers, and landscape.
- Real fonts and rendering on Android (checked with desktop Chrome only).

## For the owner

- `#/settings/folder` and `#/settings/voice` show "This section is not built yet": Folder Remy may use and Voice are rows inside the "This computer" and "Model and keys" sections, not sections of their own. They were checked there. `server` is an alias and works.
- Inline text links inside sentences (for example "See your connections") are under 24 px tall. They were left alone as running text.
- Number inputs in Settings are 38 px boxes whose label wraps the field, so the whole box is tappable.
