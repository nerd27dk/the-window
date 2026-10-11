import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const targets = ["index.html", "app.js", "styles.css"];
const contents = new Map();
for (const name of targets) contents.set(name, await readFile(join(root, name), "utf8"));

const html = contents.get("index.html");
const js = contents.get("app.js");
const all = [...contents.values()].join("\n");
const failures = [];
const forbid = (label, expression, text = all) => {
  if (expression.test(text)) failures.push(label);
};

const inputTags = html.match(/<input\b[^>]*>/gi) || [];
const allowedSearchInputs = new Set(["citizen-search", "object-id", "citizen-lookup"]);
const inputIds = inputTags.map((tag) => tag.match(/\bid=["\x27]([^"\x27]+)["\x27]/i)?.[1]);
const approvedSearchInputs = inputTags.length === allowedSearchInputs.size
  && inputIds.every((id) => allowedSearchInputs.has(id))
  && new Set(inputIds).size === allowedSearchInputs.size
  && inputTags.every((tag) => /\btype=["\x27]search["\x27]/i.test(tag));
if (/<textarea\b/i.test(html) || (inputTags.length > 0 && !approvedSearchInputs)) failures.push("unapproved free-text input");
forbid("form element", /<form\b/i, html);
forbid("authorization header", /authorization\s*[:=]/i);
forbid("browser storage", /\b(?:localStorage|sessionStorage|indexedDB)\b/);
forbid("HTML string parsing", /\.(?:innerHTML|outerHTML)\s*=/);
forbid("write method literal", /method\s*:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i, js);
forbid("wallet integration", /\b(?:ethereum\.request|walletconnect|sendTransaction)\b/i);
forbid("analytics beacon", /\b(?:sendBeacon|gtag|mixpanel|segment)\b/i);

if (!/const API_ORIGIN="https:\/\/1f916\.ai";/.test(js)) failures.push("exact API origin pin missing");
if (!/method:"GET"/.test(js)) failures.push("explicit GET method missing");
if (!/url\.origin!==API_ORIGIN/.test(js)) failures.push("origin refusal missing");
if (!/textContent=/.test(js)) failures.push("safe text insertion evidence missing");
if (!/connect-src https:\/\/1f916\.ai/.test(html)) failures.push("CSP connect boundary missing");

if (failures.length) {
  console.error("READ-ONLY CHECK FAILED");
  for (const failure of failures) console.error("- " + failure);
  process.exitCode = 1;
} else {
  console.log("READ-ONLY CHECK PASSED");
  for (const [name, value] of contents) {
    console.log(name + " sha256=" + createHash("sha256").update(value).digest("hex"));
  }
}
