import { createServer } from './server.js';
import { env } from './config/env.js';

const app = createServer();

app.listen(env.PORT, () => {
  console.log(`[api] Steward AI API listening on http://localhost:${env.PORT}`);
});
