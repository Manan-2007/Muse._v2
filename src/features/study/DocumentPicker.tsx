import { type Shelf } from '@/features/study/useShelf'
import { cn } from '@/lib/utils'

/**
 * Choosing which documents a thing gets written from.
 *
 * Lifted out of `TopicPicker` so the lesson generator can have it too. It was
 * the only generator without one, which meant the one output that takes two
 * minutes to make and is watched end to end was also the one that could not
 * be pointed at a specific handout.
 *
 * Multi-select, and always has been — each chip toggles, so "these two
 * handouts" is a normal thing to ask for rather than a special case. Empty
 * means everything on the shelf, which is what most people want most of the
 * time and is why it is the default rather than a state to be escaped.
 *
 * The syllabus is deliberately not offered. It is always in the prompt as the
 * course outline, and putting it here would invite picking an index to write
 * from instead of the material — a lesson generated from a table of contents
 * is a lesson about nothing.
 */

export function DocumentPicker({
  shelf,
  picked,
  onChange,
  className,
}: {
  shelf: Shelf
  picked: string[]
  onChange: (next: string[]) => void
  className?: string
}) {
  const content = shelf.rows.filter((row) => row.id !== shelf.syllabusId)

  /* One document is not a choice — it is the answer either way, and a picker
     offering a single chip next to "Everything" is two buttons that do the
     same thing. */
  if (content.length <= 1) return null

  return (
    <div className={cn('border-t border-[var(--study-line)] pt-3', className)}>
      <p className="text-[0.72rem] text-[var(--study-faint)]">
        Written from{' '}
        {picked.length === 0
          ? 'everything on the shelf'
          : `${picked.length} of ${content.length} documents`}
        {shelf.syllabusId && ' — the syllabus decides the topics either way'}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => onChange([])}
          aria-pressed={picked.length === 0}
          className={cn(
            'rounded-full border px-3 py-1 text-[0.74rem] outline-none transition-colors',
            picked.length === 0
              ? 'border-[var(--study-accent)] bg-[var(--study-accent-soft)] text-[var(--study-text)]'
              : 'border-[var(--study-line)] text-[var(--study-soft)] hover:bg-[var(--study-card)]',
          )}
        >
          Everything
        </button>
        {content.map((row) => {
          const on = picked.includes(row.id)
          return (
            <button
              key={row.id}
              type="button"
              onClick={() =>
                onChange(
                  picked.includes(row.id)
                    ? picked.filter((id) => id !== row.id)
                    : [...picked, row.id],
                )
              }
              aria-pressed={on}
              title={row.title}
              className={cn(
                'max-w-[16rem] truncate rounded-full border px-3 py-1 text-[0.74rem] outline-none transition-colors',
                on
                  ? 'border-[var(--study-accent)] bg-[var(--study-accent-soft)] text-[var(--study-text)]'
                  : 'border-[var(--study-line)] text-[var(--study-soft)] hover:bg-[var(--study-card)]',
              )}
            >
              {row.title}
            </button>
          )
        })}
      </div>
    </div>
  )
}
