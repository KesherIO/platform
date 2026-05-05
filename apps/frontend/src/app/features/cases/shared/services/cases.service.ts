import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, delay, tap, map, catchError } from 'rxjs';
import {
  CaseModel,
  CaseStatus,
  PatientSpecies,
  PatientSex,
  AgeUnit,
  TriageResultModel,
  ResultReportModel,
} from '@vet-ai/shared-types';
import { AuthService } from '../../../../core/services/auth.service';
import { MOCK_CATALOG_ITEMS } from '../../../../core/services/catalog.service';

const MOCK_DELAY = 600;

const MOCK_TRIAGE: TriageResultModel = {
  diagnoses: [
    {
      name: 'Gastroenteritis',
      confidence: 82,
      explanation: 'Vomiting and lethargy are consistent with GI upset.',
    },
    {
      name: 'Pancreatitis',
      confidence: 61,
      explanation:
        'Abdominal pain and vomiting may indicate pancreatic inflammation.',
    },
    {
      name: 'Hepatic Disease',
      confidence: 34,
      explanation: 'Lethargy and anorexia can be signs of liver involvement.',
    },
  ],
  suggestedCatalogItemIds: ['t1', 't2', 't3', 'p1'],
};

const MOCK_REPORT: ResultReportModel = {
  id: 'report-001',
  orderId: 'ORD-0002',
  caseId: 'c4',
  tenantId: 'tenant1',
  templateId: 'tpl-cbc-dog-adult',
  status: 'RELEASED',
  observations:
    'Tipo de muestra: Sangre entera anticoagulada con EDTA. Se observan leucocitos y plaquetas normales en tamaño y morfología. Resultado confirmado en placa.',
  processedByName: 'Vivian Andrea Plialonga Quintero',
  processedByRole: 'Analista de Laboratorio',
  processedByCredentials: 'Microbióloga — Universidad Santiago de Cali',
  approvedByName: 'Carlos Alberto Canaval Ocampo',
  approvedByRole: 'Jefe de Bacteriología y Laboratorio Clínico',
  approvedByCredentials:
    'Bacteriólogo y Laboratorista Clínico — Universidad del Valle — Registro No. 767658',
  releasedAt: new Date('2026-03-29T11:59:00'),
  createdAt: new Date('2026-03-28T09:00:00'),
  updatedAt: new Date('2026-03-29T11:59:00'),
  analytes: [
    // SERIE ROJA
    {
      id: 'a1', reportId: 'report-001', code: 'RBC', name: 'Recuento total de eritrocitos (RBC)',
      technique: 'Impedancia eléctrica', sectionName: 'SERIE ROJA',
      valueType: 'NUMERIC', unit: '10^6/µL', sortOrder: 1, isHeader: false,
      numericValue: 6.76, flag: 'N',
      referenceSnapshot: { min: 5.5, max: 8.5, displayText: '5.50 - 8.50' },
    },
    {
      id: 'a2', reportId: 'report-001', code: 'HGB', name: 'Hemoglobina',
      technique: 'Colorimétrico', sectionName: 'SERIE ROJA',
      valueType: 'NUMERIC', unit: 'g/dL', sortOrder: 2, isHeader: false,
      numericValue: 14.7, flag: 'N',
      referenceSnapshot: { min: 12.0, max: 18.0, displayText: '12.0 - 18.0' },
    },
    {
      id: 'a3', reportId: 'report-001', code: 'HCT', name: 'Hematocrito',
      technique: 'Parámetro calculado', sectionName: 'SERIE ROJA',
      valueType: 'NUMERIC', unit: '%', sortOrder: 3, isHeader: false,
      numericValue: 44.2, flag: 'N',
      referenceSnapshot: { min: 37, max: 55, displayText: '37.0 - 55.0' },
    },
    {
      id: 'a4', reportId: 'report-001', code: 'MCV', name: 'MCV',
      technique: 'Derivado histogramas', sectionName: 'SERIE ROJA',
      valueType: 'NUMERIC', unit: 'fL', sortOrder: 4, isHeader: false,
      numericValue: 65.4, flag: 'N',
      referenceSnapshot: { min: 60, max: 77, displayText: '60.0 - 77.0' },
    },
    {
      id: 'a5', reportId: 'report-001', code: 'MCH', name: 'MCH',
      technique: 'Parámetro calculado', sectionName: 'SERIE ROJA',
      valueType: 'NUMERIC', unit: 'pg', sortOrder: 5, isHeader: false,
      numericValue: 21.7, flag: 'N',
      referenceSnapshot: { min: 19, max: 26, displayText: '19.0 - 26.0' },
    },
    {
      id: 'a6', reportId: 'report-001', code: 'MCHC', name: 'MCHC',
      technique: 'Parámetro calculado', sectionName: 'SERIE ROJA',
      valueType: 'NUMERIC', unit: 'g/dL', sortOrder: 6, isHeader: false,
      numericValue: 33.3, flag: 'N',
      referenceSnapshot: { min: 31, max: 36, displayText: '31.0 - 36.0' },
    },
    // SERIE BLANCA
    {
      id: 'a7', reportId: 'report-001', code: 'WBC', name: 'Recuento total de leucocitos (WBC)',
      technique: 'Impedancia eléctrica', sectionName: 'SERIE BLANCA',
      valueType: 'NUMERIC', unit: '10^3/µL', sortOrder: 7, isHeader: false,
      numericValue: 11.3, flag: 'N',
      referenceSnapshot: { min: 6, max: 17, displayText: '6.0 - 17.0' },
    },
    {
      id: 'a8', reportId: 'report-001', code: 'DIFF_HEADER', name: 'Recuento diferencial',
      sectionName: 'SERIE BLANCA', valueType: 'TEXT', sortOrder: 8, isHeader: true,
    },
    {
      id: 'a9', reportId: 'report-001', code: 'NEU_PCT', name: 'Neutrófilos porcentaje',
      technique: 'Recuento en placa', sectionName: 'SERIE BLANCA',
      valueType: 'NUMERIC', unit: '%', sortOrder: 9, isHeader: false,
      numericValue: 77, flag: 'N',
      referenceSnapshot: { min: 60, max: 77, displayText: '60 - 77' },
    },
    {
      id: 'a10', reportId: 'report-001', code: 'NEU_ABS', name: 'Neutrófilos absoluto',
      technique: 'Parámetro calculado', sectionName: 'SERIE BLANCA',
      valueType: 'NUMERIC', unit: '10^3/µL', sortOrder: 10, isHeader: false,
      numericValue: 8.7, flag: 'N',
      referenceSnapshot: { min: 3.6, max: 13, displayText: '3.6 - 13.0' },
    },
    {
      id: 'a11', reportId: 'report-001', code: 'LYM_PCT', name: 'Linfocitos porcentaje',
      technique: 'Recuento en placa', sectionName: 'SERIE BLANCA',
      valueType: 'NUMERIC', unit: '%', sortOrder: 11, isHeader: false,
      numericValue: 21, flag: 'N',
      referenceSnapshot: { min: 12, max: 30, displayText: '12 - 30' },
    },
    {
      id: 'a12', reportId: 'report-001', code: 'LYM_ABS', name: 'Linfocitos absoluto',
      technique: 'Parámetro calculado', sectionName: 'SERIE BLANCA',
      valueType: 'NUMERIC', unit: '10^3/µL', sortOrder: 12, isHeader: false,
      numericValue: 2.4, flag: 'N',
      referenceSnapshot: { min: 0.7, max: 5.1, displayText: '0.7 - 5.1' },
    },
    {
      id: 'a13', reportId: 'report-001', code: 'MON_PCT', name: 'Monocitos porcentaje',
      technique: 'Recuento en placa', sectionName: 'SERIE BLANCA',
      valueType: 'NUMERIC', unit: '%', sortOrder: 13, isHeader: false,
      numericValue: 2, flag: 'N',
      referenceSnapshot: { min: 0, max: 8, displayText: '0 - 8' },
    },
    {
      id: 'a14', reportId: 'report-001', code: 'MON_ABS', name: 'Monocitos absoluto',
      technique: 'Parámetro calculado', sectionName: 'SERIE BLANCA',
      valueType: 'NUMERIC', unit: '10^3/µL', sortOrder: 14, isHeader: false,
      numericValue: 0.2, flag: 'N',
      referenceSnapshot: { min: 0, max: 1.3, displayText: '0.0 - 1.3' },
    },
    {
      id: 'a15', reportId: 'report-001', code: 'EOS_PCT', name: 'Eosinófilos porcentaje',
      technique: 'Recuento en placa', sectionName: 'SERIE BLANCA',
      valueType: 'NUMERIC', unit: '%', sortOrder: 15, isHeader: false,
      numericValue: 0, flag: 'N',
      referenceSnapshot: { min: 0, max: 5, displayText: '0 - 5' },
    },
    {
      id: 'a16', reportId: 'report-001', code: 'EOS_ABS', name: 'Eosinófilos absoluto',
      technique: 'Parámetro calculado', sectionName: 'SERIE BLANCA',
      valueType: 'NUMERIC', unit: '10^3/µL', sortOrder: 16, isHeader: false,
      numericValue: 0, flag: 'N',
      referenceSnapshot: { min: 0, max: 0.9, displayText: '0.0 - 0.9' },
    },
    {
      id: 'a17', reportId: 'report-001', code: 'BAS_PCT', name: 'Basófilos porcentaje',
      technique: 'Recuento en placa', sectionName: 'SERIE BLANCA',
      valueType: 'NUMERIC', unit: '%', sortOrder: 17, isHeader: false,
      numericValue: 0, flag: 'N',
      referenceSnapshot: { min: 0, max: 2, displayText: '0 - 2' },
    },
    {
      id: 'a18', reportId: 'report-001', code: 'BAS_ABS', name: 'Basófilos absoluto',
      technique: 'Parámetro calculado', sectionName: 'SERIE BLANCA',
      valueType: 'NUMERIC', unit: '10^3/µL', sortOrder: 18, isHeader: false,
      numericValue: 0, flag: 'N',
      referenceSnapshot: { min: 0, max: 0.3, displayText: '0.0 - 0.3' },
    },
    {
      id: 'a19', reportId: 'report-001', code: 'BND_PCT', name: 'Bandas porcentaje',
      technique: 'Recuento en placa', sectionName: 'SERIE BLANCA',
      valueType: 'NUMERIC', unit: '%', sortOrder: 19, isHeader: false,
      numericValue: 0, flag: 'N',
      referenceSnapshot: { min: 0, max: 3, displayText: '0 - 3' },
    },
    {
      id: 'a20', reportId: 'report-001', code: 'BND_ABS', name: 'Bandas absoluto',
      technique: 'Parámetro calculado', sectionName: 'SERIE BLANCA',
      valueType: 'NUMERIC', unit: '10^3/µL', sortOrder: 20, isHeader: false,
      numericValue: 0, flag: 'N',
      referenceSnapshot: { min: 0, max: 0.5, displayText: '0.0 - 0.5' },
    },
    // PLAQUETAS
    {
      id: 'a21', reportId: 'report-001', code: 'PLT', name: 'Recuento total de plaquetas (PLT)',
      technique: 'Impedancia Eléctrica', sectionName: 'PLAQUETAS',
      valueType: 'NUMERIC', unit: '10^3/µL', sortOrder: 21, isHeader: false,
      numericValue: 226, flag: 'N',
      referenceSnapshot: { min: 200, max: 500, displayText: '200 - 500' },
    },
    {
      id: 'a22', reportId: 'report-001', code: 'MPV', name: 'MPV (volumen medio plaquetario)',
      technique: 'Derivado histogramas', sectionName: 'PLAQUETAS',
      valueType: 'NUMERIC', unit: 'fL', sortOrder: 22, isHeader: false,
      numericValue: 11.1, flag: 'N',
      referenceSnapshot: { min: 3.9, max: 11.1, displayText: '3.9 - 11.1' },
    },
  ],
};

