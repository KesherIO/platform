import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { LoginPage } from './auth/LoginPage';
import { Layout } from './shared/components/Layout';
import { OrdersQueuePage } from './pages/orders/OrdersQueuePage';
import { OrderWorkspacePage } from './pages/orders/OrderWorkspacePage';
import { ResultEntryPage } from './pages/orders/ResultEntryPage';
import { ReviewReleasePage } from './pages/orders/ReviewReleasePage';
import { LaboratorySettingsPage } from './pages/settings/LaboratorySettingsPage';
import { TeamPage } from './pages/settings/TeamPage';

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/orders" replace />} />
          <Route path="/orders" element={<OrdersQueuePage />} />
          <Route path="/orders/:orderId" element={<OrderWorkspacePage />} />
          <Route
            path="/orders/:orderId/tests/:testId/results"
            element={<ResultEntryPage />}
          />
          <Route
            path="/orders/:orderId/review"
            element={<ReviewReleasePage />}
          />
          <Route
            path="/settings/laboratory"
            element={<LaboratorySettingsPage />}
          />
          <Route path="/settings/users" element={<TeamPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/orders" replace />} />
      </Routes>
    </AuthProvider>
  );
}

export default App;
