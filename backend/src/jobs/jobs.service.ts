import { Injectable, NotFoundException, ConflictException, BadRequestException, Logger, MessageEvent } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateJobDto } from './dto/create-job.dto.js';
import { GetJobsQueryDto } from './dto/get-jobs-query.dto.js';
import { Job, JobStatus } from '@prisma/client';
import { Observable, Subject } from 'rxjs';


const requiredFromStatus: Partial<Record<JobStatus, JobStatus>> = {
  [JobStatus.running]: JobStatus.pending,
  [JobStatus.completed]: JobStatus.running,
  [JobStatus.failed]: JobStatus.running,
};


const allowedTransitions: Record<JobStatus, JobStatus[]> = {
  [JobStatus.pending]: [JobStatus.running],
  [JobStatus.running]: [JobStatus.completed, JobStatus.failed],
  [JobStatus.completed]: [],
  [JobStatus.failed]: [],
};

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);
  private readonly jobEvents = new Subject<MessageEvent>();

  constructor(private readonly prisma: PrismaService) {}

  getJobEvents(): Observable<MessageEvent> {
    return this.jobEvents.asObservable();
  }

  private publishJobsChanged(): void {
    this.jobEvents.next({
      data: { type: 'jobs-changed' },
    });
  }

  validateStatusTransition(currentStatus: JobStatus, requestedStatus: JobStatus): boolean {
    return allowedTransitions[currentStatus].includes(requestedStatus);
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }

  private mapPrismaError(error: any, fallbackMessage: string): never {
    if (error?.code === 'P2025') {
      throw new NotFoundException('Job not found');
    }

    if (error?.code === 'P2023' || !this.isUuid(fallbackMessage)) {
      throw new BadRequestException('Invalid job ID');
    }

    throw error;
  }

  async createJob(dto: CreateJobDto): Promise<Job> {
    const job = await this.prisma.job.create({
      data: {
        title: dto.title,
        type: dto.type,
        status: JobStatus.pending,
      },
    });

    this.publishJobsChanged();
    return job;
  }

  async getJobs(query: GetJobsQueryDto = new GetJobsQueryDto()) {
    const { page, limit, status } = query;
    const where = status ? { status } : {};
    const [jobs, total, statusCounts] = await Promise.all([
      this.prisma.job.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.job.count({ where }),
      this.prisma.job.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
    ]);

    const counts = {
      all: statusCounts.reduce((sum, item) => sum + item._count._all, 0),
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
    };

    for (const item of statusCounts) {
      counts[item.status] = item._count._all;
    }

    return {
      data: jobs,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      counts,
    };
  }

  
  async updateJobStatus(id: string, newStatus: JobStatus): Promise<Job> {
    if (!this.isUuid(id)) {
      throw new BadRequestException('Invalid job ID');
    }

    const expectedFrom = requiredFromStatus[newStatus];

    
    if (expectedFrom === undefined) {
      throw new ConflictException(`Invalid status transition to ${newStatus}`);
    }

    return this.atomicTransition(id, expectedFrom, newStatus);
  }

  
  private async atomicTransition(id: string, from: JobStatus, to: JobStatus): Promise<Job> {
    try {
      const result = await this.prisma.job.updateMany({
        where: { id, status: from },
        data: { status: to },
      });

      if (result.count === 0) {
        const job = await this.prisma.job.findUnique({ where: { id } });

        if (!job) {
          throw new NotFoundException('Job not found');
        }

      
        if (job.status === to) {
          this.logger.warn(`Job ${id} was already in ${to}; transition rejected.`);
          throw new ConflictException(`Job is already ${to}`);
        }

        this.logger.warn(`Invalid status transition attempted for job ${id}: ${job.status} -> ${to}`);
        throw new ConflictException(`Invalid status transition from ${job.status} to ${to}`);
      }

      // Return the freshly-updated record.
      const updatedJob = await this.prisma.job.findUnique({ where: { id } }) as Job;
      this.publishJobsChanged();
      return updatedJob;
    } catch (error: any) {
      if (error instanceof NotFoundException || error instanceof ConflictException || error instanceof BadRequestException) {
        throw error;
      }

      if (error?.code === 'P2023') {
        throw new BadRequestException('Invalid job ID');
      }

      throw error;
    }
  }

  async deleteJob(id: string): Promise<void> {
    if (!this.isUuid(id)) {
      throw new BadRequestException('Invalid job ID');
    }

    try {
      await this.prisma.job.delete({
        where: { id },
      });
      this.publishJobsChanged();
    } catch (error: any) {
      if (error?.code === 'P2025') {
        throw new NotFoundException('Job not found');
      }

      if (error?.code === 'P2023') {
        throw new BadRequestException('Invalid job ID');
      }

      throw error;
    }
  }
}

