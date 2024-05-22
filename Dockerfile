FROM node:22-alpine as development

RUN apk add python3 make g++

WORKDIR /usr/src/app

COPY package*.json .

RUN npm install

COPY . .

RUN npm run build

FROM node:22-alpine as production

ENV NODE_ENV=production

RUN apk add python3 make g++

WORKDIR /usr/src/app

COPY package*.json .

RUN npm ci --only=production

COPY --from=development /usr/src/app/dist ./dist

CMD ["node", "dist/app.js"]