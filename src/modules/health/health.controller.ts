import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { HEALTH_ROUTE_PATH } from '../../config/constants';

@ApiTags('health')
@Controller(HEALTH_ROUTE_PATH)
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
