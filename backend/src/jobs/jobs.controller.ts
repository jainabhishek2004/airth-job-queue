import { Controller, Get, Post, Body, Param, Delete, Patch, HttpCode, HttpStatus, ParseUUIDPipe } from '@nestjs/common';
import { JobsService } from './jobs.service.js';
import { CreateJobDto } from './dto/create-job.dto.js';
import { UpdateJobStatusDto } from './dto/update-job-status.dto.js';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post()
  createJob(@Body() createJobDto: CreateJobDto) {
    return this.jobsService.createJob(createJobDto);
  }

  @Get()
  getJobs() {
    return this.jobsService.getJobs();
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
