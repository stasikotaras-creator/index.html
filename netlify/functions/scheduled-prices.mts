import type { Config } from "@netlify/functions";
import { runCycle } from "../../lib/simulation.js";

// Fetches verified prices and runs the paper-trading rules every 15 minutes on weekdays (UTC).
// Each run is recorded in fetch_runs with trigger "schedule", which the dashboard reports.
export default async () => {
  try {
    const result = await runCycle("schedule");
    console.log("scheduled price run", JSON.stringify(result));
  } catch (err) {
    console.error("scheduled price run failed", err);
  }
};

// Keep in sync with SCHEDULE_CRON in lib/simulation.ts (must be a literal here).
export const config: Config = { schedule: "*/15 * * * 1-5" };
