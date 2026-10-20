import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';

describe('QuestionsController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('rejects unauthenticated question creation', () => {
    return request(app.getHttpServer()).post('/questions').send({}).expect(401);
  });

  it('rejects unauthenticated question reads', () => {
    return request(app.getHttpServer())
      .get('/questions/0196c6c5-7d76-7b23-8f22-530ff8ecf6a1')
      .expect(401);
  });

  it.each([
    '/questions/0196c6c5-7d76-7b23-8f22-530ff8ecf6a1/ready',
    '/questions/0196c6c5-7d76-7b23-8f22-530ff8ecf6a1/versions',
    '/questions/0196c6c5-7d76-7b23-8f22-530ff8ecf6a1/versions/1',
  ])('rejects unauthenticated ready and version reads from %s', async (path) => {
    await request(app.getHttpServer()).get(path).expect(401);
  });

  afterEach(async () => {
    await app.close();
  });
});
