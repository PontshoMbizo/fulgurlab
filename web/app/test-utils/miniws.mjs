// Minimal RFC-6455 WebSocket SERVER for tests — no dependencies. Text frames only,
// payloads < 64 KB, client→server frames masked (per spec), server→client unmasked.
// Just enough to unit-test war/fulgur-bridge.js without pulling `ws` into fulgurlab.

import { createServer } from "node:http";
import { createHash } from "node:crypto";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export function startMiniWs(onConnection) {
  const server = createServer();
  const sockets = new Set();

  server.on("upgrade", (req, socket) => {
    const key = req.headers["sec-websocket-key"];
    const accept = createHash("sha1").update(key + GUID).digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    sockets.add(socket);

    const conn = {
      send(text) {
        const payload = Buffer.from(text, "utf8");
        let header;
        if (payload.length < 126) {
          header = Buffer.from([0x81, payload.length]);
        } else {
          header = Buffer.alloc(4);
          header[0] = 0x81;
          header[1] = 126;
          header.writeUInt16BE(payload.length, 2);
        }
        socket.write(Buffer.concat([header, payload]));
      },
      close() {
        try { socket.write(Buffer.from([0x88, 0x00])); } catch {}
        socket.destroy();
      },
      onmessage: null,
      onclose: null,
    };

    let buf = Buffer.alloc(0);
    socket.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (buf.length < 2) return;
        const opcode = buf[0] & 0x0f;
        const masked = (buf[1] & 0x80) !== 0;
        let len = buf[1] & 0x7f;
        let off = 2;
        if (len === 126) {
          if (buf.length < 4) return;
          len = buf.readUInt16BE(2);
          off = 4;
        } else if (len === 127) {
          return conn.close(); // oversized — not needed for tests
        }
        const maskLen = masked ? 4 : 0;
        if (buf.length < off + maskLen + len) return;
        const mask = masked ? buf.slice(off, off + 4) : null;
        const payload = buf.slice(off + maskLen, off + maskLen + len);
        if (masked) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
        buf = buf.slice(off + maskLen + len);
        if (opcode === 0x8) { conn.onclose?.(); return conn.close(); }
        if (opcode === 0x9) { // ping → pong
          socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload]));
          continue;
        }
        if (opcode === 0x1) conn.onmessage?.(payload.toString("utf8"));
      }
    });
    socket.on("error", () => {});
    socket.on("close", () => { sockets.delete(socket); conn.onclose?.(); });

    onConnection(conn);
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        url: `ws://127.0.0.1:${server.address().port}/`,
        close: () => new Promise((r) => {
          for (const s of sockets) s.destroy();
          server.close(() => r());
        }),
      });
    });
  });
}
