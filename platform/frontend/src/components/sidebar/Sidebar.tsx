import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import {
  Users,
  Truck,
  FileText,
  DollarSign,
  Route,
  BarChart3,
  Settings,
  HelpCircle,
  X,
  Home,
  FileBarChart,
  ShieldCheck,
  Bell,
  CreditCard,
  Fuel,
  Wrench,
  CalendarCheck,
  ClipboardCheck,
  Landmark,
  Link2,
  Bot,
} from 'lucide-react';
import { usePlatformContext } from '@/hooks/usePlatformContext';

interface SidebarProps {
  onClose?: () => void;
}

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  badge?: string | number;
  children?: NavItem[];
  featureId: string;
  planned?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const Sidebar: React.FC<SidebarProps> = ({ onClose }) => {
  const location = useLocation();
  const { data: platform } = usePlatformContext();

  const navGroups: NavGroup[] = [
    { label: 'Overview', items: [
      { label: 'Dashboard', href: '/dashboard', icon: <Home size={20} />, featureId: 'dashboard' },
    ] },
    { label: 'Operations', items: [
      { label: 'Route Monitor', href: '/routes', icon: <Route size={20} />, featureId: 'route_monitor' },
      { label: 'Drivers', href: '/drivers', icon: <Users size={20} />, featureId: 'drivers' },
      { label: 'Time & Attendance', href: '/time-attendance', icon: <CalendarCheck size={20} />, featureId: 'time_attendance' },
      { label: 'Payroll', href: '/payroll', icon: <DollarSign size={20} />, featureId: 'payroll' },
    ] },
    { label: 'Fleet', items: [
      { label: 'Vans', href: '/vans', icon: <Truck size={20} />, featureId: 'vans' },
      { label: 'Fleet Compliance', href: '/fleet-compliance', icon: <ClipboardCheck size={20} />, featureId: 'fleet_compliance' },
      { label: 'Maintenance', href: '/maintenance', icon: <Wrench size={20} />, featureId: 'maintenance' },
      { label: 'Fuel Tracking', href: '/fuel', icon: <Fuel size={20} />, featureId: 'fuel' },
      { label: 'Fleet Costs', href: '/fleet-costs', icon: <CreditCard size={20} />, featureId: 'fleet_costs' },
    ] },
    { label: 'Performance & Finance', items: [
      { label: 'Weekly Evaluation', href: '/weekly-evaluation', icon: <FileBarChart size={20} />, featureId: 'weekly_evaluation' },
      { label: 'Driver Performance', href: '/performance', icon: <BarChart3 size={20} />, featureId: 'driver_performance' },
      { label: 'Dispute Center', href: '/disputes', icon: <FileText size={20} />, badge: 5, featureId: 'disputes' },
      { label: 'Reimbursement Review', href: '/reimbursement-review', icon: <Landmark size={20} />, featureId: 'reimbursement_review' },
    ] },
    { label: 'Administration', items: [
      { label: 'Connections', href: '/connections', icon: <Link2 size={20} />, featureId: 'connections' },
      { label: 'Users & Roles', href: '/users', icon: <Users size={20} />, featureId: 'users' },
      ...(platform?.user.isPlatformAdmin
        ? [
          { label: 'Feature Management', href: '/admin/features', icon: <ShieldCheck size={20} />, featureId: 'feature_admin' },
          { label: 'AI Assistant Setup', href: '/admin/ai', icon: <Bot size={20} />, featureId: 'ai_admin' },
        ]
        : []),
    ] },
    { label: 'Support & Settings', items: [
      { label: 'Settings', href: '/settings', icon: <Settings size={20} />, featureId: 'settings' },
      { label: 'Security', href: '/security', icon: <ShieldCheck size={20} />, featureId: 'security' },
      { label: 'Notifications', href: '/notifications', icon: <Bell size={20} />, badge: 3, featureId: 'notifications' },
      { label: 'Help & Support', href: '/help', icon: <HelpCircle size={20} />, featureId: 'help' },
    ] },
  ];

  const visibleIds = new Map((platform?.features || []).map((feature) => [feature.id, feature]));
  const filterItems = (items: NavItem[]) => items.flatMap((item) => {
    const feature = visibleIds.get(item.featureId);
    return feature ? [{ ...item, planned: feature.status !== 'implemented' }] : [];
  });
  const visibleNavGroups = navGroups
    .map((group) => ({ ...group, items: filterItems(group.items) }))
    .filter((group) => group.items.length > 0);

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
          {item.planned && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">Planned</span>}
        </NavLink>

        {hasChildren && (
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
    <div className="flex flex-col h-full bg-white dark:bg-slate-900">
      {/* Header */}
      <SidebarHeader />

      {/* Navigation */}
      <nav className="flex-1 px-2 py-4 overflow-y-auto">
        <div className="space-y-5">
          {visibleNavGroups.map((group) => (
            <section key={group.label} aria-labelledby={`nav-${group.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
              <h2 id={`nav-${group.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500">
                {group.label}
              </h2>
              <ul className="space-y-1">
                {group.items.map((item) => <NavItemComponent key={item.href} item={item} />)}
              </ul>
            </section>
          ))}
        </div>
      </nav>

      {/* Footer */}
      <SidebarFooter />
    </div>
  );
};

export default Sidebar;
