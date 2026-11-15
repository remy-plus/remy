// Where keyboard and screen reader focus goes when the thing that had it goes away.
import { useEffect, useRef } from 'react';

/**
 * A ref for the message that confirms what a person just did. When `message` appears or changes, focus
 * moves to it: the button that was pressed is usually gone by then (a card that was answered), and focus
 * left on a removed element drops to the top of the page. The message is a status, so it is read out.
 */
export function useFocusWhenSet(message: string | null) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (message) ref.current?.focus();
  }, [message]);
  return ref;
}
