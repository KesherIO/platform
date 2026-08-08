import { NavLink, Outlet, Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import {
  ClipboardList,
  FlaskConical,
  Handshake,
  Users,
  Settings as SettingsIcon,
  Truck,
  Package,
  Menu,
  X,
} from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { labApi } from '../api/labApi';

const ICON_SIZE = 18;
const ICON_STROKE_WIDTH = 2;
const POLL_MS = 60_000;
const MESSENGER_HOME = '/my-pickups';

export function Layout() {
  const {
    user,
    tenantName,
    logoUrl,
    isAdmin,
    labRole,
    canPerformPickups,
    signOut,
  } = useAuth();
  const { t } = useTranslation();
  const location = useLocation();
  const [unassignedCount, setUnassignedCount] = useState(0);
  const [unacceptedCount, setUnacceptedCount] = useState(0);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const isMessenger = labRole === 'MESSENGER';

  useEffect(() => {
    if (isMessenger) return; // messengers don't see the Collections queue

    let ignore = false;
    const poll = () => {
      labApi.pickups
        .unassignedCount()
        .then((res) => {
          if (!ignore) setUnassignedCount(res.count);
        })
        .catch(() => undefined);
    };
    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => {
      ignore = true;
      clearInterval(interval);
    };
  }, [isMessenger]);

  useEffect(() => {
    if (!canPerformPickups) return;

    let ignore = false;
    const poll = () => {
      labApi.pickups
        .myPickups()
        .then((pickups) => {
          if (!ignore) {
            setUnacceptedCount(
              pickups.filter((p) => p.status === 'NOTIFIED').length
            );
          }
        })
        .catch(() => undefined);
    };
    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => {
      ignore = true;
      clearInterval(interval);
    };
  }, [canPerformPickups]);

  // Close the mobile drawer whenever the route changes (e.g. after tapping a
  // nav link) rather than leaving it open over the newly-loaded page.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  // Messengers only ever see their own pickup queue — no orders/clients/team/
  // settings tabs, and no direct-URL access to those pages either.
  if (isMessenger && location.pathname !== MESSENGER_HOME) {
    return <Navigate to={MESSENGER_HOME} replace />;
  }

  const NAV_ITEMS = isMessenger
    ? [
        {
          to: '/my-pickups',
          label: t('nav.my_pickups'),
          icon: Package,
          badge: unacceptedCount > 0 ? unacceptedCount : undefined,
        },
      ]
    : [
        {
          to: '/orders',
          label: t('nav.orders_queue'),
          icon: ClipboardList,
        },
        // Catalog management is admin-only server-side (LabTenantGuard +
        // @Roles(ADMIN) on every /catalog admin route) — hide the tab entirely
        // for non-admins rather than showing a page that 403s on load.
        ...(isAdmin
          ? [
              {
                to: '/catalog',
                label: t('nav.catalog'),
                icon: FlaskConical,
              },
            ]
          : []),
        {
          to: '/collections',
          label: t('nav.collections'),
          icon: Truck,
          badge: unassignedCount > 0 ? unassignedCount : undefined,
        },
        ...(canPerformPickups
          ? [
              {
                to: '/my-pickups',
                label: t('nav.my_pickups'),
                icon: Package,
                badge: unacceptedCount > 0 ? unacceptedCount : undefined,
              },
            ]
          : []),
        { to: '/clients', label: t('nav.clients'), icon: Handshake },
        { to: '/settings/users', label: t('nav.team'), icon: Users },
        {
          to: '/settings/laboratory',
          label: t('nav.settings'),
          icon: SettingsIcon,
        },
      ];

  return (
    <div className="flex h-screen flex-col bg-gray-950 text-white md:flex-row">
      {/* Mobile top bar — replaces the sidebar below the md breakpoint */}
      <header className="flex shrink-0 items-center justify-between border-b border-gray-800 bg-gray-900 px-4 py-3 md:hidden">
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative shrink-0">
            <img
              src={logoUrl || '/default_logo.png'}
              alt="Lab logo"
              className="h-8 w-8 rounded-lg object-cover"
            />
            {isMessenger && unacceptedCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full border border-gray-900 bg-red-500" />
              </span>
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-white">
              {tenantName || t('nav.brand')}
            </p>
            {isMessenger && (
              <p className="truncate text-xs text-gray-400">
                {t('nav.my_pickups')}
                {unacceptedCount > 0 && (
                  <span className="ml-1 font-semibold text-red-400">
                    ({unacceptedCount})
                  </span>
                )}
              </p>
            )}
          </div>
        </div>

        {isMessenger ? (
          <button
            onClick={signOut}
            className="shrink-0 text-xs text-gray-400 hover:text-white transition"
          >
            {t('nav.sign_out')}
          </button>
        ) : (
          <button
            onClick={() => setMobileNavOpen((open) => !open)}
            aria-label={
              mobileNavOpen ? t('nav.close_menu') : t('nav.open_menu')
            }
            className="shrink-0 rounded-lg p-2 text-gray-300 hover:bg-gray-800 hover:text-white"
          >
            {mobileNavOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        )}
      </header>

      {/* Mobile nav drawer — only staff have more than one destination */}
      {!isMessenger && mobileNavOpen && (
        <nav className="shrink-0 space-y-1 border-b border-gray-800 bg-gray-900 px-2 py-2 md:hidden">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                  isActive
                    ? 'bg-cyan/10 text-cyan'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`
              }
            >
              <item.icon
                size={ICON_SIZE}
                strokeWidth={ICON_STROKE_WIDTH}
                className="shrink-0"
              />
              <span className="flex-1">{item.label}</span>
              {'badge' in item && item.badge !== undefined && (
                <span className="rounded-full bg-cyan px-2 py-0.5 text-xs font-semibold text-gray-950">
                  {item.badge}
                </span>
              )}
            </NavLink>
          ))}
          <button
            onClick={signOut}
            className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-gray-400 hover:bg-gray-800 hover:text-white transition"
          >
            {t('nav.sign_out')}
          </button>
        </nav>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden w-60 flex-col border-r border-gray-800 bg-gray-900 md:flex">
        <div className="flex items-center gap-3 px-4 py-5">
          <img
            src={logoUrl || '/default_logo.png'}
            alt="Lab logo"
            className="h-9 w-9 shrink-0 rounded-lg object-cover"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-white">
              {tenantName || t('nav.brand')}
            </p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-2 py-2">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                  isActive
                    ? 'bg-cyan/10 text-cyan'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`
              }
            >
              <item.icon
                size={ICON_SIZE}
                strokeWidth={ICON_STROKE_WIDTH}
                className="shrink-0"
              />
              <span className="flex-1">{item.label}</span>
              {'badge' in item && item.badge !== undefined && (
                <span className="rounded-full bg-cyan px-2 py-0.5 text-xs font-semibold text-gray-950">
                  {item.badge}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-gray-800 p-4">
          <p className="truncate text-xs text-gray-400">{user?.email}</p>
          <button
            onClick={signOut}
            className="mt-2 text-xs text-gray-500 hover:text-white transition"
          >
            {t('nav.sign_out')}
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