let mockCases: CaseModel[] = [
  // --- DOGS ---
  {
    id: 'c1',
    tenantId: 'tenant1',
    status: CaseStatus.OPEN,
    patientName: 'Max',
    patientSpecies: PatientSpecies.DOG,
    patientBreed: 'Labrador',
    patientAge: 3,
    patientAgeUnit: AgeUnit.YEARS,
    patientWeight: 28,
    ownerName: 'Carlos Ramírez',
    ownerPhone: '+52 555 0001',
    createdByUserId: 'u1',
    createdAt: new Date('2026-04-07'),
    updatedAt: new Date('2026-04-07'),
  },
  {
    id: 'c2',
    tenantId: 'tenant1',
    status: CaseStatus.TRIAGED,
    patientName: 'Rocky',
    patientSpecies: PatientSpecies.DOG,
    patientBreed: 'Bulldog',
    patientAge: 7,
    patientAgeUnit: AgeUnit.YEARS,
    patientWeight: 22,
    ownerName: 'Luis Mendoza',
    ownerPhone: '+52 555 0002',
    symptoms: 'Limping and decreased appetite',
    triageResult: MOCK_TRIAGE,
    suggestedCatalogItemIds: MOCK_TRIAGE.suggestedCatalogItemIds,
    createdByUserId: 'u1',
    createdAt: new Date('2026-04-06'),
    updatedAt: new Date('2026-04-06'),
  },
  {
    id: 'c3',
    tenantId: 'tenant1',
    status: CaseStatus.ORDERED,
    patientName: 'Buddy',
    patientSpecies: PatientSpecies.DOG,
    patientBreed: 'Golden Retriever',
    patientAge: 5,
    patientAgeUnit: AgeUnit.YEARS,
    patientWeight: 32,
    ownerName: 'Martina Flores',
    ownerPhone: '+52 555 0003',
    symptoms: 'Skin irritation and scratching',
    selectedCatalogItems: MOCK_CATALOG_ITEMS.filter((i) =>
      ['t1', 't2'].includes(i.id)
    ),
    orderSentAt: new Date('2026-04-05'),
    order: { orderId: 'ORD-0001', status: 'ORDERED' },
    createdByUserId: 'u1',
    createdAt: new Date('2026-04-05'),
    updatedAt: new Date('2026-04-05'),
  },
  {
    id: 'c4',
    tenantId: 'tenant1',
    status: CaseStatus.COMPLETED,
    patientName: 'Zeus',
    patientSpecies: PatientSpecies.DOG,
    patientBreed: 'German Shepherd',
    patientAge: 4,
    patientAgeUnit: AgeUnit.YEARS,
    patientWeight: 35,
    ownerName: 'Roberto Gutiérrez',
    ownerPhone: '+52 555 0004',
    symptoms: 'Ear infection and head shaking',
    selectedCatalogItems: MOCK_CATALOG_ITEMS.filter((i) =>
      ['t1', 'p1'].includes(i.id)
    ),
    orderSentAt: new Date('2026-03-28'),
    order: { orderId: 'ORD-0002', status: 'COMPLETED' },
    createdByUserId: 'u1',
    createdAt: new Date('2026-03-27'),
    updatedAt: new Date('2026-03-29'),
  },
  {
    id: 'c5',
    tenantId: 'tenant1',
    status: CaseStatus.OPEN,
    patientName: 'Charlie',
    patientSpecies: PatientSpecies.DOG,
    patientBreed: 'Beagle',
    patientAge: 2,
    patientAgeUnit: AgeUnit.YEARS,
    patientWeight: 12,
    ownerName: 'Valeria Ríos',
    ownerPhone: '+52 555 0005',
    createdByUserId: 'u1',
    createdAt: new Date('2026-04-07'),
    updatedAt: new Date('2026-04-07'),
  },
  {
    id: 'c6',
    tenantId: 'tenant1',
    status: CaseStatus.OPEN,
    patientName: 'Toby',
    patientSpecies: PatientSpecies.DOG,
    patientBreed: 'Poodle',
    patientAge: 6,
    patientAgeUnit: AgeUnit.YEARS,
    patientWeight: 8,
    ownerName: 'Fernando Salinas',
    ownerPhone: '+52 555 0006',
    createdByUserId: 'u1',
    createdAt: new Date('2026-04-06'),
    updatedAt: new Date('2026-04-06'),
  },
  {
    id: 'c7',
    tenantId: 'tenant1',
    status: CaseStatus.CANCELLED,
    patientName: 'Duke',
    patientSpecies: PatientSpecies.DOG,
    patientBreed: 'Rottweiler',
    patientAge: 9,
    patientAgeUnit: AgeUnit.YEARS,
    patientWeight: 48,
    ownerName: 'Isabel Moreno',
    ownerPhone: '+52 555 0007',
    symptoms: 'Joint stiffness',
    createdByUserId: 'u1',
    createdAt: new Date('2026-04-01'),
    updatedAt: new Date('2026-04-02'),
  },
  {
    id: 'c8',
    tenantId: 'tenant1',
    status: CaseStatus.ORDERED,
    patientName: 'Coco',
    patientSpecies: PatientSpecies.DOG,
    patientBreed: 'Chihuahua',
    patientAge: 4,
    patientAgeUnit: AgeUnit.YEARS,
    patientWeight: 2.5,
    ownerName: 'Patricia Álvarez',
    ownerPhone: '+52 555 0008',
    symptoms: 'Trembling and low energy',
    selectedCatalogItems: MOCK_CATALOG_ITEMS.filter((i) =>
      ['t2', 't3'].includes(i.id)
    ),
    orderSentAt: new Date('2026-04-04'),
    order: { orderId: 'ORD-0003', status: 'ORDERED' },
    createdByUserId: 'u1',
    createdAt: new Date('2026-04-03'),
    updatedAt: new Date('2026-04-04'),
  },
  {
    id: 'c9',
    tenantId: 'tenant1',
    status: CaseStatus.TRIAGED,
    patientName: 'Milo',
    patientSpecies: PatientSpecies.DOG,
    patientBreed: 'Dachshund',
    patientAge: 5,
    patientAgeUnit: AgeUnit.YEARS,
    patientWeight: 9,
    ownerName: 'Andrés Castillo',
    ownerPhone: '+52 555 0009',
    symptoms: 'Back pain and reluctance to move',
    triageResult: MOCK_TRIAGE,
    suggestedCatalogItemIds: MOCK_TRIAGE.suggestedCatalogItemIds,
    createdByUserId: 'u1',
    createdAt: new Date('2026-04-05'),
    updatedAt: new Date('2026-04-05'),
  },
  {
    id: 'c10',
    tenantId: 'tenant1',
    status: CaseStatus.COMPLETED,
    patientName: 'Bear',
    patientSpecies: PatientSpecies.DOG,
    patientBreed: 'Husky',
    patientAge: 3,
    patientAgeUnit: AgeUnit.YEARS,
    patientWeight: 27,
    ownerName: 'Camila Vargas',
    ownerPhone: '+52 555 0010',
    symptoms: 'Eye discharge and redness',
    selectedCatalogItems: MOCK_CATALOG_ITEMS.filter((i) =>
      ['t1', 't4'].includes(i.id)
    ),
    orderSentAt: new Date('2026-03-15'),
    order: { orderId: 'ORD-0004', status: 'COMPLETED' },
    createdByUserId: 'u1',
    createdAt: new Date('2026-03-14'),
    updatedAt: new Date('2026-03-16'),
  },
  // --- CATS ---
  {
    id: 'c11',
    tenantId: 'tenant1',
    status: CaseStatus.TRIAGED,
    patientName: 'Luna',
    patientSpecies: PatientSpecies.CAT,
    patientBreed: 'Siamese',
    patientAge: 5,
    patientAgeUnit: AgeUnit.YEARS,
    patientWeight: 4,
    ownerName: 'Ana Torres',
    ownerPhone: '+52 555 0011',
    symptoms: 'Vomiting and lethargy for 2 days',
    triageResult: MOCK_TRIAGE,
    suggestedCatalogItemIds: MOCK_TRIAGE.suggestedCatalogItemIds,
    createdByUserId: 'u1',
    createdAt: new Date('2026-04-06'),
    updatedAt: new Date('2026-04-06'),
  },
  {
    id: 'c12',
    tenantId: 'tenant1',
    status: CaseStatus.OPEN,
    patientName: 'Nala',
    patientSpecies: PatientSpecies.CAT,
    patientBreed: 'Persian',
    patientAge: 3,
    patientAgeUnit: AgeUnit.YEARS,
    patientWeight: 3.5,
    ownerName: 'Gabriela Reyes',
    ownerPhone: '+52 555 0012',
    createdByUserId: 'u1',
    createdAt: new Date('2026-04-07'),
    updatedAt: new Date('2026-04-07'),
  },
  {
    id: 'c13',
    tenantId: 'tenant1',
    status: CaseStatus.ORDERED,
    patientName: 'Simba',
    patientSpecies: PatientSpecies.CAT,
    patientBreed: 'Maine Coon',
    patientAge: 6,
    patientAgeUnit: AgeUnit.YEARS,
    patientWeight: 6.5,
    ownerName: 'Eduardo Romero',
    ownerPhone: '+52 555 0013',
    symptoms: 'Urinary issues and frequent licking',
    selectedCatalogItems: MOCK_CATALOG_ITEMS.filter((i) =>
      ['t3', 't4'].includes(i.id)
    ),
    orderSentAt: new Date('2026-04-03'),
    order: { orderId: 'ORD-0005', status: 'ORDERED' },
    createdByUserId: 'u1',
    createdAt: new Date('2026-04-02'),
    updatedAt: new Date('2026-04-03'),
  },
  {
    id: 'c14',
    tenantId: 'tenant1',
    status: CaseStatus.COMPLETED,
    patientName: 'Mittens',
    patientSpecies: PatientSpecies.CAT,
    patientBreed: 'Ragdoll',
    patientAge: 8,
    patientAgeUnit: AgeUnit.YEARS,
    patientWeight: 5,
    ownerName: 'Lucía Peña',
    ownerPhone: '+52 555 0014',
    symptoms: 'Weight loss and increased thirst',
    selectedCatalogItems: MOCK_CATALOG_ITEMS.filter((i) =>
      ['t2', 't5'].includes(i.id)
    ),
    orderSentAt: new Date('2026-03-10'),
    order: { orderId: 'ORD-0006', status: 'COMPLETED' },
    createdByUserId: 'u1',
    createdAt: new Date('2022-03-09'),
    updatedAt: new Date('2022-03-11'),
  },
  {
    id: 'c15',
    tenantId: 'tenant1',
    status: CaseStatus.OPEN,
    patientName: 'Oliver',
    patientSpecies: PatientSpecies.CAT,
    patientBreed: 'British Shorthair',
    patientAge: 2,
    patientAgeUnit: AgeUnit.YEARS,
    patientWeight: 4.2,
    ownerName: 'Santiago Ibarra',
    ownerPhone: '+52 555 0015',
    createdByUserId: 'u1',
    createdAt: new Date('2026-04-07'),
    updatedAt: new Date('2026-04-07'),
  },
  {
    id: 'c16',
    tenantId: 'tenant1',
    status: CaseStatus.TRIAGED,
    patientName: 'Whiskers',
    patientSpecies: PatientSpecies.CAT,
    patientBreed: 'Bengal',
    patientAge: 4,
    patientAgeUnit: AgeUnit.YEARS,
    patientWeight: 5.5,
    ownerName: 'Daniela Ortega',
    ownerPhone: '+52 555 0016',
    symptoms: 'Sneezing and nasal discharge',
    triageResult: MOCK_TRIAGE,
    suggestedCatalogItemIds: MOCK_TRIAGE.suggestedCatalogItemIds,
    createdByUserId: 'u1',
    createdAt: new Date('2026-04-04'),
    updatedAt: new Date('2026-04-04'),
  },
  {
    id: 'c17',
    tenantId: 'tenant1',
    status: CaseStatus.OPEN,
    patientName: 'Shadow',
    patientSpecies: PatientSpecies.CAT,
    patientBreed: 'Domestic Shorthair',
    patientAge: 1,
    patientAgeUnit: AgeUnit.YEARS,
    patientWeight: 3.8,
    ownerName: 'Javier Núñez',
    ownerPhone: '+52 555 0017',
    createdByUserId: 'u1',
    createdAt: new Date('2026-04-06'),
    updatedAt: new Date('2026-04-06'),
  },
  // --- OTHER SPECIES ---
  {
    id: 'c18',
    tenantId: 'tenant1',
    status: CaseStatus.COMPLETED,
    patientName: 'Pegasus',
    patientSpecies: PatientSpecies.EQUINE,
    patientBreed: 'Thoroughbred',
    patientAge: 10,
    patientAgeUnit: AgeUnit.YEARS,
    patientWeight: 480,
    ownerName: 'Sofía Herrera',
    ownerPhone: '+52 555 0018',
    symptoms: 'Lameness in left foreleg',
    selectedCatalogItems: MOCK_CATALOG_ITEMS.filter((i) =>
      ['t1', 't4'].includes(i.id)
    ),
    orderSentAt: new Date('2026-03-20'),
    order: { orderId: 'ORD-0007', status: 'COMPLETED' },
    createdByUserId: 'u1',
    createdAt: new Date('2026-03-19'),
    updatedAt: new Date('2026-03-21'),
  },
  {
    id: 'c19',
    tenantId: 'tenant1',
    status: CaseStatus.OPEN,
    patientName: 'Bessie',
    patientSpecies: PatientSpecies.BOVINE,
    patientBreed: 'Holstein',
    patientAge: 4,
    patientAgeUnit: AgeUnit.YEARS,
    patientWeight: 550,
    ownerName: 'Jorge Vega',
    ownerPhone: '+52 555 0019',
    createdByUserId: 'u1',
    createdAt: new Date('2026-04-05'),
    updatedAt: new Date('2026-04-05'),
  },
  {
    id: 'c20',
    tenantId: 'tenant1',
    status: CaseStatus.TRIAGED,
    patientName: 'Kiwi',
    patientSpecies: PatientSpecies.BIRD,
    patientBreed: 'African Grey',
    patientAge: 8,
    patientAgeUnit: AgeUnit.MONTHS,
    patientWeight: 0.4,
    ownerName: 'Mariana López',
    ownerPhone: '+52 555 0020',
    symptoms: 'Feather plucking and reduced appetite',
    triageResult: MOCK_TRIAGE,
    suggestedCatalogItemIds: MOCK_TRIAGE.suggestedCatalogItemIds,
    createdByUserId: 'u1',
    createdAt: new Date('2026-04-06'),
    updatedAt: new Date('2026-04-06'),
  },
  {
    id: 'c21',
    tenantId: 'tenant1',
    status: CaseStatus.OPEN,
    patientName: 'Draco',
    patientSpecies: PatientSpecies.REPTILE,
    patientBreed: 'Bearded Dragon',
    patientAge: 2,
    patientAgeUnit: AgeUnit.YEARS,
    patientWeight: 0.45,
    ownerName: 'Diego Fuentes',
    ownerPhone: '+52 555 0021',
    createdByUserId: 'u1',
    createdAt: new Date('2026-04-06'),
    updatedAt: new Date('2026-04-06'),
  },
  {
    id: 'c22',
    tenantId: 'tenant1',
    status: CaseStatus.CANCELLED,
    patientName: 'Thumper',
    patientSpecies: PatientSpecies.RABBIT,
    patientBreed: 'Holland Lop',
    patientAge: 18,
    patientAgeUnit: AgeUnit.MONTHS,
    patientWeight: 1.8,
    ownerName: 'Valentina Cruz',
    ownerPhone: '+52 555 0022',
    symptoms: 'Head tilt and loss of balance',
    createdByUserId: 'u1',
    createdAt: new Date('2026-04-02'),
    updatedAt: new Date('2026-04-02'),
  },
  {
    id: 'c23',
    tenantId: 'tenant1',
    status: CaseStatus.OPEN,
    patientName: 'Nemo',
    patientSpecies: PatientSpecies.OTHER,
    patientBreed: 'Axolotl',
    patientAge: 1,
    patientAgeUnit: AgeUnit.YEARS,
    patientWeight: 0.1,
    ownerName: 'Renata Ibáñez',
    ownerPhone: '+52 555 0023',
    createdByUserId: 'u1',
    createdAt: new Date('2026-04-07'),
    updatedAt: new Date('2026-04-07'),
  },
];

