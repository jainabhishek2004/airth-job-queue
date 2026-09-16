import { Controller, Get, Post, Body, Param, Delete, Patch, HttpCode, HttpStatus, ParseUUIDPipe, Query, Sse, MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import { JobsService } from './jobs.service.js';
import { CreateJobDto } from './dto/create-job.dto.js';
import { GetJobsQueryDto } from './dto/get-jobs-query.dto.js';
import { UpdateJobStatusDto } from './dto/update-job-status.dto.js';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post()
  createJob(@Body() createJobDto: CreateJobDto) {
    return this.jobsService.createJob(createJobDto);
  }

  @Get()
  getJobs(@Query() query: GetJobsQueryDto) {
    return this.jobsService.getJobs(query);
  }

  @Sse('events')
  getEvents(): Observable<MessageEvent> {
    return this.jobsService.getJobEvents();
  }

  @Patch(':id/status')
  updateJobStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateJobStatusDto: UpdateJobStatusDto,
  ) {
    return this.jobsService.updateJobStatus(id, updateJobStatusDto.status);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteJob(@Param('id', ParseUUIDPipe) id: string) {
    return this.jobsService.deleteJob(id);
  }
}
