import { Test, TestingModule } from '@nestjs/testing';
import { JobsService } from './jobs.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { JobStatus } from '@prisma/client';


describe('JobsService', () => {
  let service: JobsService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobsService,
        {
          provide: PrismaService,
          useValue: {
            job: {
              create: vi.fn(),
              findMany: vi.fn(),
              delete: vi.fn(),
              findUnique: vi.fn(),
              update: vi.fn(),
              updateMany: vi.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<JobsService>(JobsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createJob', () => {
    it('should create a new job with pending status', async () => {
      const createDto = { title: 'Test Job', type: 'email' };
      const expectedJob = { id: '00000000-0000-0000-0000-000000000001', ...createDto, status: JobStatus.pending, createdAt: new Date() };
      
      (prisma.job.create as any).mockResolvedValue(expectedJob);

      const result = await service.createJob(createDto);
      
      expect(result).toEqual(expectedJob);
      expect(prisma.job.create).toHaveBeenCalledWith({
        data: {
          title: 'Test Job',
          type: 'email',
          status: JobStatus.pending,
        },
      });
    });
  });

  describe('getJobs', () => {
    it('should return an array of jobs sorted by createdAt desc', async () => {
      const jobs = [{ id: '00000000-0000-0000-0000-000000000001', title: 'Test', type: 'email', status: JobStatus.pending, createdAt: new Date() }];
      (prisma.job.findMany as any).mockResolvedValue(jobs);

      const result = await service.getJobs();
      
      expect(result).toEqual(jobs);
      expect(prisma.job.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('deleteJob', () => {
    it('should delete a job successfully', async () => {
      const jobId = '00000000-0000-0000-0000-000000000001';
      (prisma.job.delete as any).mockResolvedValue({ id: jobId });
      await expect(service.deleteJob(jobId)).resolves.not.toThrow();
      expect(prisma.job.delete).toHaveBeenCalledWith({ where: { id: jobId } });
    });

    it('should throw BadRequestException for malformed UUIDs', async () => {
      await expect(service.deleteJob('not-a-uuid')).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if job does not exist', async () => {
      (prisma.job.delete as any).mockRejectedValue({ code: 'P2025' });
      await expect(service.deleteJob('00000000-0000-0000-0000-000000000001')).rejects.toThrow(NotFoundException);
    });

    it('should map Prisma invalid ID errors to BadRequestException', async () => {
      (prisma.job.delete as any).mockRejectedValue({ code: 'P2023' });
      await expect(service.deleteJob('00000000-0000-0000-0000-000000000001')).rejects.toThrow(BadRequestException);
    });
  });

  describe('validateStatusTransition', () => {
    it('should allow pending -> running', () => {
      expect(service.validateStatusTransition(JobStatus.pending, JobStatus.running)).toBe(true);
    });
    it('should allow running -> completed', () => {
      expect(service.validateStatusTransition(JobStatus.running, JobStatus.completed)).toBe(true);
    });
    it('should allow running -> failed', () => {
      expect(service.validateStatusTransition(JobStatus.running, JobStatus.failed)).toBe(true);
    });
    it('should reject pending -> completed', () => {
      expect(service.validateStatusTransition(JobStatus.pending, JobStatus.completed)).toBe(false);
    });
    it('should reject pending -> failed', () => {
      expect(service.validateStatusTransition(JobStatus.pending, JobStatus.failed)).toBe(false);
    });
    it('should reject completed -> anything', () => {
      expect(service.validateStatusTransition(JobStatus.completed, JobStatus.running)).toBe(false);
      expect(service.validateStatusTransition(JobStatus.completed, JobStatus.pending)).toBe(false);
    });
    it('should reject failed -> anything', () => {
      expect(service.validateStatusTransition(JobStatus.failed, JobStatus.running)).toBe(false);
      expect(service.validateStatusTransition(JobStatus.failed, JobStatus.pending)).toBe(false);
    });
  });

  describe('updateJobStatus', () => {
    /**
     * Helper: wire the Prisma mock to simulate a successful atomic transition.
     * updateMany returns count=1; the follow-up findUnique returns the
     * updated record.
     */
    function mockSuccess(resultJob: object) {
      (prisma.job.updateMany as any).mockResolvedValue({ count: 1 });
      (prisma.job.findUnique as any).mockResolvedValue(resultJob);
    }

    /**
     * Helper: wire the Prisma mock to simulate a missed conditional UPDATE
     * (count=0), followed by a findUnique that returns `existingJob`.
     */
    function mockMiss(existingJob: object | null) {
      (prisma.job.updateMany as any).mockResolvedValue({ count: 0 });
      (prisma.job.findUnique as any).mockResolvedValue(existingJob);
    }

    // ------------------------------------------------------------------
    // Shared error-path behaviour (same for every transition)
    // ------------------------------------------------------------------

    describe('404 – job does not exist', () => {
      it.each([
        [JobStatus.running, JobStatus.pending],
        [JobStatus.completed, JobStatus.running],
        [JobStatus.failed, JobStatus.running],
      ] as [JobStatus, JobStatus][])(
        'throws NotFoundException when transitioning to %s and findUnique returns null',
        async (newStatus) => {
          mockMiss(null);
          await expect(service.updateJobStatus('00000000-0000-0000-0000-000000000001', newStatus)).rejects.toThrow(NotFoundException);
        },
      );
    });

    describe('409 – target job already at destination (concurrent race)', () => {
      it.each([
        [JobStatus.running],
        [JobStatus.completed],
        [JobStatus.failed],
      ] as [JobStatus][])(
        'throws ConflictException "Job is already %s" when job status equals the target',
        async (newStatus) => {
          mockMiss({ id: '00000000-0000-0000-0000-000000000001', status: newStatus });
          await expect(service.updateJobStatus('00000000-0000-0000-0000-000000000001', newStatus)).rejects.toThrow(
            `Job is already ${newStatus}`,
          );
        },
      );
    });

    describe('409 – invalid transition (terminal or wrong state)', () => {
      it('throws ConflictException when requesting pending (initial state — never a valid target)', async () => {
        // requiredFromStatus has no entry for `pending`; rejected before any DB call.
        await expect(service.updateJobStatus('00000000-0000-0000-0000-000000000001', JobStatus.pending)).rejects.toThrow(
          ConflictException,
        );
        expect(prisma.job.updateMany).not.toHaveBeenCalled();
      });

      it('throws ConflictException for completed → running (wrong from-state)', async () => {
        mockMiss({ id: '1', status: JobStatus.completed });
        await expect(service.updateJobStatus('00000000-0000-0000-0000-000000000001', JobStatus.running)).rejects.toThrow(
          'Invalid status transition from completed to running',
        );
      });
    });

    // ------------------------------------------------------------------
    // Happy-path: each allowed transition uses updateMany atomically
    // ------------------------------------------------------------------

    describe('pending → running (atomic conditional UPDATE)', () => {
      it('issues updateMany with where:{status:pending} and returns the updated job', async () => {
        const updated = { id: '00000000-0000-0000-0000-000000000001', status: JobStatus.running };
        mockSuccess(updated);

        const result = await service.updateJobStatus('00000000-0000-0000-0000-000000000001', JobStatus.running);

        expect(prisma.job.updateMany).toHaveBeenCalledWith({
          where: { id: '00000000-0000-0000-0000-000000000001', status: JobStatus.pending },
          data: { status: JobStatus.running },
        });
        expect(result.status).toBe(JobStatus.running);
      });
    });

    describe('running → completed (atomic conditional UPDATE)', () => {
      it('issues updateMany with where:{status:running} and returns the updated job', async () => {
        const updated = { id: '00000000-0000-0000-0000-000000000001', status: JobStatus.completed };
        mockSuccess(updated);

        const result = await service.updateJobStatus('00000000-0000-0000-0000-000000000001', JobStatus.completed);

        expect(prisma.job.updateMany).toHaveBeenCalledWith({
          where: { id: '00000000-0000-0000-0000-000000000001', status: JobStatus.running },
          data: { status: JobStatus.completed },
        });
        expect(result.status).toBe(JobStatus.completed);
      });
    });

    describe('running → failed (atomic conditional UPDATE)', () => {
      it('issues updateMany with where:{status:running} and returns the updated job', async () => {
        const updated = { id: '00000000-0000-0000-0000-000000000001', status: JobStatus.failed };
        mockSuccess(updated);

        const result = await service.updateJobStatus('00000000-0000-0000-0000-000000000001', JobStatus.failed);

        expect(prisma.job.updateMany).toHaveBeenCalledWith({
          where: { id: '00000000-0000-0000-0000-000000000001', status: JobStatus.running },
          data: { status: JobStatus.failed },
        });
        expect(result.status).toBe(JobStatus.failed);
      });
    });

    // ------------------------------------------------------------------
    // Concurrency unit tests [simulated DB race]
    //
    // These tests verify that the SERVICE correctly handles what the
    // database would return in a concurrent scenario: the winning
    // request's updateMany gets count=1; the losing request's updateMany
    // gets count=0 because the row's status already moved.
    //
    // Limitation: this is NOT a real PostgreSQL race.  The mock is
    // sequential, not truly parallel.  See the e2e integration test in
    // test/jobs-concurrency.e2e-spec.ts for a live proof against Neon.
    // ------------------------------------------------------------------

    describe('[unit – simulated DB race] concurrent claims resolve to exactly one success + one 409', () => {
      it.each([
        ['pending → running', JobStatus.running, JobStatus.pending],
        ['running → completed', JobStatus.completed, JobStatus.running],
        ['running → failed', JobStatus.failed, JobStatus.running],
      ] as [string, JobStatus, JobStatus][])(
        '%s: first caller wins, second receives ConflictException',
        async (_, newStatus) => {
          const winnerJob = { id: '00000000-0000-0000-0000-000000000001', status: newStatus };

          // First updateMany wins (count=1), second loses (count=0).
          let callCount = 0;
          (prisma.job.updateMany as any).mockImplementation(() => {
            callCount++;
            return Promise.resolve({ count: callCount === 1 ? 1 : 0 });
          });

          // findUnique is called by the losing request to classify the error.
          // At that point the job is already at `newStatus`.
          (prisma.job.findUnique as any).mockResolvedValue(winnerJob);

          const [r1, r2] = await Promise.allSettled([
            service.updateJobStatus('00000000-0000-0000-0000-000000000001', newStatus),
            service.updateJobStatus('00000000-0000-0000-0000-000000000001', newStatus),
          ]);

          const fulfilled = [r1, r2].filter((r) => r.status === 'fulfilled');
          const rejected = [r1, r2].filter((r) => r.status === 'rejected');

          expect(fulfilled).toHaveLength(1);
          expect(rejected).toHaveLength(1);

          const rejection = rejected[0] as PromiseRejectedResult;
          expect(rejection.reason).toBeInstanceOf(ConflictException);
          expect(rejection.reason.message).toBe(`Job is already ${newStatus}`);
        },
      );
    });
  });
});
