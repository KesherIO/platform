export interface CollectionSettingsSource {
  pickupAddress: string | null;
  pickupContactName: string | null;
  pickupContactPhone: string | null;
  pickupInstructions: string | null;
}

export interface ClinicProfileSource {
  address: string | null;
  city: string | null;
  phone: string | null;
  primaryContactName: string | null;
}

export interface AlternateLocationInput {
  address: string;
  contactName: string;
  contactPhone: string;
  notes?: string;
}

export interface ResolvedPickupLocation extends CollectionSettingsSource {
  isAlternateLocation: boolean;
  pickupLocationNotes: string | null;
}

const clean = (value: string | null | undefined): string | null =>
  value?.trim() || null;

/**
 * Decides what the messenger sees on a new pickup. An alternate location given
 * on the order wins outright. Otherwise each lab collection setting is used
 * when populated, falling back field by field to the clinic's own profile (the
 * city is appended to a fallback address). The result is snapshotted on the
 * Pickup, so later profile edits never move a scheduled pickup.
 */
export function resolvePickupLocation(
  connection: Partial<CollectionSettingsSource> | null | undefined,
  clinic: Partial<ClinicProfileSource> | null | undefined,
  alternate?: AlternateLocationInput
): ResolvedPickupLocation {
  const pickupInstructions = clean(connection?.pickupInstructions);

  if (alternate) {
    return {
      pickupAddress: alternate.address.trim(),
      pickupContactName: alternate.contactName.trim(),
      pickupContactPhone: alternate.contactPhone.trim(),
      pickupInstructions,
      isAlternateLocation: true,
      pickupLocationNotes: clean(alternate.notes),
    };
  }

  const clinicAddress = [clean(clinic?.address), clean(clinic?.city)]
    .filter(Boolean)
    .join(', ');

  return {
    pickupAddress: clean(connection?.pickupAddress) ?? (clinicAddress || null),
    pickupContactName:
      clean(connection?.pickupContactName) ?? clean(clinic?.primaryContactName),
    pickupContactPhone:
      clean(connection?.pickupContactPhone) ?? clean(clinic?.phone),
    pickupInstructions,
    isAlternateLocation: false,
    pickupLocationNotes: null,
  };
}
