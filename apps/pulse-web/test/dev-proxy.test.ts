import { createServer as createHttpServer } from "node:http";
import { createServer as createViteServer, mergeConfig } from "vite";
import { expect, it } from "vitest";
import config from "../vite.config.js";

it("preserves the browser Host through the real dev proxy for mailbox access", async () => {
  let expectedHost = "";
  const api = createHttpServer((request, response) => {
    response.statusCode = request.headers.host === expectedHost ? 200 : 403;
    response.end("mailbox");
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  const address = api.address();
  if (!address || typeof address === "string")
    throw new Error("API did not bind");
  const web = await createViteServer(
    mergeConfig(config, {
      configFile: false,
      logLevel: "silent",
      server: {
        host: "127.0.0.1",
        port: 0,
        hmr: false,
        proxy: { "/api": { target: `http://127.0.0.1:${address.port}` } },
      },
    }),
  );
  try {
    await web.listen();
    const webAddress = web.httpServer?.address();
    if (!webAddress || typeof webAddress === "string")
      throw new Error("Web did not bind");
    expectedHost = `127.0.0.1:${webAddress.port}`;
    const response = await fetch(`http://${expectedHost}/api/dev/mailbox`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("mailbox");
  } finally {
    await web.close();
    await new Promise<void>((resolve, reject) =>
      api.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
