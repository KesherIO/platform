import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthContext';

export function Layout() {
  const { user, signOut } = useAuth();
  const { t } = useTranslation();

  const NAV_ITEMS = [
    { to: '/orders', label: t('nav.orders_queue'), icon: '🧪' },
    { to: '/settings/users', label: t('nav.team'), icon: '👥' },
    { to: '/settings/laboratory', label: t('nav.settings'), icon: '⚙️' },
  ];

  return (
    <div className="flex h-screen bg-gray-950 text-white">
      <aside className="flex w-60 flex-col border-r border-gray-800 bg-gray-900">
        <div className="px-4 py-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">
            {t('nav.brand')}
          </p>
          <p className="mt-0.5 text-sm font-bold text-white">
            {t('nav.lab_label')}
          </p>
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
              <span>{item.icon}</span>
              {item.label}
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
