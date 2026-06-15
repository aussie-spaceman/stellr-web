import crypto from 'crypto'

// Video conferencing abstraction for Coaching/Mentoring (FR-COM-11/12).
//
// The portal embeds the call rather than sending members to an external app, and
// the host is a moderator without needing a per-seat license. JaaS (8x8
// Jitsi-as-a-Service) is the default; Zoom is a swappable fallback. All call
// sites depend only on the VideoProvider interface, so switching providers is a
// one-line change in getVideoProvider().
//
// JaaS recordings are retained for only 24h, so a recording webhook must offload
// the file to private Supabase Storage (see sessions recording_path). That
// handler is provider-specific and wired in a later step.

export interface VideoRoom {
  provider: 'jaas' | 'zoom'
  /** Room name (JaaS) or meeting id (Zoom). */
  room: string
  /** Convenience base URL; a per-join moderator/guest token is minted separately. */
  joinUrl: string
}

export interface VideoMember {
  id: string
  name: string
  email: string | null
}

export interface VideoProvider {
  readonly name: 'jaas' | 'zoom'
  /** Provision a room for a session. */
  createRoom(opts: { sessionId: string; title: string }): Promise<VideoRoom>
  /**
   * Mint a join token. For JaaS this is the RS256 JWT carrying moderator status —
   * isHost=true grants the coach/mentor moderator + recording rights, with NO
   * per-seat license required. Returns '' when the provider isn't configured yet.
   */
  getJoinToken(room: string, member: VideoMember, isHost: boolean): Promise<string>
}

// ─── JaaS ──────────────────────────────────────────────────────────────────
// Env required for live tokens:
//   JAAS_APP_ID         — 8x8 app id (vpaas-magic-cookie-…)
//   JAAS_KID            — API key id
//   JAAS_PRIVATE_KEY    — RSA private key (PEM; \n-escaped is fine)
const JAAS_APP_ID = process.env.JAAS_APP_ID
const JAAS_KID = process.env.JAAS_KID
const JAAS_PRIVATE_KEY = process.env.JAAS_PRIVATE_KEY?.replace(/\\n/g, '\n')

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

const jaasProvider: VideoProvider = {
  name: 'jaas',

  async createRoom({ sessionId }) {
    // Room name is namespaced by the session id; JaaS prefixes with the app id.
    const room = `stellr-${sessionId}`
    const base = JAAS_APP_ID
      ? `https://8x8.vc/${JAAS_APP_ID}/${room}`
      : `https://meet.jit.si/${room}` // dev fallback when JaaS isn't configured
    return { provider: 'jaas', room, joinUrl: base }
  },

  async getJoinToken(room, member, isHost) {
    // Without keys we can't sign; the dev fallback URL works without a token.
    if (!JAAS_APP_ID || !JAAS_KID || !JAAS_PRIVATE_KEY) {
      console.warn('[video] JaaS not configured — returning empty token (dev fallback room is open).')
      return ''
    }

    const now = Math.floor(Date.now() / 1000)
    const header = { alg: 'RS256', typ: 'JWT', kid: JAAS_KID }
    const payload = {
      aud: 'jitsi',
      iss: 'chat',
      sub: JAAS_APP_ID,
      room,
      exp: now + 60 * 60 * 3, // 3h
      nbf: now - 10,
      context: {
        user: {
          id: member.id,
          name: member.name,
          email: member.email ?? undefined,
          moderator: isHost ? 'true' : 'false',
        },
        features: {
          // Hosts may record; recordings are offloaded to Supabase via webhook.
          recording: isHost ? 'true' : 'false',
          livestreaming: 'false',
          transcription: 'false',
        },
      },
    }

    const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`
    const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), JAAS_PRIVATE_KEY)
    return `${signingInput}.${base64url(signature)}`
  },
}

// ─── Zoom (fallback / pilot) ─────────────────────────────────────────────────
// Implemented against the Server-to-Server OAuth app when VIDEO_PROVIDER=zoom.
// Left as a typed stub here; the JaaS path is the default and is fully wired.
const zoomProvider: VideoProvider = {
  name: 'zoom',
  async createRoom({ sessionId }) {
    console.warn('[video] Zoom provider not implemented — using placeholder room.')
    return { provider: 'zoom', room: sessionId, joinUrl: '' }
  },
  async getJoinToken() {
    return ''
  },
}

export function getVideoProvider(): VideoProvider {
  return process.env.VIDEO_PROVIDER === 'zoom' ? zoomProvider : jaasProvider
}

// ─── Embed coordinates (shared by all call sites) ────────────────────────────
// The single place that knows how to point the in-portal Jitsi <iframe> at the
// right server. When JaaS is configured we embed 8x8.vc with the app-id-prefixed
// room; otherwise we fall back to the open meet.jit.si dev rooms (no token).
export interface VideoEmbedConfig {
  domain: string
  scriptSrc: string
  /** Room name as the external API expects it (app-id-prefixed on JaaS). */
  roomName: string
  /** False when JaaS keys are absent and we're on the open dev fallback. */
  configured: boolean
}

export function getEmbedConfig(room: string): VideoEmbedConfig {
  if (JAAS_APP_ID) {
    return {
      domain: '8x8.vc',
      scriptSrc: `https://8x8.vc/${JAAS_APP_ID}/external_api.js`,
      roomName: `${JAAS_APP_ID}/${room}`,
      configured: true,
    }
  }
  return {
    domain: 'meet.jit.si',
    scriptSrc: 'https://meet.jit.si/external_api.js',
    roomName: room,
    configured: false,
  }
}

// Deterministic room name for a live training lesson (FR-COM-10). No sessions
// row is provisioned for these — the item id namespaces the room directly, and
// the same name is reconstructed from the recording webhook's fqn.
export function trainingRoomName(itemId: string): string {
  return `stellr-train-${itemId}`
}
