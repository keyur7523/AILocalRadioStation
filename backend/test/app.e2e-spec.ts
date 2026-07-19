import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('StreamController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/health (GET) is ok', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok' });
  });

  it('/station (GET) returns the on-air identity', () => {
    return request(app.getHttpServer())
      .get('/station')
      .expect(200)
      .expect((res) => {
        const body = res.body as Record<string, unknown>;
        expect(typeof body.name).toBe('string');
        expect(typeof body.frequency).toBe('string');
        expect(typeof body.listeners).toBe('number');
        expect(typeof body.online).toBe('boolean');
      });
  });

  afterEach(async () => {
    await app.close();
  });
});
