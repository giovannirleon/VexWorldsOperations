FROM node:22-bookworm-slim

WORKDIR /app

COPY . .
RUN mkdir -p /app/uploads/signatures

EXPOSE 4000

CMD ["npm", "start"]
