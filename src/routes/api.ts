import { Hono } from 'hono'
import { basicAuth } from 'hono/basic-auth'
import { Env, Follower, Following, Message } from '../types'
import { importprivateKey } from '../utils'
import { createNote, getInbox, postInbox, signHeaders } from '../logic'

const app = new Hono<Env>()

// Secure all /api routes with basic authentication
app.use('*', async (c, next) => {
  const auth = basicAuth({
    username: c.env.BASIC_USERNAME,
    password: c.env.BASIC_PASSWORD,
  })
  return await auth(c, next)
})

/**
 * Sync posts from the Hugo RSS feed and broadcast any new posts to followers
 */
function stripHtml(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

function truncateText(text: string, maxLength: number) {
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength - 3) + '...'
}

/**
 * Sync posts from the Hugo RSS feed and broadcast any new posts to followers
 * Triggered via GitHub Actions post-deploy curl call
 */
export async function syncFeed(feedUrl: string, db: D1Database, env: Env['Bindings'], strHost: string) {
  const res = await fetch(feedUrl)
  if (!res.ok) throw new Error(`Failed to fetch RSS feed from ${feedUrl}: ${res.status}`)
  
  const xml = await res.text()

  // Simple regex RSS parser
  const items: { title: string; link: string; guid: string; description: string }[] = []
  const matches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g)
  for (const match of matches) {
    const itemXml = match[1]
    const title = itemXml.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1')?.trim() || ''
    const link = itemXml.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() || ''
    const guid = itemXml.match(/<guid[^>]*?>([\s\S]*?)<\/guid>/)?.[1]?.trim() || link
    const rawDesc = itemXml.match(/<description>([\s\S]*?)<\/description>/)?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1')?.trim() || ''
    
    const cleanDesc = truncateText(stripHtml(rawDesc), 300)
    if (link) {
      items.push({ title, link, guid, description: cleanDesc })
    }
  }

  if (items.length === 0) {
    return { success: true, message: 'No items found in RSS feed or parsing issue.' }
  }

  const strName = env.preferredUsername
  const PRIVATE_KEY = await importprivateKey(env.PRIVATE_KEY)

  // Fetch followers from D1
  const { results: rawFollowers } = await db.prepare(`SELECT inbox FROM follower;`).all<{ inbox: string }>()
  const followers = rawFollowers || []

  // Fetch post template from D1, fallback to a default
  let postTemplate = `**{title}**\n\n{description}\n\n{link}`
  try {
    const dbTemplate = await db.prepare(`SELECT value FROM profile WHERE key = 'post_template';`).first<string>('value')
    if (dbTemplate) postTemplate = dbTemplate
  } catch (err) {
    console.error('Failed to load post template from D1:', err)
  }

  const newPosts: string[] = []

  // Process from oldest to newest (to publish in chronological order)
  for (const item of items.reverse()) {
    // Check if this guid is already in the database
    const existing = await db.prepare(`SELECT id FROM message WHERE id = ?;`)
      .bind(item.guid)
      .first()

    if (!existing) {
      const messageId = crypto.randomUUID()
      const bodyText = postTemplate
        .replace(/{title}/g, item.title)
        .replace(/{description}/g, item.description)
        .replace(/{link}/g, item.link)

      // Publish to all followers in parallel
      await Promise.all(
        followers.map(async (follower) => {
          try {
            await createNote(messageId, strName, strHost, follower.inbox, bodyText, PRIVATE_KEY)
          } catch (err) {
            console.error(`Failed to push note to follower ${follower.inbox}:`, err)
          }
        })
      )

      // Store the feed item GUID/URL as the ID in D1 to prevent duplicate posts
      await db.prepare(`INSERT INTO message(id, body) VALUES(?, ?);`)
        .bind(item.guid, bodyText)
        .run()

      newPosts.push(item.title)
    }
  }

  return {
    success: true,
    processedCount: items.length,
    newPostCount: newPosts.length,
    newPosts,
  }
}

app.post('/sync-feed', async (c) => {
  const feedUrl = c.req.query('feedUrl') || `https://${new URL(c.req.url).hostname}/index.xml`
  
  try {
    const strHost = new URL(c.req.url).hostname
    const result = await syncFeed(feedUrl, c.env.DB, c.env, strHost)
    return c.json(result)
  } catch (err: any) {
    console.error(err)
    return c.json({ success: false, error: err.message }, 500)
  }
})

/**
 * API: Follow an account
 */
