import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import {
  LayoutDashboard,
  Users,
  Truck,
  FileText,
  DollarSign,
  Route,
  BarChart3,
  Settings,
  HelpCircle,
  X,
  ChevronLeft,
  ChevronRight,
  Home,
  FileBarChart,
  ShieldCheck,
  Bell,
  CreditCard,
  Fuel,
  Wrench,
} from 'lucide-react';

interface SidebarProps {
  onClose?: () => void;
}

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  badge?: string | number;
  children?: NavItem[];
}

const Sidebar: React.FC<SidebarProps> = ({ onClose }) => {
  const location = useLocation();
  const [expandedGroups, setExpandedGroups] = React.useState<Record<string, boolean>>({
    operations: true,
    management: true,
    analytics: true,
    system: true,
  });

  // Navigation items
  const navItems: NavItem[] = [
    {
      label: 'Dashboard',
      href: '/dashboard',
      icon: <Home size={20} />,
    },
    {
      label: 'Drivers',
      href: '/drivers',
      icon: <Users size={20} />,
    },
    {
      label: 'Vans',
      href: '/vans',
      icon: <Truck size={20} />,
    },
    {
      label: 'Routes',
      href: '/routes',
      icon: <Route size={20} />,
    },
    {
      label: 'Disputes',
      href: '/disputes',
      icon: <FileText size={20} />,
      badge: 5, // Example badge count
    },
    {
      label: 'Payroll',
      href: '/payroll',
      icon: <DollarSign size={20} />,
    },
    {
      label: 'Performance',
      href: '/performance',
      icon: <BarChart3 size={20} />,
    },
    {
      label: 'Fleet Costs',
      href: '/fleet-costs',
      icon: <CreditCard size={20} />,
    },
    {
      label: 'Maintenance',
      href: '/maintenance',
      icon: <Wrench size={20} />,
    },
    {
      label: 'Fuel Tracking',
      href: '/fuel',
      icon: <Fuel size={20} />,
    },
  ];

  // Bottom navigation items
  const bottomNavItems: NavItem[] = [
    {
      label: 'Settings',
      href: '/settings',
      icon: <Settings size={20} />,
    },
    {
      label: 'Security',
      href: '/security',
      icon: <ShieldCheck size={20} />,
    },
    {
      label: 'Notifications',
      href: '/notifications',
      icon: <Bell size={20} />,
      badge: 3,
    },
    {
      label: 'Help & Support',
      href: '/help',
      icon: <HelpCircle size={20} />,
    },
  ];

  // Toggle expanded state for a group
  const toggleExpanded = (group: string) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [group]: !prev[group],
    }));
  };

  // Check if a nav item is active
  const isActive = (href: string): boolean => {
    return location.pathname === href || location.pathname.startsWith(`${href}/`);
  };

  // Sidebar header
  const SidebarHeader = () => (
    <div className="flex items-center justify-between h-16 px-4 border-b border-gray-200">
      <div className="flex items-center space-x-3">
        <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center">
          <span className="text-white font-bold text-lg">DSP</span>
        </div>
        <span className="font-semibold text-gray-900">Amazon DSP</span>
      </div>
      {onClose && (
        <button
          onClick={onClose}
          className="p-1 rounded-lg hover:bg-gray-100 transition-colors"
          aria-label="Close sidebar"
        >
          <X size={20} className="text-gray-500" />
        </button>
      )}
    </div>
  );

  // Navigation item component
  const NavItemComponent: React.FC<{ item: NavItem; level?: number }> = ({ item, level = 0 }) => {
    const hasChildren = item.children && item.children.length > 0;
    const isItemActive = isActive(item.href);

    return (
      <li className="mb-1">
        <NavLink
          to={item.href}
          className={clsx(
            'flex items-center px-3 py-2.5 rounded-lg text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors duration-200',
            {
              'bg-primary-50 text-primary-700 font-medium': isItemActive,
              'pl-6': level > 0,
            }
          )}
        >
          <span className="mr-3 text-gray-400">{item.icon}</span>
          <span className="flex-1 truncate">{item.label}</span>
          {item.badge && (
            <span
              className={clsx(
                'inline-flex items-center justify-center min-w-[20px] h-[20px] px-2 py-0.5 text-xs font-medium rounded-full',
                {
                  'bg-primary-100 text-primary-800': isItemActive,
                  'bg-gray-100 text-gray-600': !isItemActive,
                }
              )}
            >
              {item.badge}
            </span>
          )}
          {hasChildren && (
            <button
              onClick={(e) => {
                e.preventDefault();
                toggleExpanded(item.label.toLowerCase());
              }}
              className="ml-2 p-1 rounded hover:bg-gray-200 transition-colors"
            >
              {expandedGroups[item.label.toLowerCase()] ? (
                <ChevronLeft size={16} />
              ) : (
                <ChevronRight size={16} />
              )}
            </button>
          )}
        </NavLink>

        {hasChildren && expandedGroups[item.label.toLowerCase()] && (
          <motion.ul
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="ml-6 mt-1 space-y-1 overflow-hidden"
          >
            {item.children?.map((child) => (
              <NavItemComponent key={child.href} item={child} level={level + 1} />
            ))}
          </motion.ul>
        )}
      </li>
    );
  };

  // Sidebar footer
  const SidebarFooter = () => (
    <div className="px-4 py-4 border-t border-gray-200">
      <div className="text-xs text-gray-400">
        <p>Amazon DSP Dashboard</p>
        <p className="mt-1">v1.0.0</p>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <SidebarHeader />

      {/* Navigation */}
      <nav className="flex-1 px-2 py-4 overflow-y-auto">
        <ul className="space-y-1">
          {navItems.map((item) => (
            <NavItemComponent key={item.href} item={item} />
          ))}
        </ul>

        {/* Divider */}
        <div className="my-4 px-3">
          <div className="h-px bg-gray-200" />
        </div>

        {/* Bottom Navigation */}
        <ul className="space-y-1">
          {bottomNavItems.map((item) => (
            <NavItemComponent key={item.href} item={item} />
          ))}
        </ul>
      </nav>

      {/* Footer */}
      <SidebarFooter />
    </div>
  );
};

export default Sidebar;
