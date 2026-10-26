/** Keep the source descriptor intact in storage; remove only its matching supplied date prefix for display. */
export function displayWorkCreator(work: { author: string; year?: number }): string {
  const date = work.author.match(/^\s*(\d{4})(?:-\d{2}(?:-\d{2})?)?\s*,\s*/);
  return date && work.year === Number(date[1]) ? work.author.slice(date[0].length) : work.author;
}
