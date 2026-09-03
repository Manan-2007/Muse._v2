import { useEffect, useState } from 'react'

import * as studyApi from '@/features/study/api'

/**
 * The shelf a generator can be narrowed to.
 *
 * Its own module because `DocumentPicker` is a component and this is a hook,
 * and a file exporting both loses fast refresh for everything importing it.
 */

export type Shelf = { rows: studyApi.StudyResource[]; syllabusId: string | null }

/**
 * The shelf, minus the syllabus and anything not yet searchable.
 *
 * Shared by the two callers so they cannot disagree about what is offerable —
 * a document still being read has no passages to draw on, and offering it
 * would produce a lesson grounded in nothing while claiming otherwise.
 */
export function useShelf(roomId: string, subjectId: string | null): Shelf {
  const [rows, setRows] = useState<studyApi.StudyResource[]>([])
  const [syllabusId, setSyllabusId] = useState<string | null>(null)

  useEffect(() => {
    if (!subjectId) {
      setRows([])
      setSyllabusId(null)
      return
    }

    let cancelled = false
    void Promise.all([
      studyApi.resources(roomId, subjectId).catch(() => ({ resources: [] })),
      studyApi.syllabus(roomId, subjectId).catch(() => ({ syllabus: null })),
    ]).then(([shelf, outline]) => {
      if (cancelled) return
      setRows(shelf.resources.filter((row) => row.status === 'ready'))
      setSyllabusId(outline.syllabus?.resourceId ?? null)
    })

    return () => {
      cancelled = true
    }
  }, [roomId, subjectId])

  return { rows, syllabusId }
}
