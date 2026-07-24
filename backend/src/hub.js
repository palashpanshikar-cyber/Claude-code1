// Tiny pub/sub hub so REST routes can push live updates to WebSocket clients
// without importing the WebSocketServer instance directly.
const clients = new Set();

export function registerClient(ws) {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
}

export function broadcast(event) {
  const payload = JSON.stringify(event);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
}
