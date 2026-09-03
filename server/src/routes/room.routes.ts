import { Router } from 'express'

import * as musicController from '../controllers/music.controller.js'
import * as studyController from '../controllers/study.controller.js'
import * as roomController from '../controllers/room.controller.js'
import * as watchController from '../controllers/watch.controller.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { receiveDocument, receiveAudio, receiveVideo } from '../services/upload.service.js'

export const roomRoutes = Router()

// Everything below the room API needs a session.
roomRoutes.use(requireAuth)

roomRoutes.get('/', asyncHandler(roomController.list))
roomRoutes.post('/', asyncHandler(roomController.create))
/* Before `/:id`, or Express reads "join" as a room id. */
roomRoutes.get('/discover', asyncHandler(roomController.discover))
roomRoutes.post('/join', asyncHandler(roomController.joinByCode))
roomRoutes.get('/:id', asyncHandler(roomController.show))
roomRoutes.post('/:id/join', asyncHandler(roomController.join))

/* Watch: the queue and its lookups. Playback itself is on the socket. */
roomRoutes.get('/:id/watch', asyncHandler(watchController.capabilities))
roomRoutes.get('/:id/watch/search', asyncHandler(watchController.search))
roomRoutes.post('/:id/watch/resolve', asyncHandler(watchController.resolve))
roomRoutes.post('/:id/watch/upload', receiveVideo, asyncHandler(watchController.upload))
roomRoutes.get('/:id/watch/library', asyncHandler(watchController.library))
/* Encoded, because a film's name is arbitrary — spaces, brackets, dots. */
roomRoutes.delete('/:id/watch/library/:file', asyncHandler(watchController.removeFromLibrary))
roomRoutes.get('/:id/watch/queue', asyncHandler(watchController.queue))
roomRoutes.post('/:id/watch/queue', asyncHandler(watchController.add))
roomRoutes.post('/:id/watch/queue/reorder', asyncHandler(watchController.reorder))
roomRoutes.delete('/:id/watch/queue', asyncHandler(watchController.clear))
roomRoutes.delete('/:id/watch/queue/:itemId', asyncHandler(watchController.remove))

/* Music: the listening queue and its lookups. Playback is on the socket. */
roomRoutes.get('/:id/music', asyncHandler(musicController.capabilities))
roomRoutes.get('/:id/music/search', asyncHandler(musicController.search))
roomRoutes.post('/:id/music/resolve', asyncHandler(musicController.resolve))
roomRoutes.post('/:id/music/upload', receiveAudio, asyncHandler(musicController.upload))
roomRoutes.get('/:id/music/library', asyncHandler(musicController.library))
roomRoutes.get('/:id/music/lyrics', asyncHandler(musicController.lyrics))
roomRoutes.get('/:id/music/queue', asyncHandler(musicController.queue))
roomRoutes.post('/:id/music/queue', asyncHandler(musicController.add))
roomRoutes.post('/:id/music/queue/reorder', asyncHandler(musicController.reorder))
roomRoutes.delete('/:id/music/queue', asyncHandler(musicController.clear))
roomRoutes.delete('/:id/music/queue/:trackId', asyncHandler(musicController.remove))

/* The kept library: playlists, saved songs, and what to play next. */
roomRoutes.get('/:id/music/playlists', asyncHandler(musicController.playlists))
roomRoutes.post('/:id/music/playlists', asyncHandler(musicController.createPlaylist))
roomRoutes.delete('/:id/music/playlists/:playlistId', asyncHandler(musicController.deletePlaylist))
roomRoutes.post('/:id/music/playlists/:playlistId/tracks', asyncHandler(musicController.addToPlaylist))
roomRoutes.delete(
  '/:id/music/playlists/:playlistId/tracks/:trackId',
  asyncHandler(musicController.removeFromPlaylist),
)
roomRoutes.get('/:id/music/liked', asyncHandler(musicController.liked))

