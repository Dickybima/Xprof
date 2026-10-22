import { SPIDERPAD_X_URL, SPIDER_TOKEN } from "./config.js";

for (const a of document.querySelectorAll(".x-link")) a.href = SPIDERPAD_X_URL;
for (const a of document.querySelectorAll(".spider-link")) {
  a.href = `token.html?address=${SPIDER_TOKEN}`;
  const viewing = new URLSearchParams(location.search).get("address");
  if (location.pathname.endsWith("token.html") && viewing?.toLowerCase() === SPIDER_TOKEN.toLowerCase()) a.classList.add("active");
}
