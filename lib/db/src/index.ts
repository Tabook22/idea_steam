import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5_000,
});
// pg removes failed idle connections itself. Handle its background error event
// so a database restart does not become an uncaught error that kills the API.
pool.on("error", () => {
  // Do not log the client object: it contains connection credentials.
  console.warn("Database connection lost; the pool will reconnect on the next request.");
});
export const db = drizzle(pool, { schema });

export * from "./schema";
