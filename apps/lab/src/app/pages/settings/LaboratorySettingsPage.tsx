import { useState, FormEvent, ChangeEvent, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import i18n from '../../i18n/i18n';
import { useAuth } from '../../auth/AuthContext';
import { labApi } from '../../shared/api/labApi';
import { useConfirm } from '../../shared/components/ConfirmDialogProvider';
import { useToast } from '../../shared/components/ToastProvider';
import { COMMON_TIMEZONES } from '../../shared/timezones';
import type {
  LaboratoryProfile,
  LabContactInfo,
  LabSigner,
  LabSignerRole,
  LabPhoneNumber,
} from '../../types/lab.types';

const EMPTY_PROFILE: LaboratoryProfile = {
  accreditationNumber: '',
  directorName: '',
  directorCredentials: '',
  defaultObservations: '',
  reportDisclaimer: '',
  vetVerificationRequired: false,
};

const EMPTY_CONTACT: LabContactInfo = {
  name: '',
  email: '',
  logoUrl: null,
  address: '',
  phoneNumbers: [],
  mapLat: null,
  mapLng: null,
  timezone: 'UTC',
};

const PHONE_LABELS = ['whatsapp', 'commercial', 'personal', 'other'] as const;

const ALL_ROLES: LabSignerRole[] = ['ANALYST', 'REVIEWER', 'DATA_ENTRY'];

let tempIdCounter = 0;

function makeTempId(): string {
  tempIdCounter += 1;
  return `temp-${tempIdCounter}`;
}

function makeEmptySigner(): LabSigner {
  return {
    id: makeTempId(),
    name: '',
    roles: [],
    title: '',
    specialty: '',
    university: '',
    registrationNumber: '',
    signatureUrl: null,
  };
}

export function LaboratorySettingsPage() {
  const { t } = useTranslation();
  const { refreshTenant, isAdmin } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();

  // Read cache synchronously so the form is pre-populated on re-mount
  // (navigating away and back) without waiting for the async queryFn.
  type CachedSettings = {
    profileData: LaboratoryProfile | null;
    contactData: Record<string, unknown> | null;
  };
  const [profile, setProfile] = useState<LaboratoryProfile>(() => {
    const c = queryClient.getQueryData<CachedSettings>([
      'settings-profile-contact',
    ]);
    return c?.profileData ?? EMPTY_PROFILE;
  });
  const [contactInfo, setContactInfo] = useState<LabContactInfo>(() => {
    const c = queryClient.getQueryData<CachedSettings>([
      'settings-profile-contact',
    ]);
    const raw = c?.contactData;
    if (!raw) return EMPTY_CONTACT;
    return {
      ...EMPTY_CONTACT,
      ...raw,
      phoneNumbers: Array.isArray(raw.phoneNumbers)
        ? (raw.phoneNumbers as LabPhoneNumber[])
        : [],
    };
  });
  const [signers, setSigners] = useState<LabSigner[]>(() => {
    const c = queryClient.getQueryData<CachedSettings>([
      'settings-profile-contact',
    ]);
    return c?.profileData?.signers ?? [];
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [importingPlatform, setImportingPlatform] = useState(false);

  const initialProfile = useRef<string>('');
  const initialContact = useRef<string>('');
  const initialSigners = useRef<string>('');

  const isDirty =
    !!initialProfile.current &&
    (JSON.stringify(profile) !== initialProfile.current ||
      JSON.stringify(contactInfo) !== initialContact.current ||
      JSON.stringify(signers) !== initialSigners.current);

  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [signerSigPreviews, setSignerSigPreviews] = useState<
    Record<string, string>
  >({});

  const { isLoading: loading } = useQuery({
    queryKey: ['settings-profile-contact'],
    queryFn: () =>
      Promise.all([
        labApi.settings.getProfile().catch(() => null),
        labApi.settings.getContactInfo().catch(() => null),
      ]).then(([profileData, contactData]) => {
        if (profileData) {
          const p = profileData as LaboratoryProfile;
          setProfile(p);
          if (p.signers) setSigners(p.signers);
          initialProfile.current = JSON.stringify(p);
          initialSigners.current = JSON.stringify(p.signers ?? []);
        }
        if (contactData) {
          const raw = contactData as Record<string, unknown>;
          const parsed = {
            ...EMPTY_CONTACT,
            ...raw,
            phoneNumbers: Array.isArray(raw.phoneNumbers)
              ? (raw.phoneNumbers as LabPhoneNumber[])
              : [],
          };
          setContactInfo(parsed);
          initialContact.current = JSON.stringify(parsed);
        }
        return { profileData, contactData };
      }),
    // This query sets form state as a side effect — disable focus/reconnect
    // refetches to prevent background fetches from overwriting the user's edits
    // while they're on the page. refetchOnMount (default true) is kept so
    // navigating back to settings always loads fresh data.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    setSaving(true);
    setSaved(false);
    try {
      await Promise.all([
        labApi.settings.updateProfile({
          ...profile,
          signers,
        } as unknown as Record<string, unknown>),
        labApi.settings.updateContactInfo(
          contactInfo as unknown as Record<string, unknown>
        ),
      ]);
      await refreshTenant();
      initialProfile.current = JSON.stringify(profile);
      initialContact.current = JSON.stringify(contactInfo);
      initialSigners.current = JSON.stringify(signers);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      // TODO: show error toast
    } finally {
      setSaving(false);
    }
  };

  // --- Logo ---

  const MAX_LOGO_SIZE = 2 * 1024 * 1024; // 2 MB

  const handleLogoChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoError(null);

    if (file.size > MAX_LOGO_SIZE) {
      setLogoError(t('settings.logo_too_large'));
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setLogoPreview(dataUrl);
      setContactInfo((prev) => ({ ...prev, logoUrl: dataUrl }));
    };
    reader.readAsDataURL(file);
  };

  // --- Phone numbers ---

  const addPhone = () => {
    setContactInfo((prev) => ({
      ...prev,
      phoneNumbers: [...prev.phoneNumbers, { label: '', number: '' }],
    }));
  };

  const removePhone = (index: number) => {
    setContactInfo((prev) => ({
      ...prev,
      phoneNumbers: prev.phoneNumbers.filter((_, i) => i !== index),
    }));
  };

  const updatePhone = (
    index: number,
    field: keyof LabPhoneNumber,
    value: string
  ) => {
    setContactInfo((prev) => ({
      ...prev,
      phoneNumbers: prev.phoneNumbers.map((p, i) =>
        i === index ? { ...p, [field]: value } : p
      ),
    }));
  };

  // --- Signers ---

  const addSigner = () => {
    setSigners((prev) => [...prev, makeEmptySigner()]);
  };

  const removeSigner = (index: number) => {
    setSigners((prev) => prev.filter((_, i) => i !== index));
  };

  const updateSigner = (
    index: number,
    field: keyof LabSigner,
    value: string
  ) => {
    setSigners((prev) =>
      prev.map((s, i) => (i === index ? { ...s, [field]: value } : s))
    );
  };

  const toggleSignerRole = (index: number, role: LabSignerRole) => {
    setSigners((prev) =>
      prev.map((s, i) => {
        if (i !== index) return s;
        const has = s.roles.includes(role);
        return {
          ...s,
          roles: has ? s.roles.filter((r) => r !== role) : [...s.roles, role],
        };
      })
    );
  };

  const handleSignerSignatureChange = (
    index: number,
    e: ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const signerId = signers[index]?.id;
    if (!signerId) return;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setSignerSigPreviews((prev) => ({ ...prev, [signerId]: dataUrl }));
      setSigners((prev) =>
        prev.map((s, i) => (i === index ? { ...s, signatureUrl: dataUrl } : s))
      );
    };
    reader.readAsDataURL(file);
  };

  // --- Map ---

  const mapEmbedUrl =
    contactInfo.mapLat != null && contactInfo.mapLng != null
      ? `https://www.openstreetmap.org/export/embed.html?bbox=${
          contactInfo.mapLng - 0.02
        }%2C${contactInfo.mapLat - 0.015}%2C${contactInfo.mapLng + 0.02}%2C${
          contactInfo.mapLat + 0.015
        }&layer=mapnik&marker=${contactInfo.mapLat}%2C${contactInfo.mapLng}`
      : null;

  const handleImportPlatform = async () => {
    const confirmed = await confirm({
      title: t('catalog.import_platform.confirm_title'),
      message: t('catalog.import_platform.confirm_message'),
      confirmLabel: t('catalog.import_platform.confirm_button'),
      icon: Download,
    });
    if (!confirmed) return;

    setImportingPlatform(true);
    try {
      const result = await labApi.catalog.importPlatform();
      toast.success(
        t('catalog.import_platform.success', {
          created: result.created,
          updated: result.updated,
          disabled: result.disabled,
          total: result.total,
        })
      );
      queryClient.invalidateQueries({ queryKey: ['catalog'] });
    } catch (err) {
      toast.error(
        `${t('catalog.import_platform.error')} ${(err as Error).message}`
      );
    } finally {
      setImportingPlatform(false);
    }
  };

  // --- Input helpers ---

  const inputClass = isAdmin
    ? 'w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white placeholder-gray-500 focus:border-cyan focus:outline-none'
    : 'w-full rounded-lg border border-gray-700 bg-gray-800/50 px-3 py-2 text-gray-400 cursor-not-allowed focus:outline-none';

  const labelClass = 'mb-1 block text-sm font-medium text-gray-300';

  if (loading) {
    return (
      <div className="p-6">
        <div className="mb-6 h-7 w-40 animate-pulse rounded bg-gray-700" />

        <div className="max-w-2xl space-y-6">
          {/* Language skeleton */}
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
            <div className="mb-3 h-5 w-24 animate-pulse rounded bg-gray-700" />
            <div className="flex gap-2">
              <div className="h-10 w-24 animate-pulse rounded-lg bg-gray-800" />
              <div className="h-10 w-24 animate-pulse rounded-lg bg-gray-800" />
            </div>
          </div>

          {/* Contact info skeleton */}
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
            <div className="mb-1 h-5 w-44 animate-pulse rounded bg-gray-700" />
            <div className="mb-5 h-4 w-64 animate-pulse rounded bg-gray-800" />
            <div className="mb-5 flex items-center gap-4">
              <div className="h-16 w-16 animate-pulse rounded-xl bg-gray-800" />
              <div className="space-y-1">
                <div className="h-3 w-32 animate-pulse rounded bg-gray-800" />
                <div className="h-3 w-20 animate-pulse rounded bg-gray-800" />
              </div>
            </div>
            <div className="space-y-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i}>
                  <div className="mb-1 h-4 w-24 animate-pulse rounded bg-gray-700" />
                  <div className="h-10 w-full animate-pulse rounded-lg bg-gray-800" />
                </div>
              ))}
            </div>
          </div>

          {/* Profile skeleton */}
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
            <div className="mb-5 h-5 w-32 animate-pulse rounded bg-gray-700" />
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i}>
                  <div className="mb-1 h-4 w-36 animate-pulse rounded bg-gray-700" />
                  <div className="h-10 w-full animate-pulse rounded-lg bg-gray-800" />
                </div>
              ))}
              <div>
                <div className="mb-1 h-4 w-36 animate-pulse rounded bg-gray-700" />
                <div className="h-20 w-full animate-pulse rounded-lg bg-gray-800" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="sticky top-0 z-10 -mx-6 -mt-6 mb-6 flex items-center justify-between bg-gray-950 px-6 py-4 border-b border-gray-800">
        <h1 className="text-xl font-bold text-white">{t('settings.title')}</h1>
        {isAdmin && (
          <div className="flex items-center gap-3">
            {saved && (
              <span className="text-sm text-green-400">
                {t('common.saved')}
              </span>
            )}
            <button
              type="button"
              onClick={() => handleSubmit()}
              disabled={saving || !isDirty}
              className="rounded-lg bg-cyan px-6 py-2 font-semibold text-gray-950 hover:opacity-90 disabled:opacity-50 transition"
            >
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        )}
      </div>

      {isAdmin && (
        <section className="mb-6 max-w-2xl rounded-xl border border-gray-800 bg-gray-900 p-5">
          <h2 className="text-lg font-semibold text-white">
            {t('settings.catalog_setup.title')}
          </h2>
          <p className="mb-4 text-sm text-gray-400">
            {t('settings.catalog_setup.subtitle')}
          </p>
          <button
            type="button"
            onClick={handleImportPlatform}
            disabled={importingPlatform}
            className="flex items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
          >
            <Download size={14} />
            {importingPlatform
              ? t('settings.catalog_setup.importing')
              : t('settings.catalog_setup.button')}
          </button>
        </section>
      )}

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
        {/* ─── Language ─── */}
        <section className="rounded-xl border border-gray-800 bg-gray-900 p-5">
          <h2 className="mb-3 text-lg font-semibold text-white">
            {t('settings.language_title')}
          </h2>
          <div className="flex gap-2">
            {(['en', 'es'] as const).map((lng) => (
              <button
                key={lng}
                type="button"
                onClick={() => {
                  i18n.changeLanguage(lng);
                  localStorage.setItem('lang', lng);
                }}
                className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${
                  i18n.language === lng
                    ? 'border-cyan bg-cyan/10 text-cyan'
                    : 'border-gray-600 bg-gray-800 text-gray-400 hover:border-gray-500'
                }`}
              >
                {lng === 'en' ? 'English' : 'Español'}
              </button>
            ))}
          </div>
        </section>

        {/* ─── Section 1: Contact Information ─── */}
        <section className="rounded-xl border border-gray-800 bg-gray-900 p-5">
          <h2 className="text-lg font-semibold text-white">
            {t('settings.contact_title')}
          </h2>
          <p className="mb-5 text-sm text-gray-400">
            {t('settings.contact_subtitle')}
          </p>

          {/* Logo */}
          <div className="mb-5 flex items-center gap-4">
            <button
              type="button"
              onClick={() => isAdmin && logoInputRef.current?.click()}
              className={`group relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-gray-700 bg-gray-800 ${
                !isAdmin ? 'cursor-not-allowed' : ''
              }`}
            >
              {logoPreview || contactInfo.logoUrl ? (
                <img
                  src={logoPreview ?? contactInfo.logoUrl ?? ''}
                  alt="Lab logo"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-2xl text-gray-500">
                  🏥
                </div>
              )}
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100">
                <svg
                  className="h-5 w-5 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.75}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              </div>
            </button>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={handleLogoChange}
            />
            {isAdmin && (
              <div>
                <p className="text-xs text-gray-500">
                  {t('settings.logo_hint')}
                </p>
                <p className="mt-0.5 text-xs text-gray-600">
                  {t('settings.logo_max_size')}
                </p>
                {logoError && (
                  <p className="mt-1 text-xs text-red-400">{logoError}</p>
                )}
              </div>
            )}
          </div>

          <div className="space-y-4">
            {/* Lab name */}
            <div>
              <label className={labelClass}>{t('settings.lab_name')}</label>
              <input
                type="text"
                value={contactInfo.name}
                readOnly={!isAdmin}
                onChange={(e) =>
                  setContactInfo({ ...contactInfo, name: e.target.value })
                }
                className={inputClass}
              />
            </div>

            {/* Email */}
            <div>
              <label className={labelClass}>{t('settings.email')}</label>
              <input
                type="email"
                value={contactInfo.email}
                readOnly={!isAdmin}
                onChange={(e) =>
                  setContactInfo({ ...contactInfo, email: e.target.value })
                }
                className={inputClass}
              />
            </div>

            {/* Phone numbers */}
            <div>
              <label className={labelClass}>{t('settings.phones_title')}</label>
              <div className="space-y-2">
                {contactInfo.phoneNumbers.map((phone, i) => (
                  <div key={i} className="flex gap-2">
                    <div className="w-40 shrink-0">
                      <select
                        value={phone.label}
                        disabled={!isAdmin}
                        onChange={(e) =>
                          updatePhone(i, 'label', e.target.value)
                        }
                        className={inputClass}
                      >
                        <option value="">
                          {t('settings.phone_label_placeholder')}
                        </option>
                        {PHONE_LABELS.map((l) => (
                          <option key={l} value={l}>
                            {t(`settings.phone_type_${l}`)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex-1">
                      <input
                        type="tel"
                        value={phone.number}
                        readOnly={!isAdmin}
                        onChange={(e) =>
                          updatePhone(i, 'number', e.target.value)
                        }
                        placeholder={t('settings.phone_number_placeholder')}
                        className={inputClass}
                      />
                    </div>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => removePhone(i)}
                        className="shrink-0 rounded-lg px-2 py-2 text-sm text-red-400 hover:bg-red-500/10 transition"
                      >
                        <svg
                          className="h-4 w-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={1.75}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {isAdmin && (
                <button
                  type="button"
                  onClick={addPhone}
                  className="mt-2 text-sm font-medium text-cyan hover:text-cyan/80 transition"
                >
                  + {t('settings.add_phone')}
                </button>
              )}
            </div>

            {/* Address */}
            <div>
              <label className={labelClass}>{t('settings.address')}</label>
              <input
                type="text"
                value={contactInfo.address}
                readOnly={!isAdmin}
                onChange={(e) =>
                  setContactInfo({ ...contactInfo, address: e.target.value })
                }
                placeholder={t('settings.address_placeholder')}
                className={inputClass}
              />
            </div>

            {/* Timezone */}
            <div>
              <label className={labelClass}>{t('settings.timezone')}</label>
              <select
                value={contactInfo.timezone}
                disabled={!isAdmin}
                onChange={(e) =>
                  setContactInfo({ ...contactInfo, timezone: e.target.value })
                }
                className={inputClass}
              >
                {COMMON_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                {t('settings.timezone_hint')}
              </p>
            </div>

            {/* Map coordinates */}
            <div>
              <label className={labelClass}>
                {t('settings.location_title')}
              </label>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-gray-500">
                    {t('settings.map_lat')}
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={contactInfo.mapLat ?? ''}
                    readOnly={!isAdmin}
                    onChange={(e) =>
                      setContactInfo({
                        ...contactInfo,
                        mapLat: e.target.value
                          ? parseFloat(e.target.value)
                          : null,
                      })
                    }
                    className={inputClass}
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-gray-500">
                    {t('settings.map_lng')}
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={contactInfo.mapLng ?? ''}
                    readOnly={!isAdmin}
                    onChange={(e) =>
                      setContactInfo({
                        ...contactInfo,
                        mapLng: e.target.value
                          ? parseFloat(e.target.value)
                          : null,
                      })
                    }
                    className={inputClass}
                  />
                </div>
              </div>
              {mapEmbedUrl && (
                <>
                  <iframe
                    src={mapEmbedUrl}
                    className="mt-3 h-48 w-full rounded-lg border border-gray-700"
                    loading="lazy"
                    title="Lab location"
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                  <div className="mt-2 flex gap-2">
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${contactInfo.mapLat},${contactInfo.mapLng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:border-gray-500 transition"
                    >
                      <svg
                        className="h-3.5 w-3.5"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                      >
                        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 010-5 2.5 2.5 0 010 5z" />
                      </svg>
                      Google Maps
                    </a>
                    <a
                      href={`https://www.waze.com/ul?ll=${contactInfo.mapLat},${contactInfo.mapLng}&navigate=yes`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:border-gray-500 transition"
                    >
                      <svg
                        className="h-3.5 w-3.5"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                      >
                        <path d="M20.54 6.63A8.99 8.99 0 0012.05 3C7.05 3 3 7.05 3 12.05a8.99 8.99 0 003.63 7.21L12 24l5.37-4.74A8.99 8.99 0 0021 12.05c0-2-.65-3.85-1.76-5.42zM12 15a3 3 0 110-6 3 3 0 010 6z" />
                      </svg>
                      Waze
                    </a>
                  </div>
                </>
              )}
            </div>
          </div>
        </section>

        {/* ─── Section 2: Lab Profile ─── */}
        <section className="rounded-xl border border-gray-800 bg-gray-900 p-5">
          <h2 className="mb-5 text-lg font-semibold text-white">
            {t('settings.profile_title')}
          </h2>

          <div className="space-y-4">
            <div>
              <label className={labelClass}>
                {t('settings.accreditation_number')}
              </label>
              <input
                type="text"
                value={profile.accreditationNumber ?? ''}
                readOnly={!isAdmin}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    accreditationNumber: e.target.value,
                  })
                }
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>
                {t('settings.director_name')}
              </label>
              <input
                type="text"
                value={profile.directorName ?? ''}
                readOnly={!isAdmin}
                onChange={(e) =>
                  setProfile({ ...profile, directorName: e.target.value })
                }
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>
                {t('settings.director_credentials')}
              </label>
              <textarea
                rows={3}
                value={profile.directorCredentials ?? ''}
                readOnly={!isAdmin}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    directorCredentials: e.target.value,
                  })
                }
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>
                {t('settings.report_disclaimer')}
              </label>
              <textarea
                rows={3}
                value={profile.reportDisclaimer ?? ''}
                readOnly={!isAdmin}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    reportDisclaimer: e.target.value,
                  })
                }
                className={inputClass}
                placeholder={t('settings.report_disclaimer_placeholder')}
              />
            </div>
          </div>
        </section>

        {/* ─── Section 3: Vet Verification ─── */}
        <section className="rounded-xl border border-gray-800 bg-gray-900 p-5">
          <h2 className="mb-1 text-lg font-semibold text-white">
            {t('settings.vet_verification_title')}
          </h2>
          <p className="mb-5 text-sm text-gray-400">
            {t('settings.vet_verification_subtitle')}
          </p>

          <label className="flex cursor-pointer items-start gap-3">
            <div className="relative mt-0.5 shrink-0">
              <input
                type="checkbox"
                className="sr-only"
                checked={profile.vetVerificationRequired ?? false}
                disabled={!isAdmin}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    vetVerificationRequired: e.target.checked,
                  })
                }
              />
              <div
                className={`flex h-6 w-11 items-center rounded-full transition-colors ${
                  profile.vetVerificationRequired ? 'bg-cyan' : 'bg-gray-700'
                } ${!isAdmin ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                <div
                  className={`mx-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    profile.vetVerificationRequired
                      ? 'translate-x-5'
                      : 'translate-x-0'
                  }`}
                />
              </div>
            </div>
            <div>
              <p className="text-sm font-medium text-white">
                {t('settings.vet_verification_required_label')}
              </p>
              <p className="mt-0.5 text-xs text-gray-400">
                {profile.vetVerificationRequired
                  ? t('settings.vet_verification_warning_on')
                  : t('settings.vet_verification_description')}
              </p>
            </div>
          </label>
        </section>

        {/* ─── Section 4: Lab Signers ─── */}
        <section className="rounded-xl border border-gray-800 bg-gray-900 p-5">
          <h2 className="text-lg font-semibold text-white">
            {t('settings.signers_title')}
          </h2>
          <p className="mb-5 text-sm text-gray-400">
            {t('settings.signers_subtitle')}
          </p>

          {signers.length === 0 && (
            <p className="mb-4 text-sm text-gray-500">
              {t('settings.no_signers')}
            </p>
          )}

          <div className="space-y-4">
            {signers.map((signer, i) => (
              <div
                key={signer.id}
                className="rounded-lg border border-gray-700 bg-gray-800/50 p-4 space-y-3"
              >
                {/* Signer name */}
                <div>
                  <label className={labelClass}>
                    {t('settings.signer_name')}
                  </label>
                  <input
                    type="text"
                    value={signer.name}
                    readOnly={!isAdmin}
                    onChange={(e) => updateSigner(i, 'name', e.target.value)}
                    placeholder={t('settings.signer_name_placeholder')}
                    className={inputClass}
                  />
                </div>

                {/* Roles */}
                <div>
                  <label className={labelClass}>
                    {t('settings.signer_roles')}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {ALL_ROLES.map((role) => {
                      const active = signer.roles.includes(role);
                      return (
                        <button
                          key={role}
                          type="button"
                          disabled={!isAdmin}
                          onClick={() => toggleSignerRole(i, role)}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                            active
                              ? 'border-cyan bg-cyan/10 text-cyan'
                              : 'border-gray-600 bg-gray-800 text-gray-400 hover:border-gray-500'
                          }`}
                        >
                          {t(
                            `settings.role_${role.toLowerCase()}` as
                              | 'settings.role_analyst'
                              | 'settings.role_reviewer'
                              | 'settings.role_data_entry'
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Title & Specialty */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>
                      {t('settings.signer_title')}
                    </label>
                    <input
                      type="text"
                      value={signer.title}
                      readOnly={!isAdmin}
                      onChange={(e) => updateSigner(i, 'title', e.target.value)}
                      placeholder={t('settings.signer_title_placeholder')}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>
                      {t('settings.signer_specialty')}
                    </label>
                    <input
                      type="text"
                      value={signer.specialty}
                      readOnly={!isAdmin}
                      onChange={(e) =>
                        updateSigner(i, 'specialty', e.target.value)
                      }
                      placeholder={t('settings.signer_specialty_placeholder')}
                      className={inputClass}
                    />
                  </div>
                </div>

                {/* University & Registration */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>
                      {t('settings.signer_university')}
                    </label>
                    <input
                      type="text"
                      value={signer.university}
                      readOnly={!isAdmin}
                      onChange={(e) =>
                        updateSigner(i, 'university', e.target.value)
                      }
                      placeholder={t('settings.signer_university_placeholder')}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>
                      {t('settings.signer_registration')}
                    </label>
                    <input
                      type="text"
                      value={signer.registrationNumber}
                      readOnly={!isAdmin}
                      onChange={(e) =>
                        updateSigner(i, 'registrationNumber', e.target.value)
                      }
                      placeholder={t(
                        'settings.signer_registration_placeholder'
                      )}
                      className={inputClass}
                    />
                  </div>
                </div>

                {/* Signature upload */}
                <div>
                  <label className={labelClass}>
                    {t('settings.signer_signature_hint')}
                  </label>
                  <div className="flex items-center gap-3">
                    {(signerSigPreviews[signer.id] || signer.signatureUrl) && (
                      <img
                        src={
                          signerSigPreviews[signer.id] ??
                          signer.signatureUrl ??
                          ''
                        }
                        alt="Signature"
                        className="h-12 rounded border border-gray-600 bg-white px-2"
                      />
                    )}
                    {isAdmin && (
                      <label className="cursor-pointer rounded-lg border border-gray-600 bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:border-gray-500 transition">
                        {signer.signatureUrl || signerSigPreviews[signer.id]
                          ? '↻'
                          : '↑'}{' '}
                        {t('settings.signer_signature_hint')}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => handleSignerSignatureChange(i, e)}
                        />
                      </label>
                    )}
                  </div>
                </div>

                {/* Remove signer */}
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => removeSigner(i)}
                    className="text-sm text-red-400 hover:text-red-300 transition"
                  >
                    {t('settings.remove_signer')}
                  </button>
                )}
              </div>
            ))}
          </div>

          {isAdmin && (
            <button
              type="button"
              onClick={addSigner}
              className="mt-4 text-sm font-medium text-cyan hover:text-cyan/80 transition"
            >
              + {t('settings.add_signer')}
            </button>
          )}
        </section>
      </form>
    </div>
  );
}
