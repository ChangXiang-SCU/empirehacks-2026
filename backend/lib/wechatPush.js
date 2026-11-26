// Optional tools that let any MCP client (e.g. Claude Duet's check-ins) push a short message to the owner's
// own WeChat through a Forge Hub (github.com/LinekForge/forge-hub) running on the same server, and check
// whether that WeChat bot is online. Off unless MNEMO_WECHAT_HUB_TOKEN is set.
// The recipient comes from config (MNEMO_WECHAT_TO, an allowlist nickname), so callers can only reach the owner.
import { z } from 'zod'

const HUB = (process.env.MNEMO_WECHAT_HUB_URL || 'http://127.0.0.1:9900').replace(/\/+$/, '')
const TOKEN = (process.env.MNEMO_WECHAT_HUB_TOKEN || '').trim()
const TO = process.env.MNEMO_WECHAT_TO || 'me'
const CHANNEL = process.env.MNEMO_WECHAT_CHANNEL || 'wechat'
const DAILY_LIMIT = Number(process.env.MNEMO_WECHAT_DAILY_LIMIT || 8)
const WINDOW_MS = 23.5 * 3600000 // iLink refuses to send once the user has been silent this long
const HOUR = 3600000

const sentAt = [] // send times in the last 24 h (process memory; resets on restart)

export const wechatEnabled = () => !!TOKEN

export const WECHAT_INSTRUCTIONS = `
WeChat push (send_wechat, wechat_status): send_wechat puts a short message on the user's own WeChat through their WeChat bot. It reaches only the user. Use it only for things that need the user's attention within hours (a deadline today, someone waiting on a reply, a service down), never for routine summaries; keep it to 1-3 sentences in the user's language. WeChat allows the bot about 10 messages per message the user sends and nothing after 24 hours of silence; beyond that messages are queued and delivered when the user next writes to the bot. wechat_status says whether the bot is online and whether a message would arrive now; if the bot is offline, tell the user through your own channel instead.`

const out = s => ({ content: [{ type: 'text', text: s }] })

async function hub(path, init = {}) {
  const res = await fetch(HUB + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    signal: AbortSignal.timeout(40000)
  })
  let body = {}
  try { body = await res.json() } catch { /* non-JSON */ }
  return { status: res.status, body }
}

const bj = t => new Date(t).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
const hrs = ms => ms < HOUR ? `${Math.max(1, Math.round(ms / 60000))} min` : `${(ms / HOUR).toFixed(1)} h`
const clean = s => String(s || '').replace(/[A-Za-z0-9_-]{20,}/g, '…').replace(/\S+@im\.wechat/g, '…').slice(0, 160)

function prune(now) { while (sentAt.length && now - sentAt[0] > 24 * HOUR) sentAt.shift() }

/** Read Forge Hub /status and turn it into a verdict. */
export async function wechatStatus() {
  const now = Date.now()
  prune(now)
  let r
  try { r = await hub('/status') } catch (e) {
    return { state: 'offline', lines: [`Forge Hub is not reachable (${clean(e.message)}).`] }
  }
  if (r.status !== 200) return { state: 'offline', lines: [`Forge Hub answered HTTP ${r.status}.`] }
  const ch = r.body?.channels?.[CHANNEL]
  if (!ch?.loaded) return { state: 'offline', lines: [`The ${CHANNEL} channel is not loaded in Forge Hub.`] }
  const lines = []
  const failAt = ch.lastFailureAt ? Date.parse(ch.lastFailureAt) : 0
  const recentFail = failAt && now - failAt < HOUR
  const sessionDead = recentFail && /-14|session timeout|token|unauthori/i.test(ch.lastError || '')
  const broken = ['unhealthy', 'degraded'].includes(ch.health_status) || (ch.readiness && ch.readiness !== 'ready') || sessionDead
  lines.push(`Bot connection: ${ch.health_status || 'unknown'}${ch.readiness ? `, ${ch.readiness}` : ''}${ch.consecutiveFailures ? `, ${ch.consecutiveFailures} failures in a row` : ''}${ch.lastError && recentFail ? ` (last error ${bj(failAt)} Beijing: ${clean(ch.lastError)})` : ''}.`)
  if (r.body?.hub?.locked) lines.push('Forge Hub is locked (emergency lock), so nothing is sent.')
  const lastIn = ch.lastMessageIn ? Date.parse(ch.lastMessageIn) : 0
  let state
  if (broken || r.body?.hub?.locked) {
    state = 'offline'
    if (sessionDead) lines.push('The WeChat (iLink) login looks expired. The user must re-scan the QR code on the server (fh hub setup wechat as user forgehub, then restart forgehub).')
  } else if (!lastIn) {
    state = 'unknown'
    lines.push('No message from the user since the hub last restarted, so it is unclear whether WeChat will accept a send; it may be queued.')
  } else if (now - lastIn < WINDOW_MS) {
    state = 'open'
    lines.push(`The user last wrote to the bot ${hrs(now - lastIn)} ago (${bj(lastIn)} Beijing). Messages can be sent until about ${bj(lastIn + WINDOW_MS)} Beijing, up to about 10 per user message (shared with the bot's own replies).`)
  } else {
    state = 'closed'
    lines.push(`The user last wrote to the bot ${hrs(now - lastIn)} ago (${bj(lastIn)} Beijing), more than 24 hours, so WeChat will not deliver now. send_wechat would queue the message until the user next writes to the bot.`)
  }
  lines.push(`send_wechat used ${sentAt.length}/${DAILY_LIMIT} times in the last 24 h.`)
  return { state, lines }
}

