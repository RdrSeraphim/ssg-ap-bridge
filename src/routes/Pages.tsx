import { html } from "hono/html";
import { Message, Follower, Following } from "../types";

type ProfileData = {
  displayName: string;
  bio: string;
  avatarUrl: string;
  coverUrl: string;
  profileFields: { name: string; value: string }[];
  postTemplate: string;
};

export const Top = (props: {
  messages: Message[];
  followers: Follower[];
  following: Following[];
  profile: ProfileData;
  username: string;
  host: string;
}) => {
  return (
    <Layout
      displayName={props.profile.displayName}
      username={props.username}
      host={props.host}
    >
      <header style={{ marginBottom: "2rem" }}>
        {props.profile.coverUrl && (
          <div style={{
            width: "100%",
            height: "160px",
            borderRadius: "8px",
            backgroundImage: `url(${props.profile.coverUrl})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            marginBottom: "1.5rem",
            border: "1px solid var(--card-border-color)"
          }} />
        )}
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <img
            src={props.profile.avatarUrl}
            alt="Avatar"
            style={{
              width: "80px",
              height: "80px",
              borderRadius: "50%",
              objectFit: "cover",
              border: "2px solid var(--primary)",
            }}
          />
          <div>
            <hgroup style={{ margin: 0 }}>
              <h2>{props.profile.displayName}</h2>
              <p>
                @{props.username}@{props.host}
              </p>
            </hgroup>
            {props.profile.bio && (
              <p
                style={{
                  margin: "0.5rem 0 0 0",
                  fontStyle: "italic",
                  fontSize: "0.9rem",
                }}
              >
                {props.profile.bio}
              </p>
            )}
          </div>
        </div>
      </header>

      <div class="grid">
        {/* Left Column: Profile settings, Follow new users, and Active followings */}
        <div>
          <article>
            <header>
              <strong>Profile Settings</strong>
            </header>
            <form action="/ap/profile" method="post">
              <label>
                Display Name
                <input
                  type="text"
                  name="display_name"
                  value={props.profile.displayName}
                  placeholder="e.g. My Blog"
                  required
                />
              </label>
              <label>
                Bio / Summary
                <textarea
                  name="bio"
                  rows={2}
                  placeholder="e.g. ActivityPub bot posting RSS updates from example.com"
                >
                  {props.profile.bio}
                </textarea>
              </label>
              <label>
                Avatar URL
                <input
                  type="url"
                  name="avatar_url"
                  value={props.profile.avatarUrl}
                  placeholder="https://example.com/images/avatar.png"
                  required
                />
              </label>
              <label>
                Cover Image URL
                <input
                  type="url"
                  name="cover_url"
                  value={props.profile.coverUrl || ""}
                  placeholder="https://example.com/images/cover.png"
                />
              </label>
              <label style={{ marginBottom: "1.5rem" }}>
                Profile Links/Metadata (up to 4)
                <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "0.5rem", marginBottom: "0.5rem" }}>
                  <small><strong>Label</strong></small>
                  <small><strong>Value (Link or Text)</strong></small>
                </div>
                {[1, 2, 3, 4].map((idx) => {
                  const field = props.profile.profileFields[idx - 1] || { name: "", value: "" };
                  return (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "0.5rem", marginBottom: "0.5rem" }}>
                      <input
                        type="text"
                        name={`field_${idx}_label`}
                        placeholder="e.g. GitHub"
                        value={field.name}
                        style={{ marginBottom: 0 }}
                      />
                      <input
                        type="text"
                        name={`field_${idx}_value`}
                        placeholder="e.g. https://github.com/username"
                        value={field.value}
                        style={{ marginBottom: 0 }}
                      />
                    </div>
                  );
                })}
              </label>
              <label>
                Post Template (RSS Sync)
                <textarea
                  name="post_template"
                  rows={3}
                  placeholder="**{title}**\n\n{description}\n\n{link}"
                  required
                >
                  {props.profile.postTemplate}
                </textarea>
                <small
                  style={{
                    display: "block",
                    marginTop: "-0.5rem",
                    marginBottom: "1rem",
                    color: "var(--muted-color)",
                  }}
                >
                  Placeholders: <code>{`{title}`}</code>,{" "}
                  <code>{`{description}`}</code>, <code>{`{link}`}</code>
                </small>
              </label>
              <button type="submit" class="contrast">
                Save Profile
              </button>
            </form>
          </article>

          <article>
            <header>
              <strong>Follow Another Account</strong>
            </header>
            <form action="/ap/follow" method="post">
              <label>
                Username Handle or Actor IRI
                <input
                  type="text"
                  name="handle"
                  placeholder="e.g. @user@mastodon.social or Actor URL"
                  required
                />
              </label>
              <button type="submit">Follow</button>
            </form>
          </article>

          <article>
            <header
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <strong>Following ({props.following.length})</strong>
              <small>Followers: {props.followers.length}</small>
            </header>
            {props.following.length === 0 ? (
              <p style={{ margin: 0 }}>
                <small>You aren't following anyone yet.</small>
              </p>
            ) : (
              <ul style={{ paddingLeft: "1rem", margin: 0 }}>
                {props.following.map((user) => (
                  <li
                    style={{ marginBottom: "0.75rem", listStyleType: "none" }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div>
                        <strong>{user.handle}</strong>
                        <br />
                        <span
                          style={{
                            fontSize: "0.8rem",
                            color: "var(--muted-color)",
                          }}
                        >
                          State:{" "}
                          {user.state === "accepted"
                            ? "✅ Accepted"
                            : "⏳ Pending"}
                        </span>
                      </div>
                      <form
                        action="/ap/unfollow"
                        method="post"
                        style={{ margin: 0 }}
                      >
                        <input type="hidden" name="id" value={user.id} />
                        <button
                          type="submit"
                          class="secondary outline"
                          style={{
                            padding: "2px 8px",
                            fontSize: "0.8rem",
                            width: "auto",
                            margin: 0,
                          }}
                        >
                          Unfollow
                        </button>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </article>
        </div>

        {/* Right Column: Post note & Recent broadcast feed */}
        <div>
          <article>
            <header>
              <strong>Broadcast a Note</strong>
            </header>
            <form action="/ap/post" method="post">
              <label>
                What's on your mind? (Will be sent to all followers)
                <textarea
                  name="body"
                  rows={4}
                  placeholder="Type a message to post..."
                  required
                ></textarea>
              </label>
              <button type="submit">Publish Post</button>
            </form>
          </article>

          <h3>Recent Broadcasts</h3>
          {props.messages.length === 0 ? (
            <p>
              <small>No posts broadcasted yet.</small>
            </p>
          ) : (
            props.messages
              .slice()
              .reverse()
              .map((message) => (
                <article style={{ padding: "1rem", marginBottom: "1rem" }}>
                  <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>
                    {message.body}
                  </p>
                  <footer
                    style={{
                      padding: "0.5rem 0 0 0",
                      marginTop: "0.5rem",
                      fontSize: "0.8rem",
                      borderTop: "1px solid var(--muted-border-color)",
                    }}
                  >
                    ID:{" "}
                    <code style={{ fontSize: "0.75rem" }}>{message.id}</code>
                  </footer>
                </article>
              ))
          )}
        </div>
      </div>
    </Layout>
  );
};

const Layout = (props: {
  displayName: string;
  username: string;
  host: string;
  children: any;
}) => html`<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${props.displayName} (@${props.username}@${props.host}) - ActivityPub Admin</title>
      <link rel="stylesheet" href="https://unpkg.com/@picocss/pico@latest/css/pico.min.css" />
      <style>
        body {
          padding-top: 2rem;
          padding-bottom: 4rem;
        }
        article {
          margin-bottom: 1.5rem;
        }
        .grid {
          grid-template-columns: 1fr 1fr;
        }
        @media (max-width: 991px) {
          .grid {
            grid-template-columns: 1fr;
          }
        }
      </style>
    </head>
    <body>
      <main class="container">
        <nav style={{ marginBottom: '1.5rem', borderBottom: '1px solid var(--muted-border-color)' }}>
          <ul>
            <li><strong><a href="/ap" class="contrast">ssg-ap-bridge Admin Portal</a></strong></li>
          </ul>
          <ul>
            <li><a href="https://${props.host}" target="_blank">View Website</a></li>
          </ul>
        </nav>
        ${props.children}
      </main>
    </body>
  </html>`;
