// Reads the `answer` of a `finish` tool call while the model is still writing it. Providers stream
// a tool call's arguments as pieces of one JSON text ({"answer":"The pri ... ce is $5."}), cut
// anywhere: in the middle of a word, of an escape (\n, é) or of a surrogate pair. This takes
// those pieces one by one and hands back the characters of the `answer` string as they become
// known, already decoded. Nothing else in the arguments is ever returned.

/** Takes argument text piece by piece; returns the newly decoded characters of the field. */
export interface FieldExtractor {
  push(chunk: string): string;
}

const SIMPLE_ESCAPE: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  b: '\b',
  f: '\f',
  '/': '/',
  '"': '"',
  '\\': '\\',
};

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/**
 * Extracts the string value of `field` from the top-level object of a JSON text that arrives in
 * pieces. A nested object's field of the same name, a key that only looks like it inside a string,
 * and a value that is not a string are all ignored. After the string ends, nothing more is returned.
 */
export function createFieldExtractor(field = 'answer'): FieldExtractor {
  type Mode = 'scan' | 'key' | 'value' | 'other' | 'done';
  let mode: Mode = 'scan';
  let depth = 0;
  let expectKey = false; // at depth 1, the next string is a key
  let wantValue = false; // a key named `field` was just read; its value comes after the colon
  let key = '';
  let esc = false;
  let hex: string | undefined; // collecting the four digits of \uXXXX
  let held = ''; // a high surrogate waiting for its partner

  /** One decoded unit of string content, or '' when it must wait. */
  const unit = (ch: string): string => {
    // A held high surrogate is released with its partner, or alone when none comes.
    if (held) {
      const code = ch.charCodeAt(0);
      if (ch.length === 1 && isLow(code)) {
        const pair = held + ch;
        held = '';
        return pair;
      }
      const lone = held;
      held = '';
      return lone + unit(ch);
    }
    if (ch.length === 1 && isHigh(ch.charCodeAt(0))) {
      held = ch;
      return '';
    }
    return ch;
  };

  return {
    push(chunk) {
      let out = '';
      for (const ch of chunk) {
        if (mode === 'done') break;
        if (mode === 'scan') {
          if (ch === '"') {
            if (depth === 1 && expectKey) {
              mode = 'key';
              key = '';
            } else if (depth === 1 && wantValue) {
              mode = 'value';
              wantValue = false;
            } else {
              mode = 'other';
            }
          } else if (ch === '{' || ch === '[') {
            depth++;
            if (depth === 1 && ch === '{') expectKey = true;
            wantValue = false;
          } else if (ch === '}' || ch === ']') {
            depth--;
            wantValue = false;
          } else if (depth === 1 && ch === ':') {
            expectKey = false;
          } else if (depth === 1 && ch === ',') {
            expectKey = true;
            wantValue = false;
          } else if (depth === 1 && wantValue && !/\s/.test(ch)) {
            wantValue = false; // the value is not a string
          }
          continue;
        }
        // Inside a string. Escapes first.
        let text: string | undefined;
        if (hex !== undefined) {
          hex += ch;
          if (hex.length < 4) continue;
          const code = Number.parseInt(hex, 16);
          hex = undefined;
          text = Number.isNaN(code) ? '�' : String.fromCharCode(code);
        } else if (esc) {
          esc = false;
          if (ch === 'u') {
            hex = '';
            continue;
          }
          text = SIMPLE_ESCAPE[ch] ?? ch;
        } else if (ch === '\\') {
          esc = true;
          continue;
        } else if (ch === '"') {
          // The string ends.
          if (mode === 'value') {
            out += held; // a lone high surrogate is kept as it came
            held = '';
            mode = 'done';
          } else {
            if (mode === 'key' && key === field) wantValue = true;
            mode = 'scan';
          }
          continue;
        } else {
          text = ch;
        }
        if (mode === 'value') out += unit(text);
        else if (mode === 'key') key += text;
      }
      return out;
    },
  };
}

interface CallPart {
  name: string;
  extractor: FieldExtractor;
  started: boolean;
  /** Answer text read before the call's name was known. */
  early: string;
}

/**
 * Follows the tool calls of one streamed reply and passes on only the growing `answer` of calls to
 * `tool` (`finish`). Every other call's arguments are read by nobody: they never leave the model
 * client. Leading blank space of the answer is dropped, as the finish tool trims it too.
 */
export function createAnswerStream(onAnswer: (delta: string) => void, tool = 'finish') {
  const calls = new Map<number, CallPart>();
  return {
    /** A piece of a call's name and/or arguments, for the call at `index`. */
    push(index: number, name: string | undefined, args: string | undefined) {
      let c = calls.get(index);
      if (!c) {
        c = { name: '', extractor: createFieldExtractor('answer'), started: false, early: '' };
        calls.set(index, c);
      }
      if (name) c.name += name;
      const text = c.early + (args ? c.extractor.push(args) : '');
      c.early = '';
      if (!text) return;
      if (c.name === '') {
        c.early = text; // some providers send the arguments before the name
        return;
      }
      if (c.name !== tool) return;
      const out = c.started ? text : text.trimStart();
      if (!out) return;
      c.started = true;
      onAnswer(out);
    },
  };
}
