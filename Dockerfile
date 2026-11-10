# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY sdk-js/tsconfig.base.json ./sdk-js/tsconfig.base.json
COPY sdk-js/packages/core/ ./sdk-js/packages/core/
COPY sdk-js/packages/postgres/ ./sdk-js/packages/postgres/
COPY console/package*.json ./console/
WORKDIR /app/console
RUN npm ci
COPY console/ ./
RUN ln -s ../console/node_modules /app/sdk-js/node_modules \
    && npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
LABEL org.opencontainers.image.source="https://github.com/GameSetAndMatch/openentitlement" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.description="OpenEntitlement reference service and administration console"
ENV NODE_ENV=production OE_HOST=0.0.0.0 PORT=8787
WORKDIR /app/console
COPY --from=build /app/console/node_modules ./node_modules
COPY --from=build /app/console/package.json ./package.json
COPY --from=build /app/console/server ./server
COPY --from=build /app/console/web/dist ./web/dist
COPY --from=build /app/sdk-js/packages/core /app/sdk-js/packages/core
COPY --from=build /app/sdk-js/packages/postgres /app/sdk-js/packages/postgres
RUN ln -s ../console/node_modules /app/sdk-js/node_modules
COPY spec/assets/catalog.json spec/assets/plans.json /app/spec/assets/
COPY LICENSE /app/LICENSE
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "--conditions=source", "server/main.ts"]
