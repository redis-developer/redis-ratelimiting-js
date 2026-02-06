import express from "express";
import { engine } from "express-handlebars";
import path from "path";
import { fileURLToPath } from "url";
import { router as rateLimitRouter } from "./components/rate-limiting/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Handlebars view engine
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

// Body parsing for POST/PUT/PATCH
app.use((req, res, next) => {
  if (["POST", "PUT", "PATCH"].includes(req.method)) {
    express.json({ limit: "10mb" })(req, res, next);
  } else {
    next();
  }
});

// Home page
app.get("/", (_req, res) => {
  res.render("home");
});

// API routes
app.use("/api/rate-limit", rateLimitRouter);

export default app;
