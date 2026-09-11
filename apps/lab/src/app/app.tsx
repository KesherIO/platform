import { Routes, Route, Navigate } from 'react-router-dom';
import * as Sentry from '@sentry/react';
import { AuthProvider } from './auth/AuthContext';
import { ToastProvider } from './shared/components/ToastProvider';
import { ConfirmDialogProvider } from './shared/components/ConfirmDialogProvider';
import { ErrorFallback } from './shared/components/ErrorFallback';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { LoginPage } from './auth/LoginPage';
import { AuthCallbackPage } from './auth/AuthCallbackPage';
import { ResetPasswordPage } from './auth/ResetPasswordPage';
import { Layout } from './shared/components/Layout';
import { OrdersQueuePage } from './pages/orders/OrdersQueuePage';
import { OrderWorkspacePage } from './pages/orders/OrderWorkspacePage';
import { ResultEntryPage } from './pages/orders/ResultEntryPage';
import { BatchResultEntryPage } from './pages/orders/BatchResultEntryPage';
import { ReviewReleasePage } from './pages/orders/ReviewReleasePage';
import { LaboratorySettingsPage } from './pages/settings/LaboratorySettingsPage';
import { TeamPage } from './pages/settings/TeamPage';
import { AnalyzersPage } from './pages/settings/AnalyzersPage';
import { TestConfigPage } from './pages/settings/TestConfigPage';
import { ClientsPage } from './pages/clients/ClientsPage';
import { ClientDetailPage } from './pages/clients/ClientDetailPage';
import { CatalogPage } from './pages/catalog/CatalogPage';
import { CollectionsPage } from './pages/collections/CollectionsPage';
import { MyPickupsPage } from './pages/pickups/MyPickupsPage';
import { TemplateManagementPage } from './pages/templates/TemplateManagementPage';
import { TemplateBuilderPage } from './pages/templates/TemplateBuilderPage';
import { WorklistPage } from './pages/worklist/WorklistPage';
import { VetVerificationQueuePage } from './pages/verifications/VetVerificationQueuePage';
import { LabOnboardingWelcome } from './pages/onboarding/LabOnboardingWelcome';
import { LabOnboardingSetup } from './pages/onboarding/LabOnboardingSetup';
import { ScrollToTop } from './shared/components/ScrollToTop';

export function App() {
  return (
    <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
      <ToastProvider>
        <ConfirmDialogProvider>
          <AuthProvider>
            <ScrollToTop />
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/auth/callback" element={<AuthCallbackPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route
                path="/onboarding/welcome"
                element={<LabOnboardingWelcome />}
              />
              <Route
                path="/onboarding/setup"
                element={<LabOnboardingSetup />}
              />

              <Route
                element={
                  <ProtectedRoute>
                    <Layout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<Navigate to="/orders" replace />} />
                <Route path="/orders" element={<OrdersQueuePage />} />
                <Route
                  path="/orders/:orderId"
                  element={<OrderWorkspacePage />}
                />
                <Route path="/worklist" element={<WorklistPage />} />
                <Route
                  path="/orders/:orderId/tests/:testId/results"
                  element={<ResultEntryPage />}
                />
                <Route
                  path="/orders/:orderId/batch-results"
                  element={<BatchResultEntryPage />}
                />
                <Route
                  path="/orders/:orderId/review"
                  element={<ReviewReleasePage />}
                />
                <Route
                  path="/verifications"
                  element={<VetVerificationQueuePage />}
                />
                <Route path="/clients" element={<ClientsPage />} />
                <Route path="/clients/:id" element={<ClientDetailPage />} />
                <Route path="/catalog" element={<CatalogPage />} />
                <Route path="/collections" element={<CollectionsPage />} />
                <Route path="/my-pickups" element={<MyPickupsPage />} />
                <Route
                  path="/settings/laboratory"
                  element={<LaboratorySettingsPage />}
                />
                <Route path="/settings/users" element={<TeamPage />} />
                <Route path="/settings/analyzers" element={<AnalyzersPage />} />
                <Route
                  path="/settings/test-config"
                  element={<TestConfigPage />}
                />
                <Route path="/templates" element={<TemplateManagementPage />} />
                <Route
                  path="/templates/:definitionId/versions/:versionId/edit"
                  element={<TemplateBuilderPage />}
                />
              </Route>

              <Route path="*" element={<Navigate to="/orders" replace />} />
            </Routes>
          </AuthProvider>
        </ConfirmDialogProvider>
      </ToastProvider>
    </Sentry.ErrorBoundary>
  );
}

export default App;
