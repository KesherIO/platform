import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const ROUTE_TITLE_KEYS: Record<string, string> = {
  '/orders': 'nav.orders_queue',
  '/worklist': 'nav.worklist',
  '/verifications': 'nav.verifications',
  '/clients': 'nav.clients',
  '/catalog': 'nav.catalog',
  '/collections': 'nav.collections',
  '/my-pickups': 'nav.my_pickups',
  '/settings/laboratory': 'nav.settings',
  '/settings/users': 'nav.team',
  '/settings/analyzers': 'nav.analyzers',
  '/settings/test-config': 'nav.test_config',
  '/templates': 'nav.templates',
};

const SUFFIX = 'Lab · Kesher IO';

export function useDocumentTitle() {
  const { pathname } = useLocation();
  const { t } = useTranslation();

  useEffect(() => {
    const key =
      ROUTE_TITLE_KEYS[pathname] ??
      Object.entries(ROUTE_TITLE_KEYS).find(([prefix]) =>
        pathname.startsWith(prefix + '/')
      )?.[1];

    document.title = key ? `${t(key)} · ${SUFFIX}` : SUFFIX;
  }, [pathname, t]);
}
