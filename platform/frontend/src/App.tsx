import React, { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { AnimatePresence, motion } from 'framer-motion';

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
import RouteDetailPage from './pages/routes/RouteDetailPage';
import PerformancePage from './pages/performance/PerformancePage';
import FleetCostsPage from './pages/fleet-costs/FleetCostsPage';

// Shared Components
import LoadingSpinner from './components/shared/LoadingSpinner';
import NotFoundPage from './pages/NotFoundPage';

// Protected Route Component
interface ProtectedRouteProps {
  children: React.ReactNode;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
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

  return <>{children}</>;
};

// Public Route Component
interface PublicRouteProps {
  children: React.ReactNode;
}

const PublicRoute: React.FC<PublicRouteProps> = ({ children }) => {
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

  return <>{children}</>;
};

// Main App Component
const App: React.FC = () => {
  const location = useLocation();

  // Scroll to top on route change
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.3, ease: 'easeInOut' }}
        className="min-h-screen"
      >
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

              {/* Disputes */}
              <Route path="/disputes" element={<DisputesPage />} />
              <Route path="/disputes/:id" element={<DisputeDetailPage />} />

              {/* Payroll */}
              <Route path="/payroll" element={<PayrollPage />} />
              <Route path="/payroll/:periodId" element={<PayrollPeriodDetailPage />} />

              {/* Routes */}
              <Route path="/routes" element={<RoutesPage />} />
              <Route path="/routes/:id" element={<RouteDetailPage />} />

              {/* Performance */}
              <Route path="/performance" element={<PerformancePage />} />

              {/* Fleet Costs */}
              <Route path="/fleet-costs" element={<FleetCostsPage />} />
            </Route>
          </Route>

          {/* 404 Not Found */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  );
};

export default App;
