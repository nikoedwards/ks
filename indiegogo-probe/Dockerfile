# Isolated Indiegogo Cloudflare-bypass enumeration worker for Railway.
#
# Runs a headed Chrome (under Xvfb) via puppeteer-real-browser to clear
# Cloudflare Turnstile, then serves the main Kicksonar app's enumeration calls
# (POST /search). Deploy two instances with INDIEGOGO_WORKER_ROLE=live and
# INDIEGOGO_WORKER_ROLE=bulk so discovery and backlog never share a browser lane.

FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /app

# Xvfb lets Railway run a headful Chrome session. Real Chrome gives a cleaner
# browser fingerprint than the bundled Chromium when testing Cloudflare gates.
RUN apt-get update \
 && apt-get install -y --no-install-recommends xvfb wget gnupg ca-certificates \
 && wget -qO- https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
 && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends google-chrome-stable \
 && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev

COPY worker.mjs ./

ENV NODE_ENV=production
EXPOSE 8080

CMD ["xvfb-run", "-a", "--server-args=-screen 0 1920x1080x24 -ac", "node", "worker.mjs"]
