import { Hono } from 'hono'
import { basicAuth } from 'hono/basic-auth'
import { Top } from './Pages'
import { Env, Follower, Following, Message } from '../types'
import { validator } from 'hono/validator'
import { importprivateKey } from '../utils'
import { createNote, getInbox, postInbox, signHeaders } from '../logic'

const app = new Hono<Env>({ strict: false })

// Secure all /ap routes with basic authentication
app.use('*', async (c, next) => {
  const auth = basicAuth({
    username: c.env.BASIC_USERNAME,
    password: c.env.BASIC_PASSWORD,
  })
  return await auth(c, next)
})



app.get('/', async (c) => {
  const strHost = new URL(c.req.url).hostname
  const strName = c.env.preferredUsername

  // 1. Fetch messages
  const { results: rawMessages } = await c.env.DB.prepare(`SELECT * FROM message;`).all<Message>()
  const messages = rawMessages || []
  
  // 2. Fetch followers
  const { results: rawFollowers } = await c.env.DB.prepare(`SELECT * FROM follower;`).all<Follower>()
  const followers = rawFollowers || []

  // 3. Fetch following list
  const { results: rawFollowing } = await c.env.DB.prepare(`SELECT * FROM following;`).all<Following>()
  const following = rawFollowing || []

  // 4. Fetch profile
  let displayName = c.env.name
  let bio = ''
  let avatarUrl = `https://${strHost}/static/icon.png`
  let postTemplate = `**{title}**\n\n{description}\n\n{link}`

  try {
    const dbName = await c.env.DB.prepare(`SELECT value FROM profile WHERE key = 'display_name';`).first<string>('value')
    const dbBio = await c.env.DB.prepare(`SELECT value FROM profile WHERE key = 'bio';`).first<string>('value')
    const dbAvatar = await c.env.DB.prepare(`SELECT value FROM profile WHERE key = 'avatar_url';`).first<string>('value')
    const dbTemplate = await c.env.DB.prepare(`SELECT value FROM profile WHERE key = 'post_template';`).first<string>('value')
    if (dbName) displayName = dbName
    if (dbBio) bio = dbBio
    if (dbAvatar) avatarUrl = dbAvatar
    if (dbTemplate) postTemplate = dbTemplate
  } catch (err) {
    console.error('Failed to load profile settings from DB:', err)
  }

  const profile = { displayName, bio, avatarUrl, postTemplate }

  return c.html(
    <Top
      messages={messages}
      followers={followers}
      following={following}
      profile={profile}
      username={strName}
      host={strHost}
    />
  )
})

app.post(
  '/post',
  validator('form', (value, c) => {
    if (!value['body']) {
      return c.text('Invalid!', 400)
    }
    return value as { body: string }
  }),
  async (c) => {
    const data = c.req.valid('form')
    const messageId = crypto.randomUUID()

    const strHost = new URL(c.req.url).hostname
    const strName = c.env.preferredUsername

    const PRIVATE_KEY = await importprivateKey(c.env.PRIVATE_KEY)

    // Fetch all followers inboxes
    const { results } = await c.env.DB.prepare(`SELECT inbox FROM follower;`).all<{ inbox: string }>()
    const followers = results || []

    // Post to all inboxes in parallel
    await Promise.all(
      followers.map(async (follower) => {
        try {
          await createNote(messageId, strName, strHost, follower.inbox, data.body, PRIVATE_KEY)
        } catch (err) {
          console.error(`Failed to post to follower inbox ${follower.inbox}:`, err)
        }
      })
    )

    // Log the message in the DB
    await c.env.DB.prepare(`INSERT INTO message(id, body) VALUES(?, ?);`)
      .bind(messageId, data.body)
      .run()

    return c.redirect('/ap')
  }
)

