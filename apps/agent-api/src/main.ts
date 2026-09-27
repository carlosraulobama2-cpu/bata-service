import { loadEnv } from './config/env';
import { createApp } from './bootstrap';
import { JobsService } from './common/jobs.service';

async function main(): Promise<void> {
  const env = loadEnv();
  const app = await createApp(env);
  app.get(JobsService).start();
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start Agent API:', err instanceof Error ? err.message : err);
  process.exit(1);
});
