import { Test, TestingModule } from '@nestjs/testing';
import { JobsController } from './jobs.controller.js';
import { JobsService } from './jobs.service.js';

describe('JobsController', () => {
  let controller: JobsController;
  let service: JobsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [JobsController],
      providers: [
        {
          provide: JobsService,
          useValue: {
            createJob: vi.fn(),
            getJobs: vi.fn(),
            deleteJob: vi.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<JobsController>(JobsController);
    service = module.get<JobsService>(JobsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('createJob', () => {
    it('should call JobsService.createJob', async () => {
      const dto = { title: 'Test', type: 'email' };
      await controller.createJob(dto);
      expect(service.createJob).toHaveBeenCalledWith(dto);
    });
  });

  describe('getJobs', () => {
    it('should call JobsService.getJobs', async () => {
      await controller.getJobs({ page: 1, limit: 10 });
      expect(service.getJobs).toHaveBeenCalledWith({ page: 1, limit: 10 });
    });
  });

  describe('deleteJob', () => {
    it('should call JobsService.deleteJob', async () => {
      await controller.deleteJob('1');
      expect(service.deleteJob).toHaveBeenCalledWith('1');
    });
  });
});
