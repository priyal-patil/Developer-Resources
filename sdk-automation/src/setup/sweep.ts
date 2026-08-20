/**
 * Manual orphan sweep: `npm run sweep [-- <maxAgeHours>]`.
 *
 * Only removes "SDK Automation - App SDK", the one stack in this project with
 * a per-run lifecycle. The Delivery, Management and Marketplace stacks are
 * persistent fixtures reused across runs (their keys live in .env), so they
 * are deliberately out of scope - see sweepOrphanAppSdkStack()'s doc comment.
 */
import "dotenv/config";
import { sweepOrphanAppSdkStack } from "./contentstack.js";

const hours = Number(process.argv[2] ?? 2);
console.log(`Sweeping "SDK Automation - App SDK" if older than ${hours}h...`);
const swept = await sweepOrphanAppSdkStack(undefined, hours * 60 * 60 * 1000);
console.log(swept ? "Swept 1 stack." : "Nothing to sweep.");
