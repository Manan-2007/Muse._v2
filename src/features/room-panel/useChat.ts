import { useCallback, useEffect, useRef, useState } from 'react'

import { getSocket } from '@/lib/socket'

export type ChatMessage = {
  id: string
  body: string
  createdAt: string
  author: { id: string; name: string }
}

/** How long to wait after the last keystroke before saying you stopped. */
const TYPING_IDLE_MS = 2200

export function useChat(roomId: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [typing, setTyping] = useState<string[]>([])
  const [unread, setUnread] = useState(0)

  /* Whether the panel is on screen. Messages that arrive while it is closed
     count as unread; the ref keeps the socket handler from being rebound
     every time the panel opens. */
  const watching = useRef(false)
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSent = useRef(false)

  useEffect(() => {
    setMessages([])
    setTyping([])
    setUnread(0)
    if (!roomId) return

    const socket = getSocket()

    const onHistory = ({ roomId: id, messages: list }: { roomId: string; messages: ChatMessage[] }) => {
      if (id === roomId) setMessages(list)
    }

    const onMessage = ({ roomId: id, message }: { roomId: string; message: ChatMessage }) => {
      if (id !== roomId) return
      /* Guard against a double-delivery leaving two identical bubbles. */
      setMessages((current) =>
        current.some((entry) => entry.id === message.id) ? current : [...current, message],
      )
      if (!watching.current) setUnread((count) => count + 1)
    }

    const onTyping = ({
      roomId: id,
      user,
      typing: isTyping,
    }: {
      roomId: string
      user: { id: string; name: string }
      typing: boolean
    }) => {
      if (id !== roomId) return
      setTyping((current) => {
        const without = current.filter((name) => name !== user.name)
        return isTyping ? [...without, user.name] : without
      })
    }

    const request = () => socket.emit('chat:history', { roomId })

    socket.on('chat:history', onHistory)
    socket.on('chat:message', onMessage)
    socket.on('chat:typing', onTyping)
    socket.on('connect', request)
    request()

    return () => {
      socket.off('chat:history', onHistory)
      socket.off('chat:message', onMessage)
      socket.off('chat:typing', onTyping)
      socket.off('connect', request)
      if (typingTimer.current) clearTimeout(typingTimer.current)
    }
  }, [roomId])

  const send = useCallback(
    (body: string) => {
      const text = body.trim()
      if (!roomId || !text) return
      getSocket().emit('chat:send', { roomId, body: text })
      lastSent.current = false
      if (typingTimer.current) clearTimeout(typingTimer.current)
    },
    [roomId],
  )

  /** Debounced both ways: one "started" per burst, one "stopped" when it ends. */
  const noteTyping = useCallback(() => {
    if (!roomId) return
    const socket = getSocket()

    if (!lastSent.current) {
      socket.emit('chat:typing', { roomId, typing: true })
      lastSent.current = true
    }

    if (typingTimer.current) clearTimeout(typingTimer.current)
    typingTimer.current = setTimeout(() => {
      socket.emit('chat:typing', { roomId, typing: false })
      lastSent.current = false
    }, TYPING_IDLE_MS)
  }, [roomId])

  const setWatching = useCallback((value: boolean) => {
    watching.current = value
    if (value) setUnread(0)
  }, [])

  return { messages, typing, unread, send, noteTyping, setWatching }
}
