FROM node:22-alpine

# Install system dependencies needed for Prisma
RUN apk add --no-cache openssl

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm install

# Generate Prisma client library
RUN npm run prisma:generate

# Copy the rest of the application files
COPY . .

# Compile TypeScript
RUN npm run build

EXPOSE 3000

# Use non-root node user for security
USER node

CMD ["node", "dist/server.js"]