@Injectable({ providedIn: 'root' })
export class CasesService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  private get tenantHeaders() {
    const me = this.auth.me();
    const tenantId = me?.activeTenantId ?? me?.tenants[0]?.id ?? '';
    return { headers: { 'x-tenant-id': tenantId } };
  }

  activeCase = signal<CaseModel | null>(null);

  listCases(params?: {
    search?: string;
    status?: CaseStatus;
    species?: PatientSpecies;
  }): Observable<CaseModel[]> {
    return this.http.get<CaseModel[]>('/api/cases', this.tenantHeaders).pipe(
      catchError(() => of([] as CaseModel[])),
      map((cases) => (cases.length === 0 ? mockCases : cases)),
      map((cases) => {
        let result = cases;
        if (params?.search) {
          const q = params.search.toLowerCase();
          result = result.filter(
            (c) =>
              c.patientName.toLowerCase().includes(q) ||
              c.ownerName.toLowerCase().includes(q)
          );
        }
        if (params?.status) {
          result = result.filter((c) => c.status === params.status);
        }
        if (params?.species) {
          result = result.filter((c) => c.patientSpecies === params.species);
        }
        return result;
      })
    );
  }

  getCase(id: string): Observable<CaseModel> {
    return this.http
      .get<CaseModel>(`/api/cases/${id}`, this.tenantHeaders)
      .pipe(
        catchError(() => {
          const found = mockCases.find((c) => c.id === id);
          if (found) return of(found).pipe(delay(MOCK_DELAY));
          return of(mockCases[0]).pipe(delay(MOCK_DELAY));
        }),
        tap((c) => this.activeCase.set(c))
      );
  }

  searchCases(query: string): Observable<CaseModel[]> {
    if (!query.trim()) return of([]);
    return this.http.get<CaseModel[]>('/api/cases', this.tenantHeaders).pipe(
      map((cases) => {
        const q = query.toLowerCase();
        return cases
          .filter(
            (c) =>
              c.patientName.toLowerCase().includes(q) ||
              c.ownerName.toLowerCase().includes(q)
          )
          .slice(0, 5);
      })
    );
  }

  createCase(data: {
    patientName: string;
    patientSpecies: PatientSpecies;
    patientSex?: PatientSex;
    patientBreed?: string;
    patientDateOfBirth?: string;
    patientAge?: number;
    patientAgeUnit?: AgeUnit;
    patientWeight?: number;
    ownerName: string;
    ownerPhone?: string;
  }): Observable<CaseModel> {
    return this.http
      .post<CaseModel>('/api/cases', data, this.tenantHeaders)
      .pipe(tap((c) => this.activeCase.set(c)));
  }

  updateCase(
    id: string,
    data: Partial<
      Pick<
        CaseModel,
        | 'patientName'
        | 'patientSpecies'
        | 'patientSex'
        | 'patientBreed'
        | 'patientDateOfBirth'
        | 'patientAge'
        | 'patientAgeUnit'
        | 'patientWeight'
        | 'ownerName'
        | 'ownerPhone'
      >
    >
  ): Observable<CaseModel> {
    return this.http
      .patch<CaseModel>(`/api/cases/${id}`, data, this.tenantHeaders)
      .pipe(tap((c) => this.activeCase.set(c)));
  }

  updateSymptoms(id: string, symptoms: string): Observable<CaseModel> {
    return this.http
      .patch<CaseModel>(
        `/api/cases/${id}/symptoms`,
        { symptoms },
        this.tenantHeaders
      )
      .pipe(tap((c) => this.activeCase.set(c)));
  }

  triggerTriage(id: string): Observable<CaseModel> {
    return this.http
      .post<CaseModel>(`/api/cases/${id}/triage`, {}, this.tenantHeaders)
      .pipe(tap((c) => this.activeCase.set(c)));
  }

  updateCatalogSelection(
    id: string,
    catalogItemIds: string[]
  ): Observable<CaseModel> {
    return this.http
      .patch<CaseModel>(
        `/api/cases/${id}/catalog-selection`,
        { selectedCatalogItemIds: catalogItemIds },
        this.tenantHeaders
      )
      .pipe(tap((c) => this.activeCase.set(c)));
  }

  createOrder(
    id: string
  ): Observable<{ orderId: string; requisitionUrl: string }> {
    return this.http
      .post<{ id: string; requisitionNumber: string; requisitionUrl: string }>(
        `/api/cases/${id}/order`,
        {},
        this.tenantHeaders
      )
      .pipe(
        map((order) => ({
          orderId: order.requisitionNumber,
          requisitionUrl: order.requisitionUrl,
        }))
      );
  }

  cancelCase(id: string): Observable<CaseModel> {
    return this.http
      .post<CaseModel>(`/api/cases/${id}/cancel`, {}, this.tenantHeaders)
      .pipe(tap((c) => this.activeCase.set(c)));
  }

  deleteCase(id: string): Observable<void> {
    mockCases = mockCases.filter((c) => c.id !== id);
    if (this.activeCase()?.id === id) this.activeCase.set(null);
    // TODO: Replace with actual API call DELETE /cases/:id
    return of(undefined).pipe(delay(MOCK_DELAY));
  }

  getReportByOrderId(orderId: string): Observable<ResultReportModel> {
    if (orderId === 'ORD-0002') {
      return of(MOCK_REPORT).pipe(delay(MOCK_DELAY));
    }
    return this.http.get<ResultReportModel>(
      `/api/results/by-order/${orderId}`,
      this.tenantHeaders
    );
  }
}
