import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';
import {
  Menu,
  Bell,
  Search,
  User,
  Settings,
  LogOut,
  ChevronDown,
  X,
  Moon,
  Sun,
} from 'lucide-react';
import { User as UserType } from '@/types/auth';

interface HeaderProps {
  onMenuClick?: () => void;
  sidebarOpen?: boolean;
  user: UserType | null;
  onLogout?: () => Promise<void>;
  darkMode: boolean;
  onThemeToggle: () => void;
}

interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'success' | 'error';
  read: boolean;
  createdAt: string;
}

const Header: React.FC<HeaderProps> = ({
  onMenuClick,
  sidebarOpen,
  user,
  onLogout,
  darkMode,
  onThemeToggle,
}) => {
  const location = useLocation();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Mock notifications (replace with real data)
  useEffect(() => {
    const mockNotifications: Notification[] = [
      {
        id: '1',
        title: 'New Dispute Submitted',
        message: 'A new dispute has been submitted for review',
        type: 'info',
        read: false,
        createdAt: new Date(Date.now() - 3600000).toISOString(),
      },
      {
        id: '2',
        title: 'Payroll Processing Complete',
        message: 'Weekly payroll has been processed successfully',
        type: 'success',
        read: false,
        createdAt: new Date(Date.now() - 7200000).toISOString(),
      },
      {
        id: '3',
        title: 'High CPU Usage',
        message: 'Database CPU usage is above 80%',
        type: 'warning',
        read: true,
        createdAt: new Date(Date.now() - 10800000).toISOString(),
      },
    ];
    setNotifications(mockNotifications);
  }, []);

  // Toggle notifications
  const toggleNotifications = () => {
    setShowNotifications(!showNotifications);
    setShowUserMenu(false);
  };

  // Toggle user menu
  const toggleUserMenu = () => {
    setShowUserMenu(!showUserMenu);
    setShowNotifications(false);
  };

  // Mark notification as read
  const markAsRead = (id: string) => {
    setNotifications(
      notifications.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  };

  // Mark all notifications as read
  const markAllAsRead = () => {
    setNotifications(
      notifications.map((n) => ({ ...n, read: true }))
    );
  };

  // Get unread notification count
  const unreadCount = notifications.filter((n) => !n.read).length;

  // Get page title from path
  const getPageTitle = (): string => {
    const path = location.pathname;
    const titles: Record<string, string> = {
      '/dashboard': 'Dashboard',
      '/drivers': 'Drivers',
      '/vans': 'Vans',
      '/routes': 'Routes',
      '/disputes': 'Disputes',
      '/payroll': 'Payroll',
      '/performance': 'Performance',
      '/fleet-costs': 'Fleet Costs',
      '/settings': 'Settings',
      '/security': 'Security',
      '/notifications': 'Notifications',
      '/help': 'Help & Support',
    };
    return titles[path] || 'Amazon DSP Dashboard';
  };

  // Breadcrumb component
  const Breadcrumb = () => {
    const pathParts = location.pathname.split('/').filter(Boolean);
    
    if (pathParts.length === 0) return null;

    return (
      <div className="hidden md:flex items-center space-x-2 text-sm text-gray-500">
        <Link to="/dashboard" className="text-gray-600 hover:text-primary-600">
          Dashboard
        </Link>
        {pathParts.map((part, index) => {
          const path = `/${pathParts.slice(0, index + 1).join('/')}`;
          const isLast = index === pathParts.length - 1;
          
          return (
            <React.Fragment key={path}>
              <span className="text-gray-400">/</span>
              {isLast ? (
                <span className="text-gray-900 capitalize">{part.replace('-', ' ')}</span>
              ) : (
                <Link
                  to={path}
                  className="text-gray-600 hover:text-primary-600 capitalize"
                >
                  {part.replace('-', ' ')}
                </Link>
              )}
            </React.Fragment>
          );
        })}
      </div>
    );
  };

  // Notification dropdown
  const NotificationDropdown = () => (
    <AnimatePresence>
      {showNotifications && (
        <motion.div
          initial={{ opacity: 0, y: -10, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.95 }}
          transition={{ duration: 0.2 }}
          className="absolute right-0 top-full mt-2 w-80 bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden z-50"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900">Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-sm text-primary-600 hover:text-primary-700"
              >
                Mark all as read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-gray-500">
                <p>No notifications</p>
              </div>
            ) : (
              notifications.map((notification) => (
                <button
                  key={notification.id}
                  onClick={() => markAsRead(notification.id)}
                  className={clsx(
                    'w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-0',
                    {
                      'bg-primary-50/50': !notification.read,
                    }
                  )}
                >
                  <div className="flex items-start space-x-3">
                    <div
                      className={clsx(
                        'w-2 h-2 mt-1.5 flex-shrink-0 rounded-full',
                        {
                          'bg-primary-500': !notification.read,
                          'bg-gray-300': notification.read,
                        }
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {notification.title}
                      </p>
                      <p className="text-sm text-gray-500 mt-0.5 line-clamp-2">
                        {notification.message}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        {new Date(notification.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="px-4 py-2 border-t border-gray-100">
            <Link
              to="/notifications"
              onClick={() => setShowNotifications(false)}
              className="text-sm text-primary-600 hover:text-primary-700 font-medium"
            >
              View all notifications
            </Link>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  // User menu dropdown
  const UserMenuDropdown = () => (
    <AnimatePresence>
      {showUserMenu && (
        <motion.div
          initial={{ opacity: 0, y: -10, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.95 }}
          transition={{ duration: 0.2 }}
          className="absolute right-0 top-full mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden z-50"
        >
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="font-medium text-gray-900">{user?.firstName} {user?.lastName}</p>
            <p className="text-sm text-gray-500">{user?.email}</p>
          </div>

          <div className="py-1">
            <Link
              to="/profile"
              onClick={() => setShowUserMenu(false)}
              className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <User size={16} className="mr-3" />
              Profile
            </Link>
            <Link
              to="/settings"
              onClick={() => setShowUserMenu(false)}
              className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <Settings size={16} className="mr-3" />
              Settings
            </Link>
          </div>

          <div className="px-4 py-2 border-t border-gray-100">
            <button
              onClick={async () => {
                if (onLogout) {
                  await onLogout();
                }
                setShowUserMenu(false);
              }}
              className="flex items-center w-full px-4 py-2 text-sm text-danger-600 hover:bg-danger-50"
            >
              <LogOut size={16} className="mr-3" />
              Logout
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <header
      className={clsx(
        'fixed top-0 right-0 z-40 h-16 bg-white border-b border-gray-200 transition-all duration-300 dark:bg-slate-900 dark:border-slate-800',
        {
          'left-0': !sidebarOpen,
          'left-64': sidebarOpen,
        }
      )}
    >
      <div className="flex items-center justify-between h-full px-4 md:px-6">
        {/* Left side */}
        <div className="flex items-center space-x-4">
          {/* Mobile menu button */}
          {onMenuClick && (
            <button
              onClick={onMenuClick}
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors md:hidden"
              aria-label="Toggle sidebar"
            >
              <Menu size={20} className="text-gray-600" />
            </button>
          )}

          {/* Breadcrumb */}
          <Breadcrumb />
        </div>

        {/* Right side */}
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={onThemeToggle}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
            aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {darkMode ? <Sun size={19} /> : <Moon size={19} />}
          </button>

          {/* Search */}
          <div className="hidden lg:flex items-center">
            <div className="relative">
              <Search
                size={18}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-64 pl-10 pr-4 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:border-primary-500 focus:ring-2 focus:ring-primary-500 focus:outline-none transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X size={16} />
                </button>
              )}
            </div>
          </div>

          {/* Notifications */}
          <div className="relative">
            <button
              onClick={toggleNotifications}
              className="relative p-2 rounded-lg hover:bg-gray-100 transition-colors"
              aria-label="Notifications"
            >
              <Bell size={20} className="text-gray-600" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 w-4 h-4 bg-danger-500 text-white text-xs font-medium rounded-full flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </button>
            <NotificationDropdown />
          </div>

          {/* User menu */}
          <div className="relative">
            <button
              onClick={toggleUserMenu}
              className="flex items-center space-x-2 p-1 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <div className="w-8 h-8 bg-primary-100 text-primary-700 rounded-full flex items-center justify-center font-medium text-sm">
                {user?.firstName.charAt(0)}{user?.lastName.charAt(0)}
              </div>
              <div className="hidden md:block text-left">
                <p className="text-sm font-medium text-gray-900">
                  {user?.firstName} {user?.lastName}
                </p>
                <p className="text-xs text-gray-500 capitalize">{user?.role.replace('_', ' ')}</p>
              </div>
              <ChevronDown size={16} className="hidden md:block text-gray-400" />
            </button>
            <UserMenuDropdown />
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
