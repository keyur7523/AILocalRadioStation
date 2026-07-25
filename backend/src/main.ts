import { NestFactory } from '@nestjs/core';
import { Logger, type LogLevel } from '@nestjs/common';
import { AppModule } from './app.module';
import { httpLogger } from './http-logger.middleware';

// Show everything by default so Render's logs surface the full picture. Dial it
// down with LOG_LEVELS, e.g. LOG_LEVELS=error,warn,log for just the essentials.
const ALL_LEVELS: LogLevel[] = ['error', 'warn', 'log', 'debug', 'verbose'];

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const levels = (
    process.env.LOG_LEVELS
      ? process.env.LOG_LEVELS.split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : ALL_LEVELS
  ) as LogLevel[];

  const app = await NestFactory.create(AppModule, { logger: levels });

  // Log every HTTP request/response.
  app.use(httpLogger);

  // The Next.js player runs on a different origin in dev, so allow it to read
  // the stream and metadata endpoints.
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? true,
  });

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  logger.log(
    `📻 Radio backend on http://localhost:${port} (stream: /stream) — log levels: [${levels.join(', ')}]`,
  );
}

// Surface anything that slips past the app's own handlers so it shows in the
// logs instead of dying silently. An uncaught exception leaves the process in an
// undefined state, so we log and exit (Render restarts the container cleanly).
process.on('unhandledRejection', (reason) => {
  new Logger('Process').error(
    `Unhandled promise rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`,
  );
});
process.on('uncaughtException', (err) => {
  new Logger('Process').error(
    `Uncaught exception: ${err.stack ?? err.message}`,
  );
  process.exit(1);
});

bootstrap().catch((err: unknown) => {
  new Logger('Bootstrap').error(
    `Failed to start: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
  );
  process.exit(1);
});
