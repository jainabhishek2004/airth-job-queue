import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { JobStatus } from '@prisma/client';

/**
 * Integration test: concurrent state transitions against Neon/PostgreSQL.
 *
 * Unlike the unit tests in jobs.service.spec.ts (which simulate a DB race by
 * controlling mock return values), this suite fires real HTTP requests against
 * a live NestJS application backed by the actual Neon PostgreSQL database.
 *
 * The atomic conditional UPDATE (updateMany WHERE status = <expected>) is the
 * mechanism under test.  The database serialises concurrent requests at the
 * storage layer, guaranteeing that at most one wins.
 *
 * Limitation: Node.js Promise.all is not truly parallel – both requests are
 * dispatched near-simultaneously over the network but are still subject to
 * scheduling.  In practice this is sufficient to exercise the DB-level
 * atomicity on a remote Neon instance.  A guaranteed race would require a
 * load-testing tool (e.g. k6) or a local PgBouncer setup, which is out of
 * scope for this phase.
 *
 * Prerequisites: DATABASE_URL must resolve to a reachable PostgreSQL instance
 * (satisfied by the project's .env pointing at Neon).
 */
describe('Jobs concurrency (e2e - live PostgreSQL)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    await prisma.job.deleteMany({
      where: { title: { startsWith: '__concurrency_test__' } },
    });
  });

  // --------------------------------------------------------------------------
  // Happy-path sequential transitions
  // --------------------------------------------------------------------------

  it('pending -> running -> completed: all three steps return 200', async () => {
    const { body: job } = await request(app.getHttpServer())
      .post('/jobs')
      .send({ title: '__concurrency_test__ lifecycle', type: 'test' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/jobs/${job.id}/status`)
      .send({ status: JobStatus.running })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/jobs/${job.id}/status`)
      .send({ status: JobStatus.completed })
      .expect(200);
  });

  it('pending -> running -> failed: all three steps return 200', async () => {
    const { body: job } = await request(app.getHttpServer())
      .post('/jobs')
      .send({ title: '__concurrency_test__ lifecycle-failed', type: 'test' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/jobs/${job.id}/status`)
      .send({ status: JobStatus.running })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/jobs/${job.id}/status`)
      .send({ status: JobStatus.failed })
      .expect(200);
  });

  // --------------------------------------------------------------------------
  // Concurrent pending -> running: real DB race
  // --------------------------------------------------------------------------

  it('two simultaneous pending->running requests yield exactly one 200 and one 409', async () => {
    const { body: job } = await request(app.getHttpServer())
      .post('/jobs')
      .send({ title: '__concurrency_test__ concurrent-claim', type: 'test' })
      .expect(201);

    const [res1, res2] = await Promise.all([
      request(app.getHttpServer())
        .patch(`/jobs/${job.id}/status`)
        .send({ status: JobStatus.running }),
      request(app.getHttpServer())
        .patch(`/jobs/${job.id}/status`)
        .send({ status: JobStatus.running }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);

    const conflictRes = [res1, res2].find((r) => r.status === 409)!;
    expect(conflictRes.body.message).toBe('Job is already running');
  });

  // --------------------------------------------------------------------------
  // Invalid and error cases
  // --------------------------------------------------------------------------

  it('transitioning to pending (initial state) returns 409', async () => {
    const { body: job } = await request(app.getHttpServer())
      .post('/jobs')
      .send({ title: '__concurrency_test__ to-pending', type: 'test' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/jobs/${job.id}/status`)
      .send({ status: JobStatus.pending })
      .expect(409);
  });

  it('completed -> running returns 409 (invalid transition from terminal state)', async () => {
    const { body: job } = await request(app.getHttpServer())
      .post('/jobs')
      .send({ title: '__concurrency_test__ completed-to-running', type: 'test' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/jobs/${job.id}/status`)
      .send({ status: JobStatus.running })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/jobs/${job.id}/status`)
      .send({ status: JobStatus.completed })
      .expect(200);

    const res = await request(app.getHttpServer())
      .patch(`/jobs/${job.id}/status`)
      .send({ status: JobStatus.running })
      .expect(409);

    expect(res.body.message).toContain('Invalid status transition');
  });

  it('non-existent job returns 404', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    await request(app.getHttpServer())
      .patch(`/jobs/${fakeId}/status`)
      .send({ status: JobStatus.running })
      .expect(404);
  });

  it('malformed job id returns 400', async () => {
    await request(app.getHttpServer())
      .patch('/jobs/not-a-uuid/status')
      .send({ status: JobStatus.running })
      .expect(400);
  });

  it('invalid status payload returns 400', async () => {
    const { body: job } = await request(app.getHttpServer())
      .post('/jobs')
      .send({ title: '__concurrency_test__ invalid-status', type: 'test' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/jobs/${job.id}/status`)
      .send({ status: 'definitely-not-a-status' })
      .expect(400);
  });

  it('invalid create payload shape returns 400', async () => {
    await request(app.getHttpServer())
      .post('/jobs')
      .send({ title: '   ', type: 123 })
      .expect(400);
  });
});
