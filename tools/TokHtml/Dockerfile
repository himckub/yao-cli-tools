FROM node:25-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
ENV TOKHTML_DATA_DIR=/app/data
ENV TOKHTML_WATCH_DIRS=/watch/html-inbox

EXPOSE 8080

CMD ["npm", "start"]
