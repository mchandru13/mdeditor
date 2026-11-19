/** GitHub-style heading slugs with deterministic de-duplication. */

const COMBINING_MARKS = /[\u0300-\u036f]/g;

export function slugify(text: string): string {
  const base = text
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return base.length > 0 ? base : 'section';
}

/** Allocates unique ids in document order: `intro`, `intro-1`, `intro-2`. */
export function createSlugger() {
  const used = new Map<string, number>();

  return function next(text: string): string {
    const slug = slugify(text);
    const seen = used.get(slug);

    if (seen === undefined) {
      used.set(slug, 0);
      return slug;
    }

    const count = seen + 1;
    used.set(slug, count);
    return `${slug}-${count}`;
  };
}
