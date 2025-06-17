# Dockerfile
FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY ../ ./

COPY ../creds.json /config/creds.json

#NOT adding creds.json into the image
RUN rm -f creds.json

EXPOSE 3000
CMD ["node", "server/server.js"]
