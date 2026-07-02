import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // The Next.js player runs on a different origin in dev, so allow it to read
  // the stream and metadata endpoints.
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? true,
  });

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`📻 Radio backend on http://localhost:${port} (stream: /stream)`);
}
bootstrap();
