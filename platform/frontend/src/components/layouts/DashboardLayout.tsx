import React, { useState, useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { AnimatePresence, motion } from 'framer-motion';
import { Menu, X, ChevronLeft, ChevronRight, Bell, Search, User, Settings, LogOut } from 'lucide-react';
import clsx from 'clsx';

// Import components
import Sidebar from '../sidebar/Sidebar';
import Header from '../header/Header';
import LoadingSpinner from '../shared/LoadingSpinner';
import { usePlatformContext } from '@/hooks/usePlatformContext';
import { api } from '@/services/api';
import { useQueryClient } from '@tanstack/react-query';
import AIAssistant from '../assistant/AIAssistant';

const DashboardLayout: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [darkMode, setDarkMode] = useState(() => {
    const savedTheme = localStorage.getItem('dsp-theme');
    return savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches);
  });
  const location = useLocation();
  const { user, isAuthenticated, isLoading, logout } = useAuth();
  const { data: platform } = usePlatformContext();
  const queryClient = useQueryClient();
  const exitImpersonation = async () => {
    try { await api.post('/support/impersonation/end', {}); } finally {
      sessionStorage.removeItem('dsp-support-session');
      queryClient.clear();
      window.location.href = '/app/users';
    }
  };

  // Check if mobile
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      // A mobile route change closes the drawer. Re-open the persistent shell
      // when the viewport returns to desktop so navigation cannot become
      // unreachable until a full page refresh.
      if (!mobile) setSidebarOpen(true);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    document.documentElement.style.colorScheme = darkMode ? 'dark' : 'light';
    localStorage.setItem('dsp-theme', darkMode ? 'dark' : 'light');

    const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    themeColor?.setAttribute('content', darkMode ? '#0f172a' : '#2563eb');
  }, [darkMode]);

  // Close sidebar on mobile when route changes
  useEffect(() => {
    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [location, isMobile]);

  // Handle logout
  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  // Toggle sidebar
  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };

  // If not authenticated and not loading, redirect to login
  if (!isAuthenticated && !isLoading) {
    return <Navigate to="/login" replace />;
  }

  // Show loading spinner while checking auth
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 transition-colors duration-200 dark:bg-slate-950 dark:text-slate-100">
      {/* Mobile sidebar backdrop */}
      <AnimatePresence>
        {sidebarOpen && isMobile && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-40 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ x: -256 }}
            animate={{ x: 0 }}
            exit={{ x: -256 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className={clsx(
              'fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-gray-200 transform transition-transform duration-300 ease-in-out md:translate-x-0 dark:bg-slate-900 dark:border-slate-800',
              {
                'translate-x-0': sidebarOpen,
                '-translate-x-full': !sidebarOpen,
              }
            )}
          >
            <Sidebar onClose={() => setSidebarOpen(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <Header
        onMenuClick={toggleSidebar}
        sidebarOpen={sidebarOpen}
        user={user}
        onLogout={handleLogout}
        darkMode={darkMode}
        onThemeToggle={() => setDarkMode((current) => !current)}
      />

      {/* Main content */}
      <main
        className={clsx(
          'pt-16 min-h-screen bg-gray-50 transition-all duration-300 ease-in-out dark:bg-slate-950',
          {
            'md:pl-64': sidebarOpen,
            'md:pl-0': !sidebarOpen,
          }
        )}
      >
        {platform?.impersonation && <div className="sticky top-16 z-30 flex flex-wrap items-center justify-between gap-3 border-b border-amber-300 bg-amber-100 px-4 py-3 text-sm text-amber-950"><div><strong>Read-only support view:</strong> {platform.impersonation.targetEmail} ({platform.impersonation.targetRole})<span className="ml-2 text-xs">Reason: {platform.impersonation.reason}</span></div><button onClick={exitImpersonation} className="rounded bg-amber-900 px-3 py-1.5 font-semibold text-white">Exit support view</button></div>}
        <div className="p-4 md:p-6 lg:p-8">
          <Outlet />
        </div>
      </main>

      {/* Mobile sidebar toggle button */}
      {!sidebarOpen && isMobile && (
        <button
          onClick={toggleSidebar}
          className="fixed bottom-6 left-6 z-40 p-3 bg-primary-600 text-white rounded-full shadow-lg hover:bg-primary-700 transition-colors"
        >
          <Menu size={24} />
        </button>
      )}
      <AIAssistant />
    </div>
  );
};

export default DashboardLayout;
