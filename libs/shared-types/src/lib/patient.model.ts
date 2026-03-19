export type Species = 'canine' | 'feline' | 'avian' | 'exotic';
export type Sex = 'male' | 'female' | 'neutered_male' | 'spayed_female';

export interface Patient {
  id?: string;
  name: string;
  species: Species;
  breed?: string;
  ageMonths: number;
  weightKg: number;
  sex: Sex;
  ownerId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}