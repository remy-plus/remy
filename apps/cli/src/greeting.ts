// The line the home screen opens with: the time of day and the user's name, when there is one.

/** Morning until noon, afternoon until 5 pm, evening after that and through the night. */
export function dayPart(date: Date): 'morning' | 'afternoon' | 'evening' {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  return 'evening';
}

/** `Good evening, Sam.` or, without a name, `Good evening.` */
export function greeting(date: Date, name?: string): string {
  const word = `Good ${dayPart(date)}`;
  return name?.trim() ? `${word}, ${name.trim()}.` : `${word}.`;
}
