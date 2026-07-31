import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import { WebSocketServer } from "ws";
import { getRequestListener } from "@hono/node-server";
import { buildApp } from "./app.js";
import { env } from "./env.js";
import { bus } from "./ws/bus.js";

const app = buildApp();
const server = createServer(getRequestListener(app.fetch));

const wss = new WebSocketServer({ server });

wss.on("connection", (socket, req: IncomingMessage) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const channels = url.searchParams.getAll("channel");
  if (!channels.length) {
    socket.close(1008, "channel required");
    return;
  }

  const unsubs = channels.map((channel) =>
    bus.subscribe(channel, (payload) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ channel, ...(payload as object) }));
      }
    }),
  );

  socket.send(JSON.stringify({ type: "subscribed", channels }));
  socket.on("close", () => unsubs.forEach((u) => u()));
});

server.listen(env.port, () => {
  console.log(`Unipad API on http://localhost:${env.port} (mock=${env.devMock})`);
});
