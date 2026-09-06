import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import helmet from 'helmet';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);

  app.use(json({ limit: '5mb' }));

  // Swagger UI (served under this same app) needs inline scripts/styles to render.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'"],
          frameSrc: ["'self'", 'https://www.openstreetmap.org'],
        },
      },
    })
  );

  // ── Swagger ──────────────────────────────────────────────────────────────
  const swaggerConfig = new DocumentBuilder()
    .setTitle('KesherIO PLATFORM API')
    .setDescription(
      'NestJS API for KesherIO — multi-tenant platform.\n\n' +
        'Authenticate via Supabase, then pass the JWT as a Bearer token.'
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Supabase JWT — paste the access_token from your Supabase session (without the word Bearer)',
      },
      'bearer' // matches the default used by @ApiBearerAuth() with no argument
    )
    .addApiKey(
      { type: 'apiKey', in: 'header', name: 'x-internal-api-key' },
      'x-internal-api-key' // referenced by @ApiSecurity('x-internal-api-key')
    )
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: 'x-tenant-id',
        description:
          'Clinic tenant ID — required by all clinic-facing endpoints (TenantGuard). Lab endpoints use the lab tenant ID resolved from your membership instead.',
      },
      'x-tenant-id'
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

  const allowedOrigins = [
    process.env.FRONTEND_URL ?? 'http://localhost:4200',
    process.env.LAB_URL ?? 'http://localhost:4201',
  ].filter(Boolean);

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  Logger.log(
    `Application running on: http://localhost:${port}/${globalPrefix}`
  );
  Logger.log(
    `Swagger docs:           http://localhost:${port}/${globalPrefix}/docs`
  );
}

bootstrap();
