import 'dotenv/config';
import { createApp } from './app.js';

const { app, config, close } = createApp();

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`Intranet Feedback Portal listening on http://0.0.0.0:${config.port}`);
  console.log(`Data directory: ${config.dataDir}`);
});

function shutdown(signal: string): void {
  console.log(`Received ${signal}, shutting down...`);
  server.close(() => {
    close();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