const VERDICT = {
  open: 'ONLINE: a message sent now should arrive.',
  closed: 'ONLINE but WeChat window closed: a message would be queued until the user writes to the bot.',
  unknown: 'ONLINE, delivery window unknown.',
  offline: 'OFFLINE: messages will not reach WeChat. Tell the user through another channel.'
}

export function registerWechatTools(server) {
  if (!wechatEnabled()) return

  server.registerTool('wechat_status', {
    title: 'WeChat bot status',
    description: "Check whether the user's WeChat bot is online and whether a send_wechat message would be delivered now (WeChat only lets the bot write within 24 hours of the user's last message). Use it in periodic check-ins to notice the bot going offline, which it cannot report itself.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true }
  }, async () => {
    const s = await wechatStatus()
    return out([VERDICT[s.state], ...s.lines].join('\n'))
  })

  server.registerTool('send_wechat', {
    title: "Send to the user's WeChat",
    description: "Push a short message to the user's own WeChat through their WeChat bot. It reaches only the user, never anyone else. Only for things that need the user's attention within hours, not routine summaries. If WeChat's limits block delivery now, the message is queued and arrives when the user next writes to the bot; the result says which happened. Do not resend a queued message.",
    inputSchema: {
      text: z.string().min(1).max(1500).describe("The message, 1-3 sentences in the user's language"),
      sender: z.string().max(12).optional().describe('Short label shown before the message, e.g. "Duet". Default "Claude"')
    },
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, async ({ text, sender }) => {
    const now = Date.now()
    prune(now)
    if (sentAt.length >= DAILY_LIMIT) {
      return out(`Not sent: send_wechat is limited to ${DAILY_LIMIT} messages per 24 hours and that is used up. Tell the user through your own channel instead.`)
    }
    const label = (sender || 'Claude').replace(/[\r\n：:]+/g, ' ').trim() || 'Claude'
    let r
    try {
      r = await hub('/send', { method: 'POST', body: JSON.stringify({ channel: CHANNEL, to: TO, text: `${label}：${text.trim()}` }) })
    } catch (e) {
      return out(`Not sent: Forge Hub is not reachable (${clean(e.message)}). Tell the user through another channel.`)
    }
    if (r.status !== 200 || !r.body?.success) {
      return out(`Not sent: Forge Hub refused (${r.status}${r.body?.error ? `, ${clean(r.body.error)}` : ''}). Tell the user through another channel.`)
    }
    sentAt.push(now)
    const w = String(r.body.warning || '')
    if (/队列|queue/i.test(w)) return out('Queued, not delivered yet: WeChat\'s limit is reached (the user has not written to the bot recently). It will be delivered automatically when the user next writes to the bot. Do not resend.')
    if (w) return out(`Sent, with a warning from the hub: ${clean(w)}`)
    return out('Delivered to the user\'s WeChat.')
  })
}