app.post('/follow', async (c) => {
  try {
    const body = await c.req.json<any>().catch(() => ({}))
    const handleInput = (body.handle || '').trim()
    if (!handleInput) return c.json({ success: false, error: 'Missing handle in JSON request body' }, 400)

    const strHost = new URL(c.req.url).hostname
    const strName = c.env.preferredUsername
    const PRIVATE_KEY = await importprivateKey(c.env.PRIVATE_KEY)

    let actorUrl = handleInput
    let handle = handleInput

    // If it looks like a Webfinger handle
    if (handleInput.includes('@')) {
      const cleaned = handleInput.startsWith('@') ? handleInput.slice(1) : handleInput
      const [username, domain] = cleaned.split('@')

      const wfUrl = `https://${domain}/.well-known/webfinger?resource=acct:${username}@${domain}`
      const wfRes = await fetch(wfUrl, { headers: { Accept: 'application/jrd+json, application/json' } })
      if (!wfRes.ok) throw new Error(`Webfinger lookup failed: ${wfRes.status}`)
      const wfData = await wfRes.json<any>()
      const selfLink = wfData.links?.find((l: any) => l.rel === 'self' && l.type?.includes('json'))
      if (!selfLink || !selfLink.href) throw new Error(`No self ActivityPub link found in webfinger`)
      actorUrl = selfLink.href
      handle = `${username}@${domain}`
    }

    // Fetch target actor object
    const actorRes = await fetch(actorUrl, { headers: { Accept: 'application/activity+json, application/ld+json' } })
    if (!actorRes.ok) throw new Error(`Failed to fetch target actor: ${actorRes.status}`)
    const actorData = await actorRes.json<any>()
    const targetInbox = actorData.inbox
    const targetActorId = actorData.id || actorUrl
    if (!targetInbox) throw new Error(`Target actor has no inbox`)

    const followId = crypto.randomUUID()
    const followActivityId = `https://${strHost}/u/${strName}/s/${followId}/follow`

    const followActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: followActivityId,
      type: 'Follow',
      actor: `https://${strHost}/u/${strName}`,
      object: targetActorId,
    }

    const headers = await signHeaders(followActivity, strName, strHost, targetInbox, PRIVATE_KEY)
    const postRes = await postInbox(targetInbox, followActivity, headers)
    if (!postRes.ok) {
      throw new Error(`Failed to deliver Follow activity to target inbox: ${postRes.status}`)
    }

    // Insert as pending
    await c.env.DB.prepare(
      `INSERT OR REPLACE INTO following(id, handle, inbox, state, follow_activity_id) VALUES(?, ?, ?, ?, ?);`
    )
      .bind(targetActorId, handle, targetInbox, 'pending', followActivityId)
      .run()

    return c.json({ success: true, message: `Follow request sent to ${handle}`, targetId: targetActorId })
  } catch (err: any) {
    console.error(err)
    return c.json({ success: false, error: err.message }, 500)
  }
})

/**
 * API: Unfollow an account
 */
app.post('/unfollow', async (c) => {
  try {
    const body = await c.req.json<any>().catch(() => ({}))
    const targetId = body.id
    if (!targetId) return c.json({ success: false, error: 'Missing id in JSON request body' }, 400)

    const strHost = new URL(c.req.url).hostname
    const strName = c.env.preferredUsername
    const PRIVATE_KEY = await importprivateKey(c.env.PRIVATE_KEY)

    const target = await c.env.DB.prepare(`SELECT * FROM following WHERE id = ?;`)
      .bind(targetId)
      .first<Following>()

    if (!target) return c.json({ success: false, error: 'Not following this user' }, 404)

    const undoId = crypto.randomUUID()
    const undoActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `https://${strHost}/u/${strName}/s/${undoId}/undo`,
      type: 'Undo',
      actor: `https://${strHost}/u/${strName}`,
      object: {
        id: target.follow_activity_id,
        type: 'Follow',
        actor: `https://${strHost}/u/${strName}`,
        object: target.id,
      },
    }

    const headers = await signHeaders(undoActivity, strName, strHost, target.inbox, PRIVATE_KEY)
    await postInbox(target.inbox, undoActivity, headers)

    // Remove from followings
    await c.env.DB.prepare(`DELETE FROM following WHERE id = ?;`).bind(targetId).run()

    return c.json({ success: true, message: `Unfollowed ${target.handle}` })
  } catch (err: any) {
    console.error(err)
    return c.json({ success: false, error: err.message }, 500)
  }
})

export default app
