import { drainQueue } from "../lib/gmailQueue.js";

const result = await drainQueue({ limit: 10 });
console.log(JSON.stringify(result));
if (result.errors.length) process.exitCode = 1;
