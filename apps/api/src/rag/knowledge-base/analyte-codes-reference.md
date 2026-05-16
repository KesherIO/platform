---
id: analyte-codes-reference
title: Analyte Code Reference — Standard Mappings
tags: [reference, analytes, CBC, chemistry]
---

## Purpose

This document defines the stable analyte codes used across all knowledge base documents. These codes are the canonical identifiers for matching lab result analytes to clinical knowledge during RAG retrieval.

## CBC Analytes

| Code  | Full Name                          | Unit         | Notes                                         |
| ----- | ---------------------------------- | ------------ | --------------------------------------------- |
| WBC   | White Blood Cells                  | ×10³/μL      | Total leukocyte count                         |
| RBC   | Red Blood Cells                    | ×10⁶/μL      | Total erythrocyte count                       |
| HGB   | Hemoglobin                         | g/dL         | Oxygen-carrying protein                       |
| HCT   | Hematocrit (Packed Cell Volume)    | %            | Also called PCV                               |
| MCV   | Mean Corpuscular Volume            | fL           | Average RBC size                              |
| MCH   | Mean Corpuscular Hemoglobin        | pg           | Average HGB per RBC                           |
| MCHC  | Mean Corpuscular HGB Concentration | g/dL         | HGB concentration within RBCs                 |
| RDW   | Red Cell Distribution Width        | %            | Variability in RBC size                       |
| PLT   | Platelets (Thrombocytes)           | ×10³/μL      | Thrombocyte count                             |
| MPV   | Mean Platelet Volume               | fL           | Average platelet size                         |
| NEU   | Neutrophils (Absolute)             | ×10³/μL      | Segmented + bands                             |
| LYM   | Lymphocytes (Absolute)             | ×10³/μL      |                                               |
| MONO  | Monocytes (Absolute)               | ×10³/μL      |                                               |
| EOS   | Eosinophils (Absolute)             | ×10³/μL      |                                               |
| BASO  | Basophils (Absolute)               | ×10³/μL      |                                               |
| RETIC | Reticulocytes                      | % or ×10³/μL | Immature RBCs; indicates bone marrow response |

## Chemistry Analytes

| Code | Full Name                     | Unit  | Notes                                                         |
| ---- | ----------------------------- | ----- | ------------------------------------------------------------- |
| ALT  | Alanine Aminotransferase      | U/L   | Liver-specific in dogs and cats                               |
| AST  | Aspartate Aminotransferase    | U/L   | Liver + muscle; less specific than ALT                        |
| ALP  | Alkaline Phosphatase          | U/L   | Cholestasis; steroid-induced in dogs; short half-life in cats |
| GGT  | Gamma-Glutamyltransferase     | U/L   | Biliary disease marker                                        |
| TBIL | Total Bilirubin               | mg/dL | Hemolysis or cholestasis                                      |
| DBIL | Direct (Conjugated) Bilirubin | mg/dL | Post-hepatic / hepatic                                        |
| BUN  | Blood Urea Nitrogen           | mg/dL | Renal + dietary + hepatic                                     |
| CREA | Creatinine                    | mg/dL | Primary renal marker; affected by muscle mass                 |
| SDMA | Symmetric Dimethylarginine    | μg/dL | Early renal marker; not affected by muscle mass               |
| PHOS | Phosphorus                    | mg/dL | Elevated in CKD                                               |
| CA   | Calcium                       | mg/dL | Hypercalcemia: lymphoma, Addison's, primary hyperPTH          |
| ALB  | Albumin                       | g/dL  | Hepatic synthesis; oncotic pressure                           |
| TP   | Total Protein                 | g/dL  | ALB + GLOB                                                    |
| GLOB | Globulins                     | g/dL  | TP minus ALB; elevated in chronic inflammation                |
| GLU  | Glucose                       | mg/dL | Diabetes, stress, hypoglycemia                                |
| CHOL | Cholesterol                   | mg/dL | Hypothyroidism, liver, pancreatitis                           |
| TRIG | Triglycerides                 | mg/dL | Pancreatitis, metabolic disease                               |
| AMYL | Amylase                       | U/L   | Pancreatic; less specific in cats                             |
| LIPA | Lipase                        | U/L   | Pancreatic; use species-specific fPLI / cPLI for cats/dogs    |
| NA   | Sodium                        | mEq/L | Electrolyte                                                   |
| K    | Potassium                     | mEq/L | Electrolyte; elevated in Addison's, renal failure             |
| CL   | Chloride                      | mEq/L | Electrolyte                                                   |
| TCO2 | Total CO₂ (Bicarbonate)       | mEq/L | Acid-base indicator                                           |
| AG   | Anion Gap                     | mEq/L | Metabolic acidosis assessment                                 |

## Key Clinical Ratios

| Ratio    | Formula    | Clinical Use                                          |
| -------- | ---------- | ----------------------------------------------------- |
| BUN:CREA | BUN / CREA | Pre-renal (> 20:1) vs. primary renal azotemia         |
| ALB:GLOB | ALB / GLOB | Low ratio in chronic inflammation, liver failure      |
| ALT:AST  | ALT / AST  | Disproportionate AST rise suggests muscle involvement |

## Species-Specific Notes

- **Cat ALP**: Half-life ~6 hours (vs. days in dogs). Any ALP elevation in cats is clinically significant. Not induced by glucocorticoids in cats.
- **Cat CREA**: Reference range lower than dogs due to lower muscle mass. Values of 1.6–1.8 mg/dL are already mildly concerning.
- **Dog ALP**: Can be markedly elevated by exogenous or endogenous glucocorticoids (steroid hepatopathy) without true hepatobiliary disease.
- **SDMA**: Not affected by muscle mass or body condition; recommended early renal screening in both species.
