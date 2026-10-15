import { runMigrations } from "./db";

if (import.meta.main) {
  const applied = await runMigrations();
  if (applied.length === 0) {
    console.log("No new migrations to apply.");
  } else {
    console.log(`Applied migrations: ${applied.join(", ")}`);
  }
}
