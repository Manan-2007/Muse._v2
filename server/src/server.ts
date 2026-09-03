import { createServer } from 'node:http'

import { createApp } from './app.js'
import { env } from './config/env.js'
import { attachCallGateway } from './sockets/call.gateway.js'
import { attachChatGateway } from './sockets/chat.gateway.js'
import { attachGameGateway } from './sockets/game.gateway.js'
import { attachMusicGateway } from './sockets/music.gateway.js'
import { attachPresenceGateway } from './sockets/presence.gateway.js'
import { attachStudyGateway } from './sockets/study.gateway.js'
import { attachVoiceGateway } from './sockets/voice.gateway.js'
import { attachWatchGateway } from './sockets/watch.gateway.js'

const httpServer = createServer(createApp())

/* Everything rides the presence socket — one connection, one handshake, and
   membership checked the same way for all of them. */
const io = attachPresenceGateway(httpServer)
attachWatchGateway(io)
attachMusicGateway(io)
attachChatGateway(io)
attachCallGateway(io)
attachVoiceGateway(io)
attachGameGateway(io)
attachStudyGateway(io)

httpServer.listen(env.port, () => {
  console.log(`  Muse. API on http://localhost:${env.port}`)
})
