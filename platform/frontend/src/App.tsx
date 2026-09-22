import React, { useEffect } from 'react';
import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';

// Layout Components
import DashboardLayout from './components/layouts/DashboardLayout';
import AuthLayout from './components/layouts/AuthLayout';

// Page Components
import LoginPage from './pages/auth/LoginPage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import ResetPasswordPage from './pages/auth/ResetPasswordPage';

// Dashboard Pages
import DashboardOverviewPage from './pages/dashboard/DashboardOverviewPage';
import DriversPage from './pages/drivers/DriversPage';
import DriverDetailPage from './pages/drivers/DriverDetailPage';
import VansPage from './pages/vans/VansPage';
import VanDetailPage from './pages/vans/VanDetailPage';
import DisputesPage from './pages/disputes/DisputesPage';
import DisputeDetailPage from './pages/disputes/DisputeDetailPage';
import PayrollPage from './pages/payroll/PayrollPage';
import PayrollPeriodDetailPage from './pages/payroll/PayrollPeriodDetailPage';
import RoutesPage from './pages/routes/RoutesPage';
import WeeklyRoutePerformancePage from './pages/routes/WeeklyRoutePerformancePage';
import RouteDetailPage from './pages/routes/RouteDetailPage';
import PerformancePage from './pages/performance/PerformancePage';
import FleetCostsPage from './pages/fleet-costs/FleetCostsPage';
import FleetCompliancePage from './pages/fleet-compliance/FleetCompliancePage';
import WeeklyEvaluationPage from './pages/evaluation/WeeklyEvaluationPage';
import TimeAttendancePage from './pages/time-attendance/TimeAttendancePage';
import ReimbursementReviewPage from './pages/reimbursement/ReimbursementReviewPage';
import ConnectionsPage from './pages/connections/ConnectionsPage';
import SystemPage from './pages/system/SystemPage';
import { UsersRolesPage, FeatureAdminPage } from './pages/admin/AccessAdminPage';
import AIAssistantAdminPage from './pages/admin/AIAssistantAdminPage';
import SuperAdminPage from './pages/admin/SuperAdminPage';
import { usePlatformContext } from './hooks/usePlatformContext';

// Shared Components
import LoadingSpinner from './components/shared/LoadingSpinner';
import NotFoundPage from './pages/NotFoundPage';

// Protected Route Component
const ProtectedRoute: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
};

// Public Route Component
const PublicRoute: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
};

const FeatureGate: React.FC = () => {
  const location = useLocation();
  const { data, isLoading } = usePlatformContext();
  if (isLoading) return <div className="min-h-screen flex items-center justify-center"><LoadingSpinner size="lg" /></div>;
  if (location.pathname === '/') return <Outlet />;
  const feature = data?.features.find((item) => location.pathname === item.route || location.pathname.startsWith(`${item.route}/`));
  if (!feature) return <div className="m-8 rounded-xl border border-red-200 bg-red-50 p-6 text-red-800"><strong>Feature unavailable.</strong><p className="mt-1 text-sm">This feature is not implemented, enabled, entitled, or permitted for your role.</p></div>;
  return <Outlet />;
};

// Main App Component
const App: React.FC = () => {
  const location = useLocation();

  // Scroll to top on route change
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className="min-h-screen">
        <Routes>
          {/* Public Routes */}
          <Route element={<PublicRoute />}>
            <Route element={<AuthLayout />}>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
            </Route>
          </Route>

          {/* Protected Routes */}
          <Route element={<ProtectedRoute />}>
            <Route element={<FeatureGate />}>
            <Route element={<DashboardLayout />}>
              {/* Dashboard */}
              <Route path="/dashboard" element={<DashboardOverviewPage />} />
              <Route path="/" element={<Navigate to="/dashboard" replace />} />

              {/* Drivers */}
              <Route path="/drivers" element={<DriversPage />} />
              <Route path="/drivers/:id" element={<DriverDetailPage />} />

              {/* Vans */}
              <Route path="/vans" element={<VansPage />} />
              <Route path="/vans/:id" element={<VanDetailPage />} />
              <Route path="/fleet-compliance" element={<FleetCompliancePage />} />

              {/* Disputes */}
              <Route path="/disputes" element={<DisputesPage />} />
              <Route path="/disputes/:id" element={<DisputeDetailPage />} />
              <Route path="/dispute-center" element={<DisputesPage />} />

              {/* Payroll */}
              <Route path="/payroll" element={<PayrollPage />} />
              <Route path="/payroll/:periodId" element={<PayrollPeriodDetailPage />} />

              {/* Routes */}
              <Route path="/routes" element={<RoutesPage />} />
              <Route path="/routes/:id" element={<RouteDetailPage />} />
              <Route path="/route-performance" element={<WeeklyRoutePerformancePage />} />

              {/* Performance */}
              <Route path="/performance" element={<PerformancePage />} />
              <Route path="/weekly-evaluation" element={<WeeklyEvaluationPage />} />

              {/* Time & Attendance */}
              <Route path="/time-attendance" element={<TimeAttendancePage />} />
              <Route path="/reimbursement-review" element={<ReimbursementReviewPage />} />
              <Route path="/connections" element={<ConnectionsPage />} />
              <Route path="/users" element={<UsersRolesPage />} />
              <Route path="/admin/features" element={<FeatureAdminPage />} />
              <Route path="/admin/tenants" element={<SuperAdminPage />} />
              <Route path="/admin/ai" element={<AIAssistantAdminPage />} />

              {/* Fleet Costs */}
              <Route path="/fleet-costs" element={<FleetCostsPage />} />
              <Route path="/maintenance" element={<FleetCostsPage />} />
              <Route path="/fuel" element={<FleetCostsPage />} />

              {/* System */}
              <Route path="/settings" element={<SystemPage />} />
              <Route path="/security" element={<SystemPage />} />
              <Route path="/notifications" element={<SystemPage />} />
              <Route path="/help" element={<SystemPage />} />
            </Route>
            </Route>
          </Route>

          {/* 404 Not Found */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
    </div>
  );
};

export default App;
