import { glaze } from 'glaze-cms';

// Auto-loads glaze.config.ts, converges the database to `schema.ts`, wires auth, generates a CRUD API
// for every table (authors, posts), and starts listening (GLAZE_PORT, default 4000).
await glaze();