app.post('/profile', async (c) => {
  const body = await c.req.parseBody()
  const displayName = body['display_name'] as string
  const bio = body['bio'] as string
  const avatarUrl = body['avatar_url'] as string
  const postTemplate = body['post_template'] as string

  await c.env.DB.prepare(`INSERT OR REPLACE INTO profile(key, value) VALUES(?, ?);`)
    .bind('display_name', displayName)
    .run()
  await c.env.DB.prepare(`INSERT OR REPLACE INTO profile(key, value) VALUES(?, ?);`)
    .bind('bio', bio)
    .run()
  await c.env.DB.prepare(`INSERT OR REPLACE INTO profile(key, value) VALUES(?, ?);`)
    .bind('avatar_url', avatarUrl)
    .run()
  await c.env.DB.prepare(`INSERT OR REPLACE INTO profile(key, value) VALUES(?, ?);`)
    .bind('post_template', postTemplate)
    .run()

  const strHost = new URL(c.req.url).hostname
  const strName = c.env.preferredUsername
  const PRIVATE_KEY = await importprivateKey(c.env.PRIVATE_KEY)

  try {
    // Fetch our own freshly updated Actor object
    const actorRes = await fetch(`https://${strHost}/u/${strName}`, {
      headers: { Accept: 'application/activity+json' }
    })
    if (actorRes.ok) {
      const actorData = await actorRes.json<any>()
      const updateId = crypto.randomUUID()
      const updateActivity = {
        '@context': [
          'https://www.w3.org/ns/activitystreams',
          'https://w3id.org/security/v1'
        ],
        id: `https://${strHost}/u/${strName}/s/${updateId}/update`,
        type: 'Update',
        actor: `https://${strHost}/u/${strName}`,
        object: actorData,
      }

      // Fetch all followers to broadcast the update
      const { results: followers } = await c.env.DB.prepare(`SELECT * FROM follower;`).all<Follower>()
      if (followers && followers.length > 0) {
        await Promise.all(
          followers.map(async (follower) => {
            try {
              const headers = await signHeaders(updateActivity, strName, strHost, follower.inbox, PRIVATE_KEY)
              await postInbox(follower.inbox, updateActivity, headers)
            } catch (err) {
              console.error(`Failed to send profile Update to follower inbox ${follower.inbox}:`, err)
            }
          })
        )
      }
    }
  } catch (err) {
    console.error('Failed to broadcast profile Update:', err)
  }

  return c.redirect('/ap')
})

app.post('/follow', async (c) => {
  const body = await c.req.parseBody()
  const handleInput = (body['handle'] as string || '').trim()
  if (!handleInput) return c.text('Invalid handle', 400)

  const strHost = new URL(c.req.url).hostname
  const strName = c.env.preferredUsername
  const PRIVATE_KEY = await importprivateKey(c.env.PRIVATE_KEY)

  try {
    let actorUrl = handleInput
    let handle = handleInput

    // If it looks like a Webfinger handle (e.g. @user@domain or user@domain)
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
      const errText = await postRes.text()
      throw new Error(`Failed to deliver Follow activity to target inbox: ${postRes.status} - ${errText}`)
    }

    // Insert as pending
    await c.env.DB.prepare(
      `INSERT OR REPLACE INTO following(id, handle, inbox, state, follow_activity_id) VALUES(?, ?, ?, ?, ?);`
    )
      .bind(targetActorId, handle, targetInbox, 'pending', followActivityId)
      .run()

    return c.redirect('/ap')
  } catch (err: any) {
    console.error(err)
    return c.text(`Error following account: ${err.message}`, 500)
  }
})

app.post('/unfollow', async (c) => {
  const body = await c.req.parseBody()
  const targetId = body['id'] as string
  if (!targetId) return c.text('Invalid target ID', 400)

  const strHost = new URL(c.req.url).hostname
  const strName = c.env.preferredUsername
  const PRIVATE_KEY = await importprivateKey(c.env.PRIVATE_KEY)

  try {
    const target = await c.env.DB.prepare(`SELECT * FROM following WHERE id = ?;`)
      .bind(targetId)
      .first<Following>()

    if (!target) return c.text('Not following this user', 404)

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

    return c.redirect('/ap')
  } catch (err: any) {
    console.error(err)
    return c.text(`Error unfollowing account: ${err.message}`, 500)
  }
})

export default app
