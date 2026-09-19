import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';

const AuthLayout: React.FC = () => {
  const location = useLocation();

  // Get page title from path
  const getPageTitle = (): string => {
    const path = location.pathname;
    const titles: Record<string, string> = {
      '/login': 'Sign In',
      '/forgot-password': 'Forgot Password',
      '/reset-password': 'Reset Password',
      '/register': 'Create Account',
    };
    return titles[path] || 'Amazon DSP Dashboard';
  };

  // Get page subtitle
  const getPageSubtitle = (): string => {
    const path = location.pathname;
    const subtitles: Record<string, string> = {
      '/login': 'Sign in to your account to access the dashboard',
      '/forgot-password': 'Enter your email to receive a password reset link',
      '/reset-password': 'Set a new password for your account',
      '/register': 'Create a new account to get started',
    };
    return subtitles[path] || '';
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-primary-600 via-primary-700 to-primary-900">
      {/* Background pattern */}
      <div
        className="absolute inset-0 opacity-10"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          backgroundSize: '60px 60px',
        }}
      />

      {/* Main content */}
      <main className="flex-1 flex items-center justify-center p-4 md:p-6 lg:p-8 relative z-10">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="w-full max-w-md"
          >
            {/* Auth card */}
            <div className="bg-white rounded-2xl shadow-2xl p-8">
              {/* Header */}
              <div className="text-center mb-8">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-100 rounded-2xl mb-4">
                  <span className="text-primary-600 font-bold text-3xl">DSP</span>
                </div>
                <h1 className="text-2xl md:text-3xl font-bold text-gray-900">
                  {getPageTitle()}
                </h1>
                <p className="mt-2 text-gray-500">{getPageSubtitle()}</p>
              </div>

              {/* Content */}
              <Outlet />

              {/* Footer */}
              <div className="mt-8 pt-6 border-t border-gray-100">
                <p className="text-center text-sm text-gray-500">
                  © {new Date().getFullYear()} Amazon DSP Dashboard. All rights reserved.
                </p>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Decorative elements */}
      <div className="absolute top-8 left-8 w-24 h-24 bg-white/10 rounded-full blur-2xl" />
      <div className="absolute bottom-8 right-8 w-32 h-32 bg-white/10 rounded-full blur-2xl" />
      <div className="absolute top-1/2 left-1/4 w-16 h-16 bg-white/10 rounded-full blur-xl" />
      <div className="absolute top-1/3 right-1/4 w-20 h-20 bg-white/10 rounded-full blur-xl" />
    </div>
  );
};

export default AuthLayout;
