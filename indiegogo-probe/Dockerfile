# Isolated Indiegogo search probe for Railway.
#
# This service intentionally does not share runtime code, database access, or
# deployment config with the main Kicksonar app. It exists only to test whether
# Railway can load Indiegogo search with a real browser.

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

COPY probe.mjs ./

ENV NODE_ENV=production
EXPOSE 8080

CMD ["xvfb-run", "-a", "--server-args=-screen 0 1920x1080x24 -ac", "node", "probe.mjs"]
