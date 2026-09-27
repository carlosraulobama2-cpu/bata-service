import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError, Errors } from './app-error';

/** Maps every error to the public error envelope. Never leaks internals. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    let error: AppError;
    if (exception instanceof AppError) {
      error = exception;
    } else if (exception instanceof ZodError) {
      error = Errors.validation({ fields: exception.issues.map((i) => i.path.join('.')) });
    } else if (exception instanceof HttpException && exception.getStatus() < 500) {
      const status = exception.getStatus();
      error =
        status === 404
          ? Errors.notFound()
          : status === 400 || status === 415
            ? Errors.validation()
            : new AppError('HTTP_ERROR', status, 'Solicitud no válida.');
    } else {
      this.logger.error(
        `Unhandled error on ${request.method} ${request.url} [${request.id}]: ${
          exception instanceof Error ? exception.stack : String(exception)
        }`
      );
      error = Errors.internal();
    }

    void reply.status(error.status).send({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
        request_id: request.id
      }
    });
  }
}
