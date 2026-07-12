/**
 * Based on Matchbox
 * Matchbox https://gitlab.com/acefed/matchbox Copyright (c) 2022 Acefed MIT License
 */

import { Hono } from 'hono'
import { Env, Follower, Following } from '../types'
import { exportPublicKey, importprivateKey, privateKeyToPublicKey } from '../utils'
import { acceptFollow, getInbox } from '../logic'

const app = new Hono<Env>()

app.get(':strName', async (c) => {
  const strName = c.req.param('strName')
  const strHost = new URL(c.req.url).hostname

  if (strName !== c.env.preferredUsername) return c.notFound()

  let displayName = c.env.name
  let bio = ''
  let avatarUrl = `https://${strHost}/static/icon.png`
  let coverUrl = ''
  let dbFields: string | null = null
  let isBot = false

  try {
    const dbName = await c.env.DB.prepare(`SELECT value FROM profile WHERE key = 'display_name';`).first<string>('value')
    const dbBio = await c.env.DB.prepare(`SELECT value FROM profile WHERE key = 'bio';`).first<string>('value')
    const dbAvatar = await c.env.DB.prepare(`SELECT value FROM profile WHERE key = 'avatar_url';`).first<string>('value')
    const dbCover = await c.env.DB.prepare(`SELECT value FROM profile WHERE key = 'cover_url';`).first<string>('value')
    const dbIsBot = await c.env.DB.prepare(`SELECT value FROM profile WHERE key = 'is_bot';`).first<string>('value')
    dbFields = await c.env.DB.prepare(`SELECT value FROM profile WHERE key = 'profile_fields';`).first<string>('value')
    if (dbName) displayName = dbName
    if (dbBio) bio = dbBio
    if (dbAvatar) avatarUrl = dbAvatar
    if (dbCover) coverUrl = dbCover
    if (dbIsBot) isBot = dbIsBot === 'true'
  } catch (err) {
    console.error('Failed to load profile settings from DB:', err)
  }

  if (!c.req.header('Accept')?.includes('application/activity+json')) {
    return c.text(`${strName}: ${displayName}`)
  }

  const PRIVATE_KEY = await importprivateKey(c.env.PRIVATE_KEY)
  const PUBLIC_KEY = await privateKeyToPublicKey(PRIVATE_KEY)
  const public_key_pem = await exportPublicKey(PUBLIC_KEY)

  let attachment: any[] = []
  if (dbFields) {
    try {
      const parsedFields = JSON.parse(dbFields) as { name: string; value: string }[]
      attachment = parsedFields.map((f) => ({
        type: 'PropertyValue',
        name: f.name,
        value: f.value.startsWith('http')
          ? `<a href="${f.value}" target="_blank" rel="nofollow noopener noreferrer me">${f.value}</a>`
          : f.value,
      }))
    } catch (e) {
      console.error('Failed to parse profile fields:', e)
    }
  }

  if (attachment.length === 0) {
    attachment = [
      {
        type: 'PropertyValue',
        name: 'Blog',
        value: `<a href="https://${strHost}" target="_blank" rel="nofollow noopener noreferrer me">https://${strHost}</a>`,
      },
    ]
  }

  const r = {
    '@context': ['https://www.w3.org/ns/activitystreams', 'https://w3id.org/security/v1'],
    id: `https://${strHost}/u/${strName}`,
    type: isBot ? 'Service' : 'Person',
    inbox: `https://${strHost}/u/${strName}/inbox`,
    followers: `https://${strHost}/u/${strName}/followers`,
    following: `https://${strHost}/u/${strName}/following`,
    preferredUsername: strName,
    name: displayName,
    summary: bio,
    url: `https://${strHost}/u/${strName}`,
    discoverable: true,
    manuallyApprovesFollowers: false,
    publicKey: {
      id: `https://${strHost}/u/${strName}#main-key-v2`,
      type: 'Key',
      owner: `https://${strHost}/u/${strName}`,
      publicKeyPem: public_key_pem,
    },
    icon: {
      type: 'Image',
      mediaType: 'image/png',
      url: avatarUrl,
    },
    image: coverUrl ? {
      type: 'Image',
      mediaType: 'image/png',
      url: coverUrl,
    } : undefined,
    attachment
  }

  return c.json(r, 200, { 'Content-Type': 'application/activity+json' })
})

app.get(':strName/inbox', (c) => c.body(null, 405))
app.post(':strName/inbox', async (c) => {
  const strName = c.req.param('strName')
  const strHost = new URL(c.req.url).hostname

  if (strName !== c.env.preferredUsername) return c.notFound()
  if (!c.req.header('Content-Type')?.includes('application/activity+json')) return c.body(null, 400)
  const y = await c.req.json<any>()
  if (new URL(y.actor).protocol !== 'https:') return c.body(null, 400)

  const x = await getInbox(y.actor) as any
  if (!x) return c.body(null, 500)

  const private_key = await importprivateKey(c.env.PRIVATE_KEY)

  if (y.type === 'Follow') {
    const actor = y.actor
    await c.env.DB.prepare(`INSERT OR REPLACE INTO follower(id, inbox) VALUES(?, ?);`).bind(actor, x.inbox).run()
    await acceptFollow(strName, strHost, x.inbox, y, private_key)
    return c.body(null)
  }

  if (y.type === 'Undo') {
    const z = y.object
    if (z.type === 'Follow') {
      await c.env.DB.prepare(`DELETE FROM follower WHERE id = ?;`).bind(y.actor).run()
      return c.body(null)
    }
  }

  if (y.type === 'Accept') {
    const followActivity = y.object
    if (followActivity && followActivity.type === 'Follow') {
      const targetActorIri = y.actor
      await c.env.DB.prepare(`UPDATE following SET state = 'accepted' WHERE id = ?;`)
        .bind(targetActorIri)
        .run()
      return c.body(null)
    }
  }

  // Acknowledge other activity types with a 202 Accepted to prevent delivery retries from federated instances
  return c.body(null, 202)
})

app.get(':strName/followers', async (c) => {
  const strName = c.req.param('strName')
  const strHost = new URL(c.req.url).hostname
  if (strName !== c.env.preferredUsername) return c.notFound()

  const { results: rawFollowers } = await c.env.DB.prepare(`SELECT * FROM follower;`).all<Follower>()
  const followers = rawFollowers || []

  const items = followers.map(({ id }) => id)

  const r = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `https://${strHost}/u/${strName}/followers`,
    type: 'OrderedCollection',
    first: {
      type: 'OrderedCollectionPage',
      totalItems: followers.length,
      partOf: `https://${strHost}/u/${strName}/followers`,
      orderedItems: items,
      id: `https://${strHost}/u/${strName}/followers?page=1`,
    },
  }

  return c.json(r, 200, { 'Content-Type': 'application/activity+json' })
})

app.get(':strName/following', async (c) => {
  const strName = c.req.param('strName')
  const strHost = new URL(c.req.url).hostname
  if (strName !== c.env.preferredUsername) return c.notFound()

  const { results: rawFollowing } = await c.env.DB.prepare(`SELECT * FROM following WHERE state = 'accepted';`).all<Following>()
  const following = rawFollowing || []

  const items = following.map(({ id }) => id)

  const r = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `https://${strHost}/u/${strName}/following`,
    type: 'OrderedCollection',
    first: {
      type: 'OrderedCollectionPage',
      totalItems: following.length,
      partOf: `https://${strHost}/u/${strName}/following`,
      orderedItems: items,
      id: `https://${strHost}/u/${strName}/following?page=1`,
    },
  }

  return c.json(r, 200, { 'Content-Type': 'application/activity+json' })
})

export default app
