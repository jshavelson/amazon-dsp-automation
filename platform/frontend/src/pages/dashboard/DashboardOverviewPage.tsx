import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import {
  Users,
  Truck,
  DollarSign,
  BarChart3,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  FileText,
  Route,
  Calendar,
  Activity,
  CreditCard,
  Fuel,
  Wrench,
} from 'lucide-react';
import { Button } from '@/components/shared/Button';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';

// Mock data types
interface KpiCard {
  id: string;
  title: string;
  value: string | number;
  change: number;
  changeType: 'increase' | 'decrease' | 'neutral';
  icon: React.ReactNode;
  color: string;
  link: string;
}

interface RecentActivity {
  id: string;
  type: 'driver' | 'van' | 'route' | 'dispute' | 'payroll';
  action: string;
  entity: string;
  timestamp: string;
  status: 'success' | 'warning' | 'error' | 'info';
}

interface QuickAction {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  link: string;
}

interface ChartData {
  labels: string[];
  datasets: {
    label: string;
    data: number[];
    color: string;
  }[];
}

const DashboardOverviewPage: React.FC = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [kpiCards, setKpiCards] = useState<KpiCard[]>([]);
  const [recentActivities, setRecentActivities] = useState<RecentActivity[]>([]);
  const [quickActions, setQuickActions] = useState<QuickAction[]>([]);
  const [chartData, setChartData] = useState<ChartData | null>(null);

  // Mock data
  useEffect(() => {
    // Simulate loading
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 1000);

    // KPI Cards
    setKpiCards([
      {
        id: 'drivers',
        title: 'Active Drivers',
        value: 42,
        change: 2,
        changeType: 'increase',
        icon: <Users size={24} />,
        color: 'primary',
        link: '/drivers',
      },
      {
        id: 'vans',
        title: 'Active Vans',
        value: 28,
        change: -1,
        changeType: 'decrease',
        icon: <Truck size={24} />,
        color: 'secondary',
        link: '/vans',
      },
      {
        id: 'routes',
        title: 'Today Routes',
        value: 156,
        change: 8,
        changeType: 'increase',
        icon: <Route size={24} />,
        color: 'success',
        link: '/routes',
      },
      {
        id: 'disputes',
        title: 'Open Disputes',
        value: 12,
        change: -3,
        changeType: 'decrease',
        icon: <FileText size={24} />,
        color: 'warning',
        link: '/disputes',
      },
      {
        id: 'payroll',
        title: 'Payroll Due',
        value: '$124,582',
        change: 12.5,
        changeType: 'increase',
        icon: <DollarSign size={24} />,
        color: 'danger',
        link: '/payroll',
      },
      {
        id: 'costs',
        title: 'Fleet Costs',
        value: '$8,432',
        change: -5.2,
        changeType: 'decrease',
        icon: <CreditCard size={24} />,
        color: 'info',
        link: '/fleet-costs',
      },
    ]);

    // Recent Activities
    setRecentActivities([
      {
        id: '1',
        type: 'driver',
        action: 'assigned',
        entity: 'John Smith',
        timestamp: new Date(Date.now() - 3600000).toISOString(),
        status: 'success',
      },
      {
        id: '2',
        type: 'route',
        action: 'completed',
        entity: 'Route #156',
        timestamp: new Date(Date.now() - 7200000).toISOString(),
        status: 'success',
      },
      {
        id: '3',
        type: 'dispute',
        action: 'submitted',
        entity: 'Dispute #42',
        timestamp: new Date(Date.now() - 10800000).toISOString(),
        status: 'warning',
      },
      {
        id: '4',
        type: 'van',
        action: 'maintenance',
        entity: 'Van #12',
        timestamp: new Date(Date.now() - 14400000).toISOString(),
        status: 'info',
      },
      {
        id: '5',
        type: 'payroll',
        action: 'processed',
        entity: 'Week 35',
        timestamp: new Date(Date.now() - 18000000).toISOString(),
        status: 'success',
      },
    ]);

    // Quick Actions
    setQuickActions([
      {
        id: 'new-driver',
        title: 'Add Driver',
        description: 'Onboard a new driver',
        icon: <Users size={20} />,
        color: 'primary',
        link: '/drivers/new',
      },
      {
        id: 'new-van',
        title: 'Add Van',
        description: 'Add a new van to fleet',
        icon: <Truck size={20} />,
        color: 'secondary',
        link: '/vans/new',
      },
      {
        id: 'new-dispute',
        title: 'Create Dispute',
        description: 'Submit a new dispute',
        icon: <FileText size={20} />,
        color: 'warning',
        link: '/disputes/new',
      },
      {
        id: 'new-route',
        title: 'Plan Route',
        description: 'Create a new route',
        icon: <Route size={20} />,
        color: 'success',
        link: '/routes/new',
      },
    ]);

    // Chart Data
    setChartData({
      labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
      datasets: [
        {
          label: 'Routes Completed',
          data: [120, 135, 142, 158, 165, 172, 180, 175, 188, 195, 200, 210],
          color: '#3b82f6',
        },
        {
          label: 'Disputes',
          data: [5, 8, 6, 12, 9, 7, 10, 8, 12, 15, 11, 9],
          color: '#f59e0b',
        },
      ],
    });

    return () => clearTimeout(timer);
  }, []);

  // Color mapping
  const colorMap: Record<string, string> = {
    primary: 'bg-primary-50 text-primary-700 border-primary-200',
    secondary: 'bg-secondary-50 text-secondary-700 border-secondary-200',
    success: 'bg-success-50 text-success-700 border-success-200',
    warning: 'bg-warning-50 text-warning-700 border-warning-200',
    danger: 'bg-danger-50 text-danger-700 border-danger-200',
    info: 'bg-info-50 text-info-700 border-info-200',
  };

  // Status icon mapping
  const statusIconMap: Record<string, React.ReactNode> = {
    success: <CheckCircle size={14} className="text-success-600" />,
    warning: <AlertTriangle size={14} className="text-warning-600" />,
    error: <XCircle size={14} className="text-danger-600" />,
    info: <Activity size={14} className="text-info-600" />,
  };

  // Type icon mapping
  const typeIconMap: Record<string, React.ReactNode> = {
    driver: <Users size={16} className="text-primary-600" />,
    van: <Truck size={16} className="text-secondary-600" />,
    route: <Route size={16} className="text-success-600" />,
    dispute: <FileText size={16} className="text-warning-600" />,
    payroll: <DollarSign size={16} className="text-danger-600" />,
  };

  // KPI Card Component
  const KpiCard: React.FC<{ card: KpiCard; index: number }> = ({ card, index }) => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: index * 0.1 }}
      className="card group hover:shadow-lg transition-shadow"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div
            className={clsx(
              'w-12 h-12 rounded-xl flex items-center justify-center',
              colorMap[card.color]?.split(' ')[0],
              colorMap[card.color]?.split(' ')[1]
            )}
          >
            {card.icon}
          </div>
          <div>
            <p className="text-sm text-gray-500">{card.title}</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{card.value}</p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <span
            className={clsx(
              'text-sm font-medium flex items-center',
              card.changeType === 'increase' ? 'text-success-600' :
              card.changeType === 'decrease' ? 'text-danger-600' :
              'text-gray-500'
            )}
          >
            {card.changeType === 'increase' && <TrendingUp size={14} className="mr-1" />}
            {card.changeType === 'decrease' && <TrendingDown size={14} className="mr-1" />}
            {card.change > 0 && '+'}{card.change}%
          </span>
          <Link
            to={card.link}
            className="opacity-0 group-hover:opacity-100 p-2 rounded-lg hover:bg-gray-100 transition-all"
          >
            <ArrowRight size={16} className="text-gray-400" />
          </Link>
        </div>
      </div>
    </motion.div>
  );

  // Recent Activity Item Component
  const RecentActivityItem: React.FC<{ activity: RecentActivity; index: number }> = ({ activity, index }) => (
    <motion.tr
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      className="border-b border-gray-100 last:border-0"
    >
      <td className="px-4 py-3">
        <div className="flex items-center space-x-3">
          <span className="text-gray-400">{typeIconMap[activity.type] || <Activity size={16} />}</span>
          <span className="font-medium text-gray-900">{activity.entity}</span>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className="text-sm text-gray-600">{activity.action}</span>
      </td>
      <td className="px-4 py-3">
        <span className="text-sm text-gray-500">
          {new Date(activity.timestamp).toLocaleString()}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium">
          {statusIconMap[activity.status]}
          <span className="ml-1 capitalize">{activity.status}</span>
        </span>
      </td>
    </motion.tr>
  );

  // Quick Action Button Component
  const QuickActionButton: React.FC<{ action: QuickAction; index: number }> = ({ action, index }) => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 + index * 0.1 }}
      className="group"
    >
      <Link
        to={action.link}
        className="block p-4 bg-white rounded-lg border border-gray-200 hover:border-primary-300 hover:shadow-md transition-all"
      >
        <div className="flex items-center space-x-3">
          <div
            className={clsx(
              'w-10 h-10 rounded-lg flex items-center justify-center',
              colorMap[action.color]?.split(' ')[0],
              colorMap[action.color]?.split(' ')[1]
            )}
          >
            {action.icon}
          </div>
          <div>
            <p className="font-medium text-gray-900">{action.title}</p>
            <p className="text-sm text-gray-500">{action.description}</p>
          </div>
        </div>
      </Link>
    </motion.div>
  );

  // Chart Component (Placeholder)
  const ChartComponent: React.FC = () => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3 }}
      className="card"
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">Performance Overview</h3>
        <div className="flex items-center space-x-2">
          <button className="px-3 py-1 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">
            Week
          </button>
          <button className="px-3 py-1 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">
            Month
          </button>
          <button className="px-3 py-1 text-sm bg-primary-100 text-primary-700 rounded-lg">
            Year
          </button>
        </div>
      </div>
      <div className="h-64 flex items-center justify-center bg-gray-50 rounded-lg">
        <p className="text-gray-400">Chart will be rendered here</p>
      </div>
    </motion.div>
  );

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" text="Loading dashboard..." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-500 mt-1">Welcome back! Here's what's happening today.</p>
        </div>
        <div className="flex items-center space-x-2">
          <Button variant="outline" leftIcon={<Calendar size={16} />}>
            Today
          </Button>
          <Button variant="outline" leftIcon={<Clock size={16} />}>
            Last 7 Days
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {kpiCards.map((card, index) => (
          <KpiCard key={card.id} card={card} index={index} />
        ))}
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column - Chart */}
        <div className="lg:col-span-2">
          <ChartComponent />
        </div>

        {/* Right column - Quick Actions */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-gray-900">Quick Actions</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {quickActions.map((action, index) => (
              <QuickActionButton key={action.id} action={action} index={index} />
            ))}
          </div>
        </div>
      </div>

      {/* Recent Activities */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Recent Activities</h3>
          <Link
            to="/activity"
            className="text-sm text-primary-600 hover:text-primary-700 hover:underline"
          >
            View All
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-sm text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-3 font-medium">Entity</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {recentActivities.map((activity, index) => (
                <RecentActivityItem key={activity.id} activity={activity} index={index} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bottom metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="card"
        >
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
              <Fuel size={20} className="text-primary-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Fuel Efficiency</p>
              <p className="text-xl font-bold text-gray-900">24.5 MPG</p>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="card"
        >
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-success-100 rounded-lg flex items-center justify-center">
              <Wrench size={20} className="text-success-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Maintenance Due</p>
              <p className="text-xl font-bold text-gray-900">3 Vans</p>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.6 }}
          className="card"
        >
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-warning-100 rounded-lg flex items-center justify-center">
              <Calendar size={20} className="text-warning-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Upcoming</p>
              <p className="text-xl font-bold text-gray-900">5 Events</p>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default DashboardOverviewPage;
