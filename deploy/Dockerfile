FROM node:22-bookworm-slim
WORKDIR /app
COPY --chown=node:node dist ./dist
COPY --chown=node:node host ./host
RUN chmod -R a=rX dist host
USER node
ENV WEB_PORT=8080 BIND=0.0.0.0
EXPOSE 8080
CMD ["node", "host/start.mjs"]
