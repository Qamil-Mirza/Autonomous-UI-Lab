import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

export async function startFixture() {
  const html = await readFile(new URL('../fixture/index.html', import.meta.url));
  const server = createServer((req, res) => {
    if (req.url !== '/') { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No fixture server address');
  return { url: `http://127.0.0.1:${address.port}/`, close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
