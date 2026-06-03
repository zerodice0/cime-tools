import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "poll due CI.ME channels",
  { minutes: 1 },
  internal.polling.pollDueMonitors,
);

export default crons;
