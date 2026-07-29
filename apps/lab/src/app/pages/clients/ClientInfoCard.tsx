import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { labApi } from '../../shared/api/labApi';
import type { ClientDetail } from '../../types/lab.types';

interface Props {
  client: ClientDetail;
  isAdmin: boolean;
  onUpdated: () => void;
  onError: (msg: string) => void;
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

export function ClientInfoCard({ client, isAdmin, onUpdated, onError }: Props) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState({
    name: '',
    primaryContactName: '',
    primaryContactEmail: '',
    phone: '',
    address: '',
  });

  const startEditing = () => {
    setEditForm({
      name: client.name,
      primaryContactName: client.primaryContactName ?? '',
      primaryContactEmail: client.primaryContactEmail ?? '',
      phone: client.phone ?? '',
      address: client.address ?? '',
    });
    setEditing(true);
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await labApi.clients.update(client.id, editForm);
      setEditing(false);
      onUpdated();
    } catch (err) {
      onError(`${t('clients.errors.update')} ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">
          {t('clients.detail.info')}
        </h2>
        {isAdmin && !editing && (
          <button
            onClick={startEditing}
            className="text-xs text-cyan hover:underline"
          >
            {t('clients.detail.edit')}
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-gray-500">
              {t('clients.columns.name')}
            </label>
            <input
              value={editForm.name}
              onChange={(e) =>
                setEditForm((f) => ({ ...f, name: e.target.value }))
              }
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-cyan focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">
              {t('clients.form.contact_name')}
            </label>
            <input
              value={editForm.primaryContactName}
              onChange={(e) =>
                setEditForm((f) => ({
                  ...f,
                  primaryContactName: e.target.value,
                }))
              }
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-cyan focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">
              {t('clients.columns.contact')}
            </label>
            <input
              type="email"
              value={editForm.primaryContactEmail}
              onChange={(e) =>
                setEditForm((f) => ({
                  ...f,
                  primaryContactEmail: e.target.value,
                }))
              }
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-cyan focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">
              {t('clients.form.phone')}
            </label>
            <input
              value={editForm.phone}
              onChange={(e) =>
                setEditForm((f) => ({ ...f, phone: e.target.value }))
              }
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-cyan focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">
              {t('clients.form.address')}
            </label>
            <input
              value={editForm.address}
              onChange={(e) =>
                setEditForm((f) => ({ ...f, address: e.target.value }))
              }
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-cyan focus:outline-none"
            />
          </div>
          <div className="flex gap-2 pt-2">
            <button
              onClick={handleSave}
              disabled={saving || !editForm.name.trim()}
              className="rounded-lg bg-cyan px-4 py-2 text-sm font-semibold text-gray-950 hover:opacity-90 disabled:opacity-50"
            >
              {saving ? t('clients.detail.saving') : t('clients.detail.save')}
            </button>
            <button
              onClick={() => setEditing(false)}
              disabled={saving}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800"
            >
              {t('clients.form.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-xs text-gray-500">
              {t('clients.columns.name')}
            </dt>
            <dd className="text-white">{client.name}</dd>
          </div>
          {client.clientType && (
            <div>
              <dt className="text-xs text-gray-500">
                {t('clients.columns.type')}
              </dt>
              <dd className="text-white">
                {t(`clients.type.${client.clientType}`)}
              </dd>
            </div>
          )}
          {client.primaryContactName && (
            <div>
              <dt className="text-xs text-gray-500">
                {t('clients.form.contact_name')}
              </dt>
              <dd className="text-white">{client.primaryContactName}</dd>
            </div>
          )}
          <div>
            <dt className="text-xs text-gray-500">
              {t('clients.columns.contact')}
            </dt>
            <dd className="text-white">{client.primaryContactEmail}</dd>
          </div>
          {client.phone && (
            <div>
              <dt className="text-xs text-gray-500">
                {t('clients.form.phone')}
              </dt>
              <dd className="text-white">{client.phone}</dd>
            </div>
          )}
          {client.address && (
            <div>
              <dt className="text-xs text-gray-500">
                {t('clients.form.address')}
              </dt>
              <dd className="text-white">{client.address}</dd>
            </div>
          )}
          <div>
            <dt className="text-xs text-gray-500">
              {t('clients.columns.created')}
            </dt>
            <dd className="text-white">{formatDate(client.createdAt)}</dd>
          </div>
        </dl>
      )}

      {client.laboratoryName && (
        <div className="mt-4 border-t border-gray-800 pt-4">
          <h3 className="mb-1 text-xs font-medium text-gray-500">
            {t('clients.detail.lab_connection')}
          </h3>
          <p className="text-sm text-white">{client.laboratoryName}</p>
        </div>
      )}
    </div>
  );
}
