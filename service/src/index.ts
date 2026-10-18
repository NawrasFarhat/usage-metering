import { config } from "./config.js";
import { runMigrations } from "./db/migrate.js";
import { createApp } from "./app.js";

await runMigrations();

createApp().listen(config.port, () => {
  console.log(`Metering service listening on http://localhost:${config.port}`);
});