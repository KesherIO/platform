import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);

  // ── Swagger ──────────────────────────────────────────────────────────────
  const swaggerConfig = new DocumentBuilder()
    .setTitle('VetAI API')
    .setDescription(
      'NestJS API for VetAI — multi-tenant veterinary AI platform.\n\n' +
        'Authenticate via Supabase, then pass the JWT as a Bearer token.'
    )
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'supabase-jwt' // referenced by @ApiBearerAuth('supabase-jwt')
    )
    .addApiKey(
      { type: 'apiKey', in: 'header', name: 'x-internal-api-key' },
      'x-internal-api-key' // referenced by @ApiSecurity('x-internal-api-key')
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${globalPrefix}/docs`, app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });
  // ─────────────────────────────────────────────────────────────────────────

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  app.enableCors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:4200',
    credentials: true,
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);
  Logger.log(
    `Application running on: http://localhost:${port}/${globalPrefix}`
  );
  Logger.log(
    `Swagger docs:           http://localhost:${port}/${globalPrefix}/docs`
  );
}

bootstrap();
