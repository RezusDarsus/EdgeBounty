FROM node:26-slim
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY services/dataset-validator ./services/dataset-validator
COPY services/model-validator ./services/model-validator
# dev deps kept: the API runs through tsx (a root devDependency)
RUN npm ci --workspaces --include-workspace-root --ignore-scripts=false \
 && apt-get update && apt-get install -y --no-install-recommends docker.io && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production SANDBOX=docker HOST=0.0.0.0 PORT=4000
EXPOSE 4000
USER node
CMD ["npx", "tsx", "apps/api/src/server.ts"]
