import { useTranslation } from 'react-i18next';

interface PickupLocationProps {
  pickupAddress: string | null;
  pickupContactName: string | null;
  pickupContactPhone: string | null;
  isAlternateLocation: boolean;
  pickupLocationNotes: string | null;
  /** Wrap long text instead of truncating (messenger card, order detail) */
  className?: string;
}

/** Where to collect the sample and who to ask for: address (Maps), contact (tap to call), notes. */
export function PickupLocation({
  pickupAddress,
  pickupContactName,
  pickupContactPhone,
  isAlternateLocation,
  pickupLocationNotes,
  className = '',
}: PickupLocationProps) {
  const { t } = useTranslation();

  if (!pickupAddress && !pickupContactName && !pickupContactPhone) return null;

  return (
    <div className={`space-y-0.5 text-sm ${className}`}>
      {isAlternateLocation && (
        <span className="mb-1 inline-flex rounded-full bg-purple/15 px-2 py-0.5 text-[10px] font-bold uppercase text-purple">
          {t('pickup_location.alternate_badge')}
        </span>
      )}
      {pickupAddress && (
        <p className="text-gray-300">
          {t('my_pickups.address')} {pickupAddress}{' '}
          <a
            href={`https://maps.google.com/?q=${encodeURIComponent(
              pickupAddress
            )}`}
            target="_blank"
            rel="noreferrer"
            className="text-cyan hover:underline"
          >
            {t('my_pickups.open_maps')}
          </a>
        </p>
      )}
      {pickupLocationNotes && (
        <p className="text-gray-400">
          {t('pickup_location.notes')} {pickupLocationNotes}
        </p>
      )}
      {(pickupContactName || pickupContactPhone) && (
        <p className="text-gray-400">
          {t('my_pickups.contact')} {pickupContactName}
          {pickupContactPhone && (
            <>
              {pickupContactName && ' · '}
              <a
                href={`tel:${pickupContactPhone}`}
                className="text-cyan hover:underline"
              >
                {pickupContactPhone}
              </a>
            </>
          )}
        </p>
      )}
    </div>
  );
}
