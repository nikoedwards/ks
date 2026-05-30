# Throwaway Cloudflare feasibility probe for Railway.
#
# Goal: measure, on Railway's datacenter IP and with ZERO paid proxy, whether we
# can clear Cloudflare's managed challenge using free levers the production
# worker doesn't yet use:
#   - real Google Chrome (cleaner TLS/JA3 + fingerprint than bundled Chromium)
#   - HEADFUL Chrome under Xvfb (a virtual display) — CF clears headful far more
#     reliably than headless on hostile (datacenter) IPs.
#
# Base image already ships Playwright + all the chromium OS deps.
FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /app

# Add Xvfb (virtual framebuffer so we can run a *headful* browser on a headless
# server) and real Google Chrome stable.
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

# Run the whole process under a virtual X display so headful Chrome works.
CMD ["xvfb-run", "-a", "--server-args=-screen 0 1920x1080x24 -ac", "node", "probe.mjs"]
