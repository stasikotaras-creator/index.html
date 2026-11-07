import type { Config } from "@netlify/functions";
import { runCycle } from "../../lib/simulation.js";

// Fetches verified prices and runs the paper-trading rules every 15 minutes on weekdays (UTC).
export default async () => {
  const result = await runCycle("schedule");
  console.log("scheduled price run", JSON.stringify(result));
};

export const config: Config = { schedule: "*/15 * * * 1-5" };
