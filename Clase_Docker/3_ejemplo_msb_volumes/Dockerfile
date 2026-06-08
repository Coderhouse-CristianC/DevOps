# STAGE: base - Instala dependencias de produccion (cacheable mientras no cambie package.json)
FROM node:22-alpine AS base
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# STAGE: source - Copia el codigo fuente (cacheable mientras no cambie el codigo)
FROM base AS source
COPY src/ ./src/

# STAGE: development - Entorno de desarrollo con devDependencies y nodemon
FROM source AS development
RUN npm install
ENV NODE_ENV=development
EXPOSE 3000
CMD ["npm", "run", "dev"]

# STAGE: production - Entorno de produccion optimizado con usuario no-root
FROM source AS production
USER node
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "src/server.js"]
