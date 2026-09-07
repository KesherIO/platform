import { Request, Response, NextFunction } from 'express';
import { RequestIdMiddleware } from './request-id.middleware';

describe('RequestIdMiddleware', () => {
  let middleware: RequestIdMiddleware;
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    middleware = new RequestIdMiddleware();
    req = { headers: {} };
    res = { setHeader: jest.fn() };
    next = jest.fn();
  });

  it('generates a UUID when no x-request-id header is present', () => {
    middleware.use(req as Request, res as Response, next);

    expect((req as Record<string, unknown>)['requestId']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      'x-request-id',
      (req as Record<string, unknown>)['requestId'],
    );
    expect(next).toHaveBeenCalled();
  });

  it('passes through a valid incoming UUID', () => {
    const incoming = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    req.headers = { 'x-request-id': incoming };

    middleware.use(req as Request, res as Response, next);

    expect((req as Record<string, unknown>)['requestId']).toBe(incoming);
    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', incoming);
  });

  it('rejects an invalid format and generates a new UUID', () => {
    req.headers = { 'x-request-id': 'not-a-uuid' };

    middleware.use(req as Request, res as Response, next);

    expect((req as Record<string, unknown>)['requestId']).not.toBe('not-a-uuid');
    expect((req as Record<string, unknown>)['requestId']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});
