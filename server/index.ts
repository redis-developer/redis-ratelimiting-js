import "dotenv/config";
import app from "./app.js";

const port = process.env.PORT ?? 8080;

app.listen(port, () => {
  console.log(`Redis rate limiting demo server listening on port ${port}`);
});
