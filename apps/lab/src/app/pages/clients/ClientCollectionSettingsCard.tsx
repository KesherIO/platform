import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { labApi } from '../../shared/api/labApi';
import type { ClientDetail, DeliveryMethod } from '../../types/lab.types';

interface Props {
  client: ClientDetail;
  isAdmin: boolean;
  onUpdated: () => void;
  onError: (msg: string) => void;
}

interface FormState {
  pickupEnabled: boolean;
  defaultDeliveryMethod: DeliveryMethod;
  pickupAddress: string;
  pickupContactName: string;
  pickupContactPhone: string;
  collectionHours: string;
  pickupInstructions: string;
}

export function ClientCollectionSettingsCard({
  client,
  isAdmin,
  onUpdated,
  onError,
}: Props) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>({
    pickupEnabled: false,
    defaultDeliveryMethod: 'CLIENT_DELIVERY',
    pickupAddress: '',
    pickupContactName: '',
    pickupContactPhone: '',
    collectionHours: '',
    pickupInstructions: '',
  });

  const startEditing = () => {
    setForm({
      pickupEnabled: client.pickupEnabled,
      defaultDeliveryMethod: client.defaultDeliveryMethod ?? 'CLIENT_DELIVERY',
      pickupAddress: client.pickupAddress ?? '',
      pickupContactName: client.pickupContactName ?? '',
      pickupContactPhone: client.pickupContactPhone ?? '',
      collectionHours: client.collectionHours ?? '',
      pickupInstructions: client.pickupInstructions ?? '',
    });
    setEditing(true);
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await labApi.clients.updateCollectionSettings(
        client.id,
        form as unknown as Record<string, unknown>
      );
      setEditing(false);
      onUpdated();
    } catch (err) {
      onError(
        `${t('clients.collection_settings.errors.save')} ${
          (err as Error).message
        }`
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">
          {t('clients.collection_settings.title')}
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
          <label className="flex items-center gap-2 text-sm text-white">
            <input
              type="checkbox"
              checked={form.pickupEnabled}
              onChange={(e) =>
                setForm((f) => ({ ...f, pickupEnabled: e.target.checked }))
              }
              className="h-4 w-4 rounded border-gray-700 bg-gray-800 accent-cyan"
            />
            {t('clients.collection_settings.pickup_enabled')}
          </label>

          <div>
            <label className="mb-1 block text-xs text-gray-500">
              {t('clients.collection_settings.default_delivery')}
            </label>
            <select
              value={form.defaultDeliveryMethod}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  defaultDeliveryMethod: e.target.value as DeliveryMethod,
                }))
              }
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-cyan focus:outline-none"
            >
              <option value="CLIENT_DELIVERY">
                {t('pickup.CLIENT_DELIVERY')}
              </option>
              <option value="LAB_PICKUP">{t('pickup.LAB_PICKUP')}</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-500">
              {t('clients.collection_settings.pickup_address')}
            </label>
            <input
              value={form.pickupAddress}
              onChange={(e) =>
                setForm((f) => ({ ...f, pickupAddress: e.target.value }))
              }
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-cyan focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-500">
              {t('clients.collection_settings.pickup_contact_name')}
            </label>
            <input
              value={form.pickupContactName}
              onChange={(e) =>
                setForm((f) => ({ ...f, pickupContactName: e.target.value }))
              }
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-cyan focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-500">
              {t('clients.collection_settings.pickup_contact_phone')}
            </label>
            <input
              value={form.pickupContactPhone}
              onChange={(e) =>
                setForm((f) => ({ ...f, pickupContactPhone: e.target.value }))
              }
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-cyan focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-500">
              {t('clients.collection_settings.collection_hours')}
            </label>
            <input
              value={form.collectionHours}
              onChange={(e) =>
                setForm((f) => ({ ...f, collectionHours: e.target.value }))
              }
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-cyan focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-500">
              {t('clients.collection_settings.pickup_instructions')}
            </label>
            <textarea
              value={form.pickupInstructions}
              onChange={(e) =>
                setForm((f) => ({ ...f, pickupInstructions: e.target.value }))
              }
              rows={3}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-cyan focus:outline-none"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
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
              {t('clients.collection_settings.pickup_enabled')}
            </dt>
            <dd className="text-white">
              {client.pickupEnabled ? t('common.confirm') : t('common.cancel')}
            </dd>
          </div>
          {client.defaultDeliveryMethod && (
            <div>
              <dt className="text-xs text-gray-500">
                {t('clients.collection_settings.default_delivery')}
              </dt>
              <dd className="text-white">
                {t(`pickup.${client.defaultDeliveryMethod}`)}
              </dd>
            </div>
          )}
          {client.pickupAddress && (
            <div>
              <dt className="text-xs text-gray-500">
                {t('clients.collection_settings.pickup_address')}
              </dt>
              <dd className="text-white">{client.pickupAddress}</dd>
            </div>
          )}
          {client.pickupContactName && (
            <div>
              <dt className="text-xs text-gray-500">
                {t('clients.collection_settings.pickup_contact_name')}
              </dt>
              <dd className="text-white">
                {client.pickupContactName}
                {client.pickupContactPhone
                  ? ` · ${client.pickupContactPhone}`
                  : ''}
              </dd>
            </div>
          )}
          {client.collectionHours && (
            <div>
              <dt className="text-xs text-gray-500">
                {t('clients.collection_settings.collection_hours')}
              </dt>
              <dd className="text-white">{client.collectionHours}</dd>
            </div>
          )}
          {client.pickupInstructions && (
            <div>
              <dt className="text-xs text-gray-500">
                {t('clients.collection_settings.pickup_instructions')}
              </dt>
              <dd className="text-white">{client.pickupInstructions}</dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}
