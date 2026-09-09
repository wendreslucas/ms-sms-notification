import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Health check' })
  @ApiOkResponse({
    description: 'Service is running.',
    schema: {
      example: {
        status: 'ok',
      },
    },
  })
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
