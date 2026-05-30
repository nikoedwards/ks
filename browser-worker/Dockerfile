FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /app

# Add Xvfb (virtual display) + real Google Chrome. Proven by the cf-probe
# experiment: headful real Chrome under Xvfb clears Cloudflare on Railway's
# datacenter IP at ~100% with no paid proxy, where headless Chromium is flakier
# (lower rewards/creator render success).
RUN apt-get update \
 && apt-get install -y --no-install-recommends xvfb wget gnupg ca-certificates \
 && wget -qO- https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
 && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends google-chrome-stable \
 && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev

COPY server.js ./

ENV NODE_ENV=production
# Run real Chrome, headful, under Xvfb by default (best CF clearance).
# Override with BROWSER_HEADLESS_MODE=new / old and BROWSER_CHROME_CHANNEL="".
ENV BROWSER_HEADLESS_MODE=false
ENV BROWSER_CHROME_CHANNEL=chrome
EXPOSE 8080

# `npm start` is wrapped in xvfb-run (see package.json) so headful Chrome has a
# display even on Railway's headless container.
CMD ["npm", "start"]
