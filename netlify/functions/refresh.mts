import { drain } from "../../lib/notifications.js";
import type { Config } from "@netlify/functions";
import { runCycle } from "../../lib/simulation.js";

// Lets an open dashboard request a refresh when data is stale (throttled server-side,
// so it never calls the provider more often than the scheduled interval).
export default async () => {
  try {
    const result = await runCycle("dashboard");
    await drain();
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("refresh failed", err);
    return Response.json({ ran: false, reason: "Refresh failed." }, { status: 500 });
  }
};

export const config: Config = { path: "/api/refresh", method: "POST" };
