import { SPIDERPAD_X_URL, SPIDER_TOKEN } from "./config.js";

for (const a of document.querySelectorAll(".x-link")) a.href = SPIDERPAD_X_URL;
for (const a of document.querySelectorAll(".spider-link")) {
  if (!SPIDER_TOKEN) {
    // Not launched yet: the button only says so.
    a.classList.add("soon");
    a.addEventListener("click", (e) => {
      e.preventDefault();
      if (a.dataset.label) return;
      a.dataset.label = a.textContent;
      a.textContent = "Coming soon";
      setTimeout(() => { a.textContent = a.dataset.label; delete a.dataset.label; }, 1600);
    });
    continue;
  }
  a.href = `token.html?address=${SPIDER_TOKEN}`;
  const viewing = new URLSearchParams(location.search).get("address");
  if (location.pathname.endsWith("token.html") && viewing?.toLowerCase() === SPIDER_TOKEN.toLowerCase()) a.classList.add("active");
}
