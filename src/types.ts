export type Env = {
  Bindings: {
    DB: D1Database
    preferredUsername: string
    name: string
    PRIVATE_KEY: string
    BASIC_USERNAME: string
    BASIC_PASSWORD: string
  }
}

export type Follower = {
  id: string
  inbox: string
}

export type Following = {
  id: string
  handle: string
  inbox: string
  state: string
  follow_activity_id: string
}

export type Profile = {
  key: string
  value: string
}

export type Message = {
  id: string
  body: string
}