/*
 * Study.
 *
 * Everything here is scoped to a subject rather than to the room, and the
 * subject is checked against the room on every call — membership of a room is
 * not membership of whatever subject id somebody puts in a query string.
 */
roomRoutes.get('/:id/study', asyncHandler(studyController.capabilities))

roomRoutes.get('/:id/study/subjects', asyncHandler(studyController.subjects))
roomRoutes.post('/:id/study/subjects', asyncHandler(studyController.createSubject))
roomRoutes.delete('/:id/study/subjects/:subjectId', asyncHandler(studyController.deleteSubject))

roomRoutes.get('/:id/study/resources', asyncHandler(studyController.listResources))
roomRoutes.post(
  '/:id/study/resources',
  receiveDocument,
  asyncHandler(studyController.uploadResource),
)
roomRoutes.post(
  '/:id/study/resources/:resourceId/retry',
  asyncHandler(studyController.retryResource),
)
roomRoutes.delete('/:id/study/resources/:resourceId', asyncHandler(studyController.deleteResource))

roomRoutes.get('/:id/study/syllabus', asyncHandler(studyController.getSyllabus))
roomRoutes.post('/:id/study/syllabus', asyncHandler(studyController.readSyllabus))
roomRoutes.get('/:id/study/next', asyncHandler(studyController.nextUp))

roomRoutes.get('/:id/study/mcq', asyncHandler(studyController.listMcq))
roomRoutes.post('/:id/study/mcq', asyncHandler(studyController.createMcq))
roomRoutes.get('/:id/study/mcq/:setId', asyncHandler(studyController.getMcq))
roomRoutes.post('/:id/study/mcq/:setId/answers', asyncHandler(studyController.answerMcq))
roomRoutes.delete('/:id/study/mcq/:setId', asyncHandler(studyController.deleteMcq))

roomRoutes.get('/:id/study/notes', asyncHandler(studyController.listNotes))
roomRoutes.post('/:id/study/notes', asyncHandler(studyController.createNote))
roomRoutes.get('/:id/study/notes/:noteId', asyncHandler(studyController.getNote))
roomRoutes.delete('/:id/study/notes/:noteId', asyncHandler(studyController.deleteNote))

roomRoutes.get('/:id/study/coding', asyncHandler(studyController.listProblems))
roomRoutes.post('/:id/study/coding', asyncHandler(studyController.createProblem))
roomRoutes.get('/:id/study/coding/:problemId', asyncHandler(studyController.getProblem))
roomRoutes.post(
  '/:id/study/coding/:problemId/submissions',
  asyncHandler(studyController.submitProblem),
)
roomRoutes.post(
  '/:id/study/coding/:problemId/review',
  asyncHandler(studyController.reviewSubmission),
)
roomRoutes.post(
  '/:id/study/coding/:problemId/recheck',
  asyncHandler(studyController.recheckProblem),
)
roomRoutes.delete('/:id/study/coding/:problemId', asyncHandler(studyController.deleteProblem))

roomRoutes.get('/:id/study/explainers', asyncHandler(studyController.listExplainers))
roomRoutes.post('/:id/study/explainers', asyncHandler(studyController.createExplainer))
roomRoutes.get('/:id/study/explainers/:explainerId', asyncHandler(studyController.getExplainer))
roomRoutes.post(
  '/:id/study/explainers/:explainerId/retry',
  asyncHandler(studyController.retryExplainer),
)
roomRoutes.delete(
  '/:id/study/explainers/:explainerId',
  asyncHandler(studyController.deleteExplainer),
)

roomRoutes.get('/:id/study/progress', asyncHandler(studyController.progress))

roomRoutes.get('/:id/study/assistant', asyncHandler(studyController.assistantHistory))
roomRoutes.post('/:id/study/assistant', asyncHandler(studyController.assistantAsk))
roomRoutes.delete('/:id/study/assistant', asyncHandler(studyController.assistantClear))
roomRoutes.post('/:id/music/liked', asyncHandler(musicController.toggleLiked))
roomRoutes.get('/:id/music/suggestions', asyncHandler(musicController.suggestions))
