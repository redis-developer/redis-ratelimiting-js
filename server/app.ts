import express from "express";
import session from "express-session";
import { RedisStore } from "connect-redis";
import { engine } from "express-handlebars";
import path from "path";
import { fileURLToPath } from "url";
import getClient from "./redis.js";
import { router as rateLimitRouter } from "./components/rate-limiting/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.engine(
  "hbs",
  engine({
    extname: ".hbs",
    defaultLayout: "main",
    layoutsDir: path.join(__dirname, "views", "layouts"),
    partialsDir: path.join(__dirname, "views", "partials"),
  }),
);
app.set("view engine", "hbs");
app.set("views", path.join(__dirname, "views"));

app.use(express.static(path.join(__dirname, "..", "public")));

app.use((req, res, next) => {
  if (["POST", "PUT", "PATCH"].includes(req.method)) {
    express.json({ limit: "10mb" })(req, res, next);
  } else {
    next();
  }
});

const redisClient = await getClient();

app.use(
  session({
    store: new RedisStore({ client: redisClient, prefix: "sess:" }),
    secret: process.env.SESSION_SECRET || "redis-ratelimit-demo-secret",
    resave: false,
    saveUninitialized: true,
    cookie: {
      maxAge: 1000 * 60 * 30,
      httpOnly: true,
      sameSite: "lax",
    },
  }),
);

app.get("/", (_req, res) => {
  res.render("home");
});

app.use("/api/rate-limit", rateLimitRouter);

export default app;
