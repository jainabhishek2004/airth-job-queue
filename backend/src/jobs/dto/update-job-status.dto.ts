import { IsEnum } from 'class-validator';
import { JobStatus } from '@prisma/client';

export class UpdateJobStatusDto {
  @IsEnum(JobStatus)
  status: JobStatus;
}
