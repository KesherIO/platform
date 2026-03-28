import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth.service';

/**
 * Attaches the Supabase JWT as a Bearer token to every outgoing request
 * that targets our own API (/api/*).
 *
 * Only applies to same-origin API requests — external URLs are left untouched.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);

  // Only inject the token for requests to our own backend.
  const isApiRequest = req.url.startsWith('/api') || req.url.startsWith('/api/');
  const token = authService.getAccessToken();

  if (isApiRequest && token) {
    const cloned = req.clone({
      setHeaders: { Authorization: `Bearer ${token}` },
    });
    return next(cloned);
  }

  return next(req);
};