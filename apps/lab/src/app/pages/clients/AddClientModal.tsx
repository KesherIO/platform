import { useState, FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthContext';
import { labApi } from '../../shared/api/labApi';
import type { ClientType, CreateClientResponse } from '../../types/lab.types';

const CLIENT_TYPES: ClientType[] = [
  'VETERINARY_CLINIC',
  'INDEPENDENT_VET',
  'BREEDER',
  'FARM',
  'SHELTER',
  'RESEARCH_ORGANIZATION',
  'INDIVIDUAL',
  'OTHER',
];

interface AddClientModalProps {
  onClose: () => void;
  onCreated: () => void;
}

export function AddClientModal({ onClose, onCreated }: AddClientModalProps) {
  const { t } = useTranslation();
  const { tenantName } = useAuth();

  const [name, setName] = useState('');
  const [clientType, setClientType] = useState<ClientType | ''>('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateClientResponse | null>(null);
  const [copied, setCopied] = useState<'link' | 'message' | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await labApi.clients.create({
        name,
        clientType,
        primaryContactName: contactName || undefined,
        primaryContactEmail: contactEmail,
        phone: phone || undefined,
        address: address || undefined,
      });
      setResult(res);
      onCreated();
    } catch (err) {
      setFormError(`${t('clients.errors.create')} ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const copyToClipboard = async (text: string, type: 'link' | 'message') => {
    await navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  };

  const invitationMessage = result
    ? t('clients.invitation.message_template', {
        labName: tenantName ?? 'KesherIO',
        link: result.onboardingLink,
      })
    : '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl">
        <div className="border-b border-gray-800 px-6 py-4">
          <h2 className="text-base font-semibold text-white">
            {result ? t('clients.invitation.title') : t('clients.form.title')}
          </h2>
        </div>

        {!result ? (
          <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-400">
                {t('clients.form.name')} *
              </label>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('clients.form.name_placeholder')}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-cyan focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-400">
                {t('clients.form.client_type')} *
              </label>
              <select
                required
                value={clientType}
                onChange={(e) => setClientType(e.target.value as ClientType)}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-cyan focus:outline-none"
              >
                <option value="" disabled>
                  {t('clients.form.client_type_placeholder')}
                </option>
                {CLIENT_TYPES.map((ct) => (
                  <option key={ct} value={ct}>
                    {t(`clients.type.${ct}`)}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-400">
                  {t('clients.form.contact_name')}
                </label>
                <input
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder={t('clients.form.contact_name_placeholder')}
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-cyan focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-400">
                  {t('clients.form.contact_email')} *
                </label>
                <input
                  type="email"
                  required
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder={t('clients.form.contact_email_placeholder')}
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-cyan focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-400">
                  {t('clients.form.phone')}
                </label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={t('clients.form.phone_placeholder')}
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-cyan focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-400">
                  {t('clients.form.address')}
                </label>
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder={t('clients.form.address_placeholder')}
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-cyan focus:outline-none"
                />
              </div>
            </div>

            {formError && (
              <p className="rounded-lg bg-red-900/30 px-3 py-2 text-xs text-red-300">
                {formError}
              </p>
            )}

            <div className="flex gap-3 pt-1">
              <button
                type="submit"
                disabled={submitting}
                className="rounded-lg bg-cyan px-5 py-2 text-sm font-semibold text-gray-950 hover:opacity-90 disabled:opacity-50"
              >
                {submitting
                  ? t('clients.form.submitting')
                  : t('clients.form.submit')}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-gray-700 px-5 py-2 text-sm text-gray-300 hover:bg-gray-800"
              >
                {t('clients.form.cancel')}
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-4 px-6 py-5">
            <div className="rounded-lg bg-green-900/20 px-4 py-3 text-sm text-green-300">
              {t('clients.invitation.generated')}
            </div>

            <p className="text-sm text-gray-400">
              {t('clients.invitation.description')}
            </p>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-400">
                {t('clients.invitation.link_label')}
              </label>
              <div className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2">
                <p className="break-all text-xs text-cyan">
                  {result.onboardingLink}
                </p>
              </div>
            </div>

            <p className="text-xs text-gray-500">
              {t('clients.invitation.expires')}:{' '}
              {new Date(result.expiresAt).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => copyToClipboard(result.onboardingLink, 'link')}
                className="rounded-lg bg-cyan px-4 py-2 text-sm font-semibold text-gray-950 hover:opacity-90"
              >
                {copied === 'link'
                  ? t('clients.invitation.copied')
                  : t('clients.invitation.copy_link')}
              </button>
              <button
                onClick={() => copyToClipboard(invitationMessage, 'message')}
                className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800"
              >
                {copied === 'message'
                  ? t('clients.invitation.copied')
                  : t('clients.invitation.copy_message')}
              </button>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={onClose}
                className="rounded-lg border border-gray-700 px-5 py-2 text-sm text-gray-300 hover:bg-gray-800"
              >
                {t('clients.form.close')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
