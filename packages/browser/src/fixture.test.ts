import { describe, expect, it } from 'vitest';
import { fixtureBrowser } from './fixture.ts';

const FORM =
  '<html><head><title>Rye</title></head><body><a href="/home">Home</a>' +
  '<form action="/order" method="post"><input name="qty" aria-label="Quantity">' +
  '<input type="password" name="pw"><input name="cc-number" aria-label="Card"><button>Buy now</button></form>' +
  '<form action="/find"><input type="search" name="q" aria-label="Search"></form></body></html>';

describe('fixture browser', () => {
  it('reads controls with the kinds the page walker gives', async () => {
    const b = fixtureBrowser({ 'https://s.test/rye': FORM });
    const s = await b.open('https://s.test/rye');
    expect(s.title).toBe('Rye');
    expect(s.elements.map((e) => [e.ref, e.kind, e.name])).toEqual([
      [1, 'link', 'Home'],
      [2, 'textbox', 'Quantity'],
      [3, 'password', 'pw'],
      [4, 'card', 'Card'],
      [5, 'submit', 'Buy now'],
      [6, 'textbox', 'Search'],
    ]);
    expect(s.elements[5]).toMatchObject({ role: 'searchbox', formMethod: 'get' });
  });

  it('logs a posted form with its fields and follows a GET form', async () => {
    const b = fixtureBrowser({
      'https://s.test/rye': FORM,
      'https://s.test/order': '<title>Done</title>',
      'https://s.test/find': '<title>Found</title>',
    });
    await b.open('https://s.test/rye');
    await b.type(2, '2', false);
    expect((await b.click(5)).title).toBe('Done');
    expect(b.presses).toEqual([
      { url: 'https://s.test/rye', name: 'Buy now', fields: { qty: '2' } },
    ]);
    await b.open('https://s.test/rye');
    expect((await b.type(6, 'rye', true)).url).toBe('https://s.test/find?q=rye');
  });

  it('lands on the signed-in page when shown', async () => {
    const b = fixtureBrowser(
      {
        'https://b.test/a': '<title>Sign in</title>',
        'https://b.test/home': '<title>Home</title>',
      },
      { signInTo: 'https://b.test/home' },
    );
    await b.open('https://b.test/a');
    await b.show();
    expect(b.visible).toBe(true);
    expect((await b.snapshot()).title).toBe('Home');
  });
});
