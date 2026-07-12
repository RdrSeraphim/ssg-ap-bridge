import { Hono } from "hono";
import { serveStatic } from "hono/cloudflare-workers";
import { logger } from "hono/logger";
import ap from "./routes/ap";
import api from "./routes/api";
import webfinger from "./routes/webfinger";
import user from "./routes/user";

const app = new Hono({ strict: false });

app.use("*", logger());


app.get("/static/*", serveStatic({ root: "./" }));

app.get("/", (c) => c.text("ssg-ap-bridge ActivityPub Server"));
app.route("/.well-known/webfinger", webfinger);
app.route("/u", user);
app.route("/ap", ap);
app.route("/api", api);

export default app;